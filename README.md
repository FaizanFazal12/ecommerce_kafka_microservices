# Scalable E-Commerce Platform — Event-Driven Microservices

> A portfolio project demonstrating **idempotency**, **Kafka-based event-driven architecture**, and **resilient distributed-transaction design** for a high-throughput e-commerce checkout.

**Stack:** Node.js · NestJS · TypeScript · Apache Kafka · PostgreSQL · Redis · Docker Compose

---

## 1. The Problem This Solves

A checkout is the highest-stakes path in e-commerce. Two failures must *never* happen:

1. **Double charging** a customer because they clicked "Pay" twice, or the network retried a request.
2. **Overselling** the last item in stock because two orders raced each other.

At scale, the network *will* retry, services *will* crash mid-operation, and messages *will* be redelivered. This project is designed around that reality: **every operation is safe to execute more than once.** That property — idempotency — is what makes the system horizontally scalable without corrupting data.

---

## 2. Architecture at a Glance

```
                         ┌───────────────┐
   Client ──HTTP──▶      │  API Gateway  │   (rate-limit, auth, request-id)
   (Idempotency-Key)     └───────┬───────┘
                                 │ HTTP (sync, only to create the order)
                                 ▼
                         ┌───────────────┐        writes to DB + outbox
                         │ Order Service │────────────┐  (same TX)
                         └───────┬───────┘            ▼
                                 │              ┌────────────┐
                                 │   outbox relay (polling)  │
                                 │              └─────┬──────┘
                                 ▼                    ▼
        ┌──────────────────── Apache Kafka ───────────────────────┐
        │  topics: orders.created  payments.*  inventory.*  ...   │
        └──┬──────────────┬───────────────────┬──────────────────┘
           ▼              ▼                    ▼
   ┌──────────────┐ ┌──────────────┐  ┌──────────────────┐
   │   Payment    │ │  Inventory   │  │  Notification    │
   │   Service    │ │   Service    │  │  Service (email) │
   └──────────────┘ └──────────────┘  └──────────────────┘
   each consumer is IDEMPOTENT: a redelivered event is a no-op
```

**Why events instead of synchronous calls?** Synchronous chains fail as a unit — if Notification is down, the whole checkout 500s. With Kafka, the order is accepted the instant it's persisted; payment, inventory, and email happen asynchronously and **independently scale, retry, and recover**. Each service consumes at its own pace; a slow email provider can't slow down checkout.

---

## 3. Services & Responsibilities

| Service | Owns | Publishes | Consumes |
|---|---|---|---|
| **API Gateway** | Auth, rate limiting, request tracing | — | — |
| **Order Service** | Order lifecycle (`PENDING → CONFIRMED / CANCELLED`) | `orders.created` | `payments.completed`, `payments.failed`, `inventory.reserved`, `inventory.rejected` |
| **Payment Service** | Charging, refunds | `payments.completed`, `payments.failed` | `orders.created` |
| **Inventory Service** | Stock reservation & release | `inventory.reserved`, `inventory.rejected` | `orders.created`, `orders.cancelled` |
| **Notification Service** | Emails / push | — | `orders.confirmed`, `payments.failed` |

Each service owns its **own database** (database-per-service) — no shared tables, no cross-service joins. State is synced only through events.

---

## 4. The Core Story: Idempotency at Three Layers

This is the part to walk a recruiter through. Idempotency isn't one trick — it's enforced at every boundary where a duplicate can enter.

### Layer 1 — HTTP request idempotency (client → Order Service)

The client generates an **`Idempotency-Key`** (a UUID) and sends it as a header. The Order Service stores it:

```sql
CREATE TABLE idempotency_keys (
  key          UUID PRIMARY KEY,
  request_hash TEXT NOT NULL,        -- hash of the request body
  response     JSONB,               -- cached response once computed
  status       TEXT NOT NULL,       -- IN_PROGRESS | COMPLETED
  created_at   TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ
);
```

Flow:
1. `INSERT ... ON CONFLICT DO NOTHING` on the key.
2. **New key** → process the order, save the response, return it.
3. **Duplicate key, COMPLETED** → return the *cached* response (same order, no new charge).
4. **Duplicate key, IN_PROGRESS** → return `409 Conflict` (request still running — client should back off).
5. **Same key but different `request_hash`** → return `422` (client reused a key for a different payload — a bug worth surfacing).

> Redis fronts this table as a fast-path cache; Postgres is the source of truth.

### Layer 2 — Reliable publishing (the Transactional Outbox)

A classic bug: you write the order to the DB, then crash *before* publishing to Kafka — now the order exists but no one knows. The fix is the **outbox pattern**: the event is written to an `outbox` table **in the same database transaction** as the order.

```
BEGIN;
  INSERT INTO orders (...);
  INSERT INTO outbox (topic, payload, ...);   -- same TX → atomic
COMMIT;
```

A separate **polling-worker relay** (a NestJS background worker) reads unpublished rows from the outbox and publishes to Kafka **at-least-once**, marking each row published after the broker acks. This guarantees: *if the order is committed, the event will be published* — no lost events, no phantom orders.

> **Design choice:** we use a polling worker over Debezium CDC for clarity — it's pure Node.js, trivial to run in `docker-compose`, and easy to walk through in an interview. (Debezium is noted as the production-grade evolution in `docs/adr`.)

### Layer 3 — Idempotent consumers (Kafka → each service)

Kafka delivers **at-least-once**, so every consumer must tolerate redelivery. Each service keeps a `processed_events` table:

```sql
CREATE TABLE processed_events (
  event_id     UUID PRIMARY KEY,    -- the event's unique id
  consumer     TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now()
);
```

Consumer logic, all in one transaction:
```
BEGIN;
  INSERT INTO processed_events (event_id, consumer) VALUES (...) 
    ON CONFLICT DO NOTHING;          -- already processed? row count = 0
  -- if already processed → COMMIT and skip (no double charge)
  -- else → do the work (charge / reserve stock) + write own outbox
COMMIT;
```

This turns Kafka's at-least-once into **effectively-exactly-once** processing — the holy grail for payments.

---

## 5. Distributed Transactions: the Saga (Choreography)

There's no global lock across services. A checkout is a **saga** — a sequence of local transactions, each with a compensating action if a later step fails. This project uses **choreography** (services react to each other's events; no central coordinator) for maximum decoupling. *(Orchestration — a central Order coordinator dictating each step — is the alternative; see `docs/adr` for the trade-off.)*

**Happy path:**
```
orders.created
   ├─▶ Payment: charge        ──▶ payments.completed
   └─▶ Inventory: reserve      ──▶ inventory.reserved
Order Service sees BOTH success ──▶ order CONFIRMED ──▶ orders.confirmed ──▶ email
```

**Failure path (payment fails after stock reserved):**
```
payments.failed  ──▶ Order Service marks CANCELLED
                 ──▶ orders.cancelled
Inventory consumes orders.cancelled ──▶ RELEASE stock (compensating action)
```

Because every step is idempotent, the saga can be safely retried at any point without side effects.

---

## 6. How This Scales (the recruiter pitch)

- **Horizontal scaling via partitions.** Topics are partitioned by `order_id` (or `customer_id`). Add consumer instances up to the partition count and throughput grows linearly — each partition is processed by exactly one consumer in the group, preserving per-key ordering.
- **No synchronous fan-out.** Checkout latency = one DB write. Everything heavy is async.
- **Backpressure is free.** If Payment slows, its topic lag grows but checkout stays fast; it catches up when healthy.
- **Failure isolation.** A crashed Notification service loses zero orders — it resumes from its committed offset.
- **Replayability.** Events are retained; a new service (e.g. Analytics) can be added later and replay history from offset 0.

---

## 7. Reliability Details Worth Mentioning

| Concern | Mechanism |
|---|---|
| Lost events | Transactional outbox + at-least-once relay |
| Duplicate events | `processed_events` dedup table per consumer |
| Poison messages | Dead-letter topic (`*.DLQ`) after N retries |
| Ordering | Partition key = `order_id` |
| Schema evolution | Schema Registry + Avro/JSON (backward-compatible) |
| Observability | Correlation/request id propagated through every event header |

---

## 8. Tech Stack & Why

- **NestJS** — opinionated DI/module structure that reads like enterprise code; built-in microservice + Kafka transport.
- **PostgreSQL** — transactional guarantees the outbox/idempotency tables depend on. Prisma or TypeORM.
- **Redis** — idempotency-key fast path + rate limiting.
- **Kafka (KRaft mode)** — the event backbone. Run via `docker-compose`.
- **Docker Compose** — one command spins up Kafka + Postgres + all services.

---

## 9. Project Layout (planned)

```
.
├── README.md                     ← this file (the architecture story)
├── docs/
│   ├── adr/                      ← Architecture Decision Records
│   ├── sequence-diagrams/
│   └── api/                      ← OpenAPI specs
├── docker-compose.yml
├── libs/
│   └── shared/                   ← event contracts, idempotency middleware
└── services/
    ├── api-gateway/
    ├── order-service/
    ├── payment-service/
    ├── inventory-service/
    └── notification-service/
```

---

## 10. Roadmap

- [x] Architecture design (this document) + ADRs + sequence diagrams
- [x] Event contracts in `libs/shared` (typed event schemas)
- [x] `docker-compose.yml` (Kafka KRaft + Postgres + Redis + Kafka UI)
- [x] Order Service: HTTP idempotency + outbox + relay + saga consumers ✅ *typecheck passing*
- [x] Payment & Inventory: idempotent consumers + saga + compensation ✅ *typecheck passing*
- [ ] Notification Service
- [ ] DLQ + retry policy
- [ ] Load test (k6) showing duplicate requests → single charge

> **End-to-end status:** the full saga now runs — `orders.created` → Payment +
> Inventory react in parallel → Order Service settles to `CONFIRMED` or
> `CANCELLED` → Inventory compensates on cancel. See "Running the full flow" below.

---

## Running the full flow

```bash
# 1. Infrastructure (Kafka + Postgres + Redis + Kafka UI)
docker compose up -d

# 2. Install everything once from the repo root
npm install
npm run build -w @ecommerce/shared

# 3. In three terminals, prepare + run each service
#    (each: copy env, create its tables, start)
( cd services/order-service     && cp -n .env.example .env && npx prisma migrate dev --name init && npm run start:dev )
( cd services/payment-service   && cp -n .env.example .env && npx prisma migrate dev --name init && npm run start:dev )
( cd services/inventory-service && cp -n .env.example .env && npx prisma migrate dev --name init && npm run start:dev )
```

**Place an order (happy path):**
```bash
curl -s -X POST localhost:3001/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{ "customerId": "11111111-1111-1111-1111-111111111111",
        "items": [ { "productId": "22222222-2222-2222-2222-222222222222", "quantity": 2, "unitPriceCents": 2000 } ] }'

# total = 4000 cents -> payment succeeds, stock reserved -> order CONFIRMED
# GET the order to watch it go PENDING -> CONFIRMED:
curl -s localhost:3001/orders/<orderId>
```

**Trigger the failure/compensation path** — make the total end in `13` cents
(the payment service's "declined test card"):
```bash
# unitPriceCents 2013 x1 -> total 2013 -> payment DECLINED
#   -> Order CANCELLED -> Inventory releases the stock it had reserved
```

Watch every event hop live in **Kafka UI** at <http://localhost:8080>.

| Service | Port | Role in the flow |
|---|---|---|
| order-service | 3001 | accepts orders, coordinates the saga |
| payment-service | 3002 | charges (declines totals ending in `13`) |
| inventory-service | 3003 | reserves stock, releases on cancel |

---

### TL;DR for the recruiter
> *"It's an event-driven e-commerce checkout on Kafka where every operation is idempotent at three layers — HTTP, publishing (transactional outbox), and consumption (dedup tables) — so duplicate requests and Kafka redeliveries can never double-charge or oversell. Distributed transactions use the saga pattern with compensating actions. It scales horizontally by Kafka partitions with zero synchronous fan-out."*
