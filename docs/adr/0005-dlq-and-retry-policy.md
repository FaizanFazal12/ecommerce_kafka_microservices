# ADR 0005 — Dead-Letter Queue + Consumer Retry Policy

**Status:** Accepted

## Context

Kafka delivers at-least-once and a handler can fail for two very different reasons:

1. **Transient** — the database is briefly unavailable, a deadlock, a network blip.
   Retrying the same message shortly will likely succeed.
2. **Poison** — the message can never be processed: an unparseable payload, a bug,
   a permanently-invalid reference. Retrying forever just blocks the partition,
   because Kafka won't advance the offset past a message the handler keeps failing.

We need to absorb transient failures automatically without letting a single poison
message wedge a partition and halt all downstream processing.

## Decision

Each consumer applies a **bounded retry, then dead-letter** policy
([kafka-consumer.service.ts](../../services/order-service/src/kafka/kafka-consumer.service.ts)):

1. Run the handler. On throw, retry up to `CONSUMER_MAX_RETRIES` (default 3) with
   **linear backoff** (`CONSUMER_RETRY_BACKOFF_MS × attempt`).
2. If it still fails, publish a `DeadLetterEnvelope` (original event + failure
   metadata: consumer group, attempts, error, timestamp) to the source topic's
   **`*.DLQ`** topic, then return normally so the **offset commits** and the
   partition keeps moving.

In-handler retries are safe because handlers are idempotent: the dedup insert and
the work share one transaction ([ADR 0004](0004-idempotency-three-layers.md)), so a
failed attempt rolls back cleanly with nothing half-applied.

Unparseable messages skip retries — they can never succeed — and go straight to the DLQ.

## Consequences

**Positive**
- Transient failures self-heal within a few hundred milliseconds.
- A poison message is quarantined, not infinitely retried; the partition stays live.
- The DLQ envelope retains everything needed to diagnose and **replay** after a fix.
- Tunable per environment via two env vars.

**Negative / costs accepted**
- In-handler backoff briefly blocks that partition (bounded: retries × backoff).
  Acceptable for small `maxRetries`; a fully non-blocking design would use a
  separate retry topic with delay.
- Linear backoff is simple; exponential + jitter would be gentler under sustained
  outages.
- Nothing yet **consumes** the DLQ — it's a parking lot. A DLQ
  inspector/replayer is future work (the messages and metadata are ready for it).

## Alternatives considered

- **Infinite in-place retry.** Simplest, but one poison message halts the
  partition indefinitely. Rejected.
- **Drop on failure.** Never blocks, but silently loses data — unacceptable for orders/payments.
- **Dedicated retry topics with delay (e.g. `retry-5s`, `retry-1m`).** The
  non-blocking, production-grade evolution. Deferred to keep the model simple;
  noted as the next step.
