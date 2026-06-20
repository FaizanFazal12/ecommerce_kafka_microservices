# ADR 0004 — Idempotency Enforced at Three Layers

**Status:** Accepted

## Context

At scale, duplicates are inevitable: users double-click "Pay", browsers and load
balancers retry requests, and Kafka guarantees only **at-least-once** delivery so
events get redelivered. In a payments system, a duplicate must never cause a
second charge or a double stock reservation.

Idempotency — the property that performing an operation more than once has the
same effect as performing it once — must be enforced at **every boundary where a
duplicate can enter**, not just one.

## Decision

Enforce idempotency at three distinct layers.

### Layer 1 — HTTP request (client → Order Service)
Client sends an `Idempotency-Key` (UUID) header. The service stores it with the
request hash and the cached response.
- New key → process, cache response.
- Duplicate key, completed → return the cached response (no new order/charge).
- Duplicate key, in-progress → `409`.
- Same key, different body hash → `422` (client bug surfaced).
Redis fronts this as a fast path; Postgres is the source of truth.

### Layer 2 — Reliable publishing (outbox)
Covered by [ADR 0002](0002-transactional-outbox-polling-relay.md): events commit
atomically with state, so no event is lost or duplicated *at the source*.

### Layer 3 — Idempotent consumers (Kafka → each service)
Each consumer keeps a `processed_events (event_id PK)` table and, in one
transaction: `INSERT ... ON CONFLICT DO NOTHING` the `event_id`, and only do the
work if the row was newly inserted. A redelivered event becomes a no-op.

## Consequences

**Positive**
- At-least-once delivery becomes **effectively-exactly-once** processing.
- Safe retries everywhere — the system can aggressively retry without corruption.
- Each layer is independently testable (the load test fires one key 100× → one charge).

**Negative / costs accepted**
- Extra tables (`idempotency_keys`, `processed_events`) and writes per request/event.
- Dedup tables grow and need TTL/cleanup.
- The `INSERT ON CONFLICT` + work must share one transaction, or a crash between
  them reintroduces duplicates — a correctness-critical detail to get right.

## Alternatives considered

- **Dedup at only one layer.** Cheaper, but a gap at any other boundary lets a
  duplicate through — the whole point is defence in depth. Rejected.
- **Kafka exactly-once semantics (EOS) only.** Helps producer→broker→consumer
  within Kafka, but doesn't cover the HTTP entry point or side effects on an
  external payment gateway. Necessary-but-insufficient; the dedup tables remain.
