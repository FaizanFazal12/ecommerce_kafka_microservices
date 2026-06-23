# Order Service

The entry point and saga coordinator for the checkout. This service is the
centerpiece of the platform because it implements **all three idempotency
layers** described in the [root README](../../README.md) and the
[ADRs](../../docs/adr/).

## Responsibilities

- Accept `POST /orders` (the only synchronous entry point in the system).
- Persist the order and stage an `orders.created` event **atomically** (outbox).
- Drive the saga: listen to payment/inventory outcomes and settle the order to
  `CONFIRMED` or `CANCELLED`, emitting the corresponding event.

## Where each idempotency layer lives

| Layer | What it prevents | Code |
|-------|------------------|------|
| **1 — HTTP key** | Double-click / client retry → second order | [idempotency.service.ts](src/idempotency/idempotency.service.ts) |
| **2 — Outbox** | Crash between DB write and Kafka publish → lost/phantom event | [outbox.service.ts](src/outbox/outbox.service.ts) + [outbox-relay.service.ts](src/outbox/outbox-relay.service.ts) |
| **3 — Consumer dedup** | Kafka redelivery → saga advances twice | [idempotent-consumer.ts](src/consumers/idempotent-consumer.ts) |

The critical detail in all three: the dedup record and the side effect are
written in the **same database transaction**, so a crash can never leave them
inconsistent.

## Endpoints

```
POST /orders        Create an order. Requires header  Idempotency-Key: <uuid>
GET  /orders/:id    Fetch an order (incl. saga leg statuses)
GET  /health        Liveness
```

## Run it locally

```bash
# 1. from the repo root, bring up Kafka + Postgres + Redis
docker compose up -d

# 2. install deps and generate the Prisma client
cd services/order-service
cp .env.example .env
npm install
npx prisma migrate dev --name init      # creates the tables in order_service DB

# 3. start the service (HTTP + outbox relay + saga consumers all run together)
npm run start:dev
```

## Demo: idempotency in action

```bash
KEY=$(uuidgen)

# First call -> 201, creates the order
curl -i -X POST localhost:3001/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{
    "customerId": "22222222-2222-4222-8222-222222222222",
    "items": [
      { "productId": "11111111-1111-4111-8111-111111111111", "quantity": 2, "unitPriceCents": 1999 }
    ]
  }'

# Same key again -> 201 with header  Idempotent-Replayed: true
# Returns the SAME order id, and NO second order/outbox event is created.
curl -i -X POST localhost:3001/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d '{ "customerId": "22222222-2222-4222-8222-222222222222",
        "items": [ { "productId": "11111111-1111-4111-8111-111111111111", "quantity": 2, "unitPriceCents": 1999 } ] }'
```

Watch the event flow in Kafka UI at <http://localhost:8080> — you'll see exactly
**one** message on `orders.created` no matter how many times you retry the key.

## Notes / production follow-ups

- **DLQ:** the consumer skips unparseable messages; a real deployment would route
  to `orders.DLQ` after N failed attempts (the topic already exists).
- **Outbox cleanup:** a periodic job should delete `outbox_events` where
  `publishedAt` is older than retention.
- **Schema Registry:** payloads are JSON here; Avro + a registry would enforce
  backward-compatible evolution.
