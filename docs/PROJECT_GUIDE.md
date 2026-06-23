# Project Guide — Understanding the Flow & the Code

A developer-oriented walkthrough of how this platform works and **where every
concept lives in the code**. Read this top-to-bottom once and you'll be able to
navigate the whole repo.

- For the *why* behind each decision → [docs/adr/](adr/)
- For the *recruiter pitch* → [root README](../README.md)
- For *diagrams* → [docs/sequence-diagrams/](sequence-diagrams/)

---

## 1. The 60-second mental model

A customer places an order. That single action fans out into **payment** and
**inventory** work happening in parallel, then the order is **confirmed** (or
**cancelled** and compensated). Everything is connected by **Kafka events**, and
**every step is safe to run more than once** (idempotent), so retries and
duplicate deliveries can never double-charge or oversell.

```
Customer
   │  HTTP (JWT + Idempotency-Key)
   ▼
api-gateway ──HTTP──► order-service ──(writes order + event in ONE db tx)
                          │
                          │  outbox relay publishes to Kafka
                          ▼
                    ┌──── Kafka ────┬───────────────┐
                    ▼               ▼               ▼
              payment-service  inventory-service  notification-service
                    │               │
                    └──► emits payments.* / inventory.* ──► order-service settles
                                                            the saga (CONFIRMED/CANCELLED)
```

---

## 2. Repository layout

```
.
├── docker-compose.yml          # Kafka (KRaft) + Postgres + Redis + Kafka UI
├── infra/postgres/init/        # creates one database per service on first boot
├── libs/shared/                # the ONLY thing services share: typed event contracts
├── services/
│   ├── api-gateway/            # edge: auth, rate limit, tracing, reverse proxy
│   ├── order-service/          # order lifecycle + saga coordinator (all 3 idempotency layers)
│   ├── payment-service/        # charges; emits payments.completed/failed
│   ├── inventory-service/      # reserves/releases stock; emits inventory.reserved/rejected
│   └── notification-service/   # terminal consumer: "emails" the customer
├── load-tests/                 # k6 burst that PROVES idempotency + a cross-DB verifier
└── docs/                       # this guide, ADRs, sequence diagrams
```

**Golden rule of the architecture:** services share *contracts, not code or
databases*. The only import that crosses a service boundary is
`@ecommerce/shared` (event types). Each service owns its own Postgres database.

---

## 3. The shared contracts (`libs/shared`)

Start here — it's the vocabulary every service speaks.

| File | What it defines |
|---|---|
| [topics.ts](../libs/shared/src/events/topics.ts) | Every Kafka topic name as a constant (`Topics.ORDERS_CREATED`, …) + the `*.DLQ` names |
| [envelope.ts](../libs/shared/src/events/envelope.ts) | `EventEnvelope` — the wrapper around every event |
| [event-factory.ts](../libs/shared/src/events/event-factory.ts) | `createEvent()` — builds a well-formed envelope with a unique `eventId` |
| [order-events.ts](../libs/shared/src/events/order-events.ts) · [payment-events.ts](../libs/shared/src/events/payment-events.ts) · [inventory-events.ts](../libs/shared/src/events/inventory-events.ts) | Strongly-typed payloads per event |
| [dlq.ts](../libs/shared/src/events/dlq.ts) | `dlqForTopic()` mapping + `DeadLetterEnvelope` |

### The event envelope (the most important shape in the system)

Every message on Kafka looks like this ([envelope.ts](../libs/shared/src/events/envelope.ts)):

```ts
{
  eventId,        // UUID of THIS event instance — the dedup key (Layer 3)
  eventType,      // e.g. "orders.created"
  version,        // payload schema version
  occurredAt,     // ISO timestamp
  correlationId,  // shared across ALL events of one checkout — for tracing
  aggregateId,    // the order id; also the Kafka partition key
  producer,       // which service emitted it
  payload,        // the typed business data
}
```

Two fields do the heavy lifting:
- **`eventId`** → consumers dedup on this (a redelivered event has the same id).
- **`correlationId`** → ties every event of one checkout together so you can trace it end-to-end.

---

## 4. The three idempotency layers (the heart of the project)

Duplicates can enter at three boundaries, so idempotency is enforced at all three.
**The pattern that makes each one correct: the dedup record and the side effect
are written in the SAME database transaction.**

### Layer 1 — HTTP request (client → order-service)

**Goal:** a double-click or client retry must not create a second order.

Code: [idempotency.service.ts](../services/order-service/src/idempotency/idempotency.service.ts) · table `idempotency_keys`

Flow inside `IdempotencyService.execute(key, body, work)`:
1. Fast path: check Redis for a cached completed response → return it.
2. Check the `idempotency_keys` table (source of truth).
3. New key → run `work(tx)` **and** write the key row in one transaction; cache the response.
4. Duplicate key, `COMPLETED` → return the cached response (no new order).
5. Duplicate key, `IN_PROGRESS` → `409` (the first request is still running).
6. Same key, different body hash → `422` (client bug surfaced).

The header is required and validated by [idempotency-key.decorator.ts](../services/order-service/src/idempotency/idempotency-key.decorator.ts).

### Layer 2 — Reliable publishing (the transactional outbox)

**Goal:** an order can never exist without its event, and vice-versa (the
"dual-write problem").

Code: [outbox.service.ts](../services/order-service/src/outbox/outbox.service.ts) (write side) + [outbox-relay.service.ts](../services/order-service/src/outbox/outbox-relay.service.ts) (publish side) · table `outbox_events`

- **Write side:** `OutboxService.enqueue(tx, topic, event)` inserts the event into
  `outbox_events` **using the same `tx`** as the business write. Atomic.
- **Publish side:** `OutboxRelayService` polls every second for rows where
  `publishedAt IS NULL`, publishes them to Kafka, and **only then** sets
  `publishedAt`. If it crashes after publishing but before marking, the row is
  re-sent (at-least-once) — which Layer 3 absorbs.

### Layer 3 — Idempotent consumers (Kafka → each service)

**Goal:** a redelivered event must not advance the saga / charge / reserve twice.

Code: the `processOnce()` helper, present in every consuming service:
[order](../services/order-service/src/consumers/idempotent-consumer.ts) ·
[payment](../services/payment-service/src/common/idempotent-consumer.ts) ·
[inventory](../services/inventory-service/src/common/idempotent-consumer.ts) ·
[notification](../services/notification-service/src/common/idempotent-consumer.ts) · table `processed_events`

```ts
processOnce(prisma, consumer, event, logger, async (tx) => {
  // INSERT (eventId, consumer) into processed_events   ← throws P2002 if seen before
  // ...do the real work using the same tx...
});                                                     // both commit together
```

If the event was already processed, the `INSERT` hits the unique constraint
(`P2002`) and we skip — a safe no-op. If the work throws, the whole transaction
(including the dedup row) rolls back, so Kafka redelivers and we try again
cleanly. **At-least-once delivery becomes effectively-exactly-once processing.**

---

## 5. End-to-end walkthrough: one checkout, file by file

Follow a single order through the system.

### Step 1 — Request hits the gateway
[orders.proxy.controller.ts](../services/api-gateway/src/proxy/orders.proxy.controller.ts)
- `JwtAuthGuard` verifies the Bearer token → sets `req.user.customerId`.
- `RateLimitGuard` checks the Redis counter.
- `RequestIdMiddleware` ensured an `X-Request-Id` exists.
- The controller injects `customerId` **from the token** into the body and
  proxies to order-service via [proxy.service.ts](../services/api-gateway/src/proxy/proxy.service.ts),
  forwarding the `Idempotency-Key` and `X-Request-Id`.

### Step 2 — Order is created (atomically with its event)
[orders.controller.ts](../services/order-service/src/orders/orders.controller.ts)
→ [orders.service.ts](../services/order-service/src/orders/orders.service.ts) `createOrder()`
- Wrapped in `IdempotencyService.execute()` (Layer 1).
- Inside one transaction: insert `orders` + `order_items`, then
  `outbox.enqueue(tx, ORDERS_CREATED, event)` (Layer 2).
- Responds `201` immediately. **The customer's request is now done** — everything
  else is asynchronous.

### Step 3 — The relay publishes `orders.created`
[outbox-relay.service.ts](../services/order-service/src/outbox/outbox-relay.service.ts)
picks up the row and publishes to Kafka. The Kafka plumbing
([kafka-producer.service.ts](../services/order-service/src/kafka/kafka-producer.service.ts))
keys the message by `orderId` so all events for one order stay ordered.

### Step 4 — Payment and Inventory react in parallel
Both subscribe to `orders.created`:
- **Payment** [order-events.consumer.ts](../services/payment-service/src/payments/order-events.consumer.ts)
  → [payments.service.ts](../services/payment-service/src/payments/payments.service.ts) `charge()`:
  creates a `payments` row and emits `payments.completed` **or** `payments.failed`
  (declined when the total ends in `13` cents — the demo trigger).
- **Inventory** [inventory-events.consumer.ts](../services/inventory-service/src/inventory/inventory-events.consumer.ts)
  → [inventory.service.ts](../services/inventory-service/src/inventory/inventory.service.ts) `reserve()`:
  moves stock from `availableQty`→`reservedQty`, writes a `reservations` row, emits
  `inventory.reserved` **or** `inventory.rejected`.

Both wrap their work in `processOnce()` (Layer 3) and use their own outbox+relay
to emit results.

### Step 5 — Order-service settles the saga
[saga.consumer.ts](../services/order-service/src/consumers/saga.consumer.ts)
listens to all four outcomes and calls
[orders.service.ts](../services/order-service/src/orders/orders.service.ts) `applyLegOutcome()`:
- Records the leg result (`paymentStatus` / `inventoryStatus` on the `orders` row).
- **Both succeeded** → status `CONFIRMED`, emit `orders.confirmed`.
- **Either failed** → status `CANCELLED`, emit `orders.cancelled`.

### Step 6 — Side effects of settlement
- **Notification** [notification-events.consumer.ts](../services/notification-service/src/notifications/notification-events.consumer.ts)
  consumes `orders.confirmed` / `payments.failed` → writes a `notifications` row ("email sent").
- **Inventory compensation:** on `orders.cancelled`,
  [inventory.service.ts](../services/inventory-service/src/inventory/inventory.service.ts) `release()`
  returns the reserved stock — guarded by reservation status so a redelivered
  cancel never double-restores.

See the rendered diagrams: [happy path](sequence-diagrams/checkout-happy-path.md) ·
[failure/compensation path](sequence-diagrams/checkout-failure-path.md).

---

## 6. The saga as a state machine

The `orders` row carries the saga state ([schema.prisma](../services/order-service/prisma/schema.prisma)):

```
status:          PENDING ──► CONFIRMED        (paymentStatus=SUCCEEDED AND inventoryStatus=SUCCEEDED)
                 PENDING ──► CANCELLED        (paymentStatus=FAILED OR inventoryStatus=FAILED)
paymentStatus:   PENDING ──► SUCCEEDED | FAILED
inventoryStatus: PENDING ──► SUCCEEDED | FAILED
```

`applyLegOutcome()` is the transition function. It's idempotent twice over: the
consumer dedup (Layer 3) prevents reprocessing, and it also early-returns if the
order isn't `PENDING` anymore, so a late event can't un-settle a finished order.

---

## 7. Per-service quick reference

| Service | Port | Key entry points | Owns (DB tables) | Emits | Consumes |
|---|---|---|---|---|---|
| **api-gateway** | 3000 | [orders.proxy.controller](../services/api-gateway/src/proxy/orders.proxy.controller.ts) | — (stateless; Redis counters) | — | — |
| **order-service** | 3001 | [orders.service](../services/order-service/src/orders/orders.service.ts), [saga.consumer](../services/order-service/src/consumers/saga.consumer.ts) | orders, order_items, idempotency_keys, outbox_events, processed_events | orders.created/confirmed/cancelled | payments.*, inventory.* |
| **payment-service** | 3002 | [payments.service](../services/payment-service/src/payments/payments.service.ts) | payments, outbox_events, processed_events | payments.completed/failed | orders.created |
| **inventory-service** | 3003 | [inventory.service](../services/inventory-service/src/inventory/inventory.service.ts) | products, reservations, outbox_events, processed_events | inventory.reserved/rejected | orders.created, orders.cancelled |
| **notification-service** | 3004 | [notifications.service](../services/notification-service/src/notifications/notifications.service.ts) | notifications, processed_events | — (terminal) | orders.confirmed, payments.failed |

**Note the asymmetry:** notification-service has no outbox/producer because it
emits nothing. You only add the outbox to a service that publishes events.

### Anatomy of a service (they all share this shape)

```
src/
├── main.ts                 # bootstrap; starts HTTP + Kafka consumer + outbox relay
├── app.module.ts           # wires the modules together
├── config/configuration.ts # typed env config
├── prisma/                 # PrismaService + the service's OWN generated client (ADR 0006)
├── kafka/                  # producer + consumer (consumer has retry+DLQ built in)
├── outbox/                 # enqueue (write side) + relay (publish side)   [except notification]
├── common|consumers/       # processOnce() dedup helper
└── <domain>/               # the actual business logic + its event consumer
```

---

## 8. Reliability mechanics (DLQ + retry)

Built into every consumer ([kafka-consumer.service.ts](../services/order-service/src/kafka/kafka-consumer.service.ts)):

- Handler throws → **retry** up to `CONSUMER_MAX_RETRIES` (default 3) with linear backoff.
- Still failing → publish a `DeadLetterEnvelope` (original event + error + attempt
  count + consumer group) to the source topic's **`*.DLQ`**, then commit the offset
  so one poison message can't block the partition.
- Unparseable messages skip retries and go straight to the DLQ.

Why retries are safe: handlers are idempotent and transactional, so a failed
attempt leaves no partial state. Details in [ADR 0005](adr/0005-dlq-and-retry-policy.md).

---

## 9. Infrastructure

[docker-compose.yml](../docker-compose.yml) brings up:
- **Kafka** in KRaft mode (no Zookeeper). `kafka-init` declares all topics as code
  (6 partitions each for parallelism + the `*.DLQ` topics).
- **Postgres** — [01-create-databases.sql](../infra/postgres/init/01-create-databases.sql)
  creates one database per service on first boot.
- **Redis** — idempotency fast-path (order-service) + rate-limit counters (gateway).
- **Kafka UI** at <http://localhost:8080> to watch topics, partitions, and consumer lag.

### A monorepo gotcha worth knowing ([ADR 0006](adr/0006-per-service-prisma-client.md))
Each service generates its **own** Prisma client into `src/generated/prisma` and
imports it through the barrel `src/prisma/client.ts`. Without this, npm's hoisting
made all services share one client and clobber each other. `nest-cli.json` copies
the generated client into `dist` at build time so the runtime works too.

---

## 10. How to run & trace it

```bash
docker compose up -d                       # infra
npm install && npm run build -w @ecommerce/shared

# per service (order/payment/inventory/notification):
cd services/<svc> && cp -n .env.example .env && npx prisma migrate dev --name init && npm run start:dev
# and the gateway:
cd services/api-gateway && cp -n .env.example .env && npm run start:dev
```

**Trace a request:** every event carries the same `correlationId`; grep your
service logs for it to follow one checkout across all services. The
`X-Request-Id` from the gateway is the entry point of that trace.

**Prove idempotency:** run [load-tests/](../load-tests/) — fire one
`Idempotency-Key` 100× and `verify.sh` confirms exactly one order/payment/
reservation/notification across the four databases.

---

## 11. Pattern glossary (where each lives)

| Pattern | One-line meaning | Code |
|---|---|---|
| Database-per-service | Each service owns its DB; no shared tables | [init sql](../infra/postgres/init/01-create-databases.sql) |
| Idempotency key | Dedup HTTP requests | [idempotency.service.ts](../services/order-service/src/idempotency/idempotency.service.ts) |
| Transactional outbox | Atomic state-change + event | [outbox.service.ts](../services/order-service/src/outbox/outbox.service.ts) |
| Polling relay | Forward outbox rows to Kafka | [outbox-relay.service.ts](../services/order-service/src/outbox/outbox-relay.service.ts) |
| Consumer dedup | Process each event once | [idempotent-consumer.ts](../services/order-service/src/consumers/idempotent-consumer.ts) |
| Choreography saga | Distributed tx via events + compensation | [saga.consumer.ts](../services/order-service/src/consumers/saga.consumer.ts) |
| Dead-letter queue | Quarantine poison messages | [kafka-consumer.service.ts](../services/order-service/src/kafka/kafka-consumer.service.ts) |
| API gateway | Edge auth/limit/trace/proxy | [orders.proxy.controller.ts](../services/api-gateway/src/proxy/orders.proxy.controller.ts) |

---

*Tip: read this guide alongside the [sequence diagrams](sequence-diagrams/) open in
one pane and the linked source files in another — the flow clicks fast that way.*
