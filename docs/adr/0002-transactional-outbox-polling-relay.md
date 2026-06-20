# ADR 0002 — Transactional Outbox with a Polling Relay

**Status:** Accepted

## Context

When the Order Service accepts an order it must do two things: persist the order
to Postgres **and** publish an `orders.created` event to Kafka. These are two
separate systems and cannot share one transaction — this is the classic
**dual-write problem**:

- Write DB, then crash before publishing → order exists but no one is told (stuck order).
- Publish, then DB write fails → event for an order that doesn't exist (phantom order, double charge).

We need a guarantee: **if an order is committed, its event is eventually published — and never otherwise.**

## Decision

Use the **transactional outbox** pattern. The event is inserted into an `outbox`
table **in the same database transaction** as the order:

```sql
BEGIN;
  INSERT INTO orders (...);
  INSERT INTO outbox (topic, payload, ...);   -- atomic with the order
COMMIT;
```

A separate **polling relay** (a background worker) reads unpublished outbox rows,
publishes them to Kafka, waits for the broker ACK, then marks the row published.

## Consequences

**Positive**
- The dual-write problem is eliminated — order and event commit atomically.
- Pure application code; no extra infrastructure to run or learn.
- The relay is trivial to reason about and demo in an interview.

**Negative / costs accepted**
- **At-least-once** publishing: if the relay crashes after the ACK but before
  marking the row, the event is re-sent. Consumers must dedupe (see [ADR 0004](0004-idempotency-three-layers.md)).
- Polling adds small latency (poll interval) and DB load versus log-based CDC.
- The outbox table needs periodic cleanup of published rows.

## Alternatives considered

- **Debezium / log-based CDC.** Reads the Postgres WAL and streams changes to
  Kafka with lower latency and no polling load — the production-grade evolution.
  Rejected *for now* purely to keep the stack small and explainable; noted as the
  natural next step.
- **Kafka transactions (exactly-once semantics).** Doesn't span Postgres + Kafka,
  so it doesn't solve the dual-write problem on its own.
- **Publish directly, no outbox.** Simplest, but reintroduces the dual-write bug. Rejected.
