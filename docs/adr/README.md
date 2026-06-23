# Architecture Decision Records (ADRs)

An ADR captures a single significant architectural decision: the context, the
choice made, and the trade-offs accepted. They document *why* the system looks
the way it does — the questions a senior engineer or interviewer will ask.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-event-driven-microservices.md) | Event-driven microservices over a monolith | Accepted |
| [0002](0002-transactional-outbox-polling-relay.md) | Transactional outbox with a polling relay | Accepted |
| [0003](0003-choreography-saga.md) | Choreography-based saga for distributed transactions | Accepted |
| [0004](0004-idempotency-three-layers.md) | Idempotency enforced at three layers | Accepted |
| [0005](0005-dlq-and-retry-policy.md) | Dead-letter queue + consumer retry policy | Accepted |
| [0006](0006-per-service-prisma-client.md) | Per-service generated Prisma client | Accepted |
