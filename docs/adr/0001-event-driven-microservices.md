# ADR 0001 — Event-Driven Microservices over a Monolith

**Status:** Accepted

## Context

The checkout flow touches several distinct business capabilities: orders,
payments, inventory, and notifications. These capabilities have different
scaling profiles (payments is CPU-light but latency-sensitive; notifications is
bursty and tolerant of delay), different failure tolerances (a failed email must
never fail a checkout), and ideally different ownership.

We need an architecture that lets each capability **scale, deploy, and fail
independently**, while still coordinating a single checkout across all of them.

## Decision

Split the platform into independent microservices, each owning its own database
(**database-per-service** — no shared tables, no cross-service joins). Services
communicate **asynchronously through Kafka events**, not synchronous HTTP calls.

The only synchronous HTTP entry point is the client creating an order; from
there everything is event-driven.

## Consequences

**Positive**
- Independent horizontal scaling per service (via Kafka consumer groups + partitions).
- Failure isolation: a down service accrues consumer lag but loses no data and blocks no checkout.
- Loose coupling: services depend on event *contracts*, not on each other's code or DB.
- Replayability: new services can be added later and replay history from offset 0.

**Negative / costs accepted**
- No cross-service ACID transaction — we need a saga (see [ADR 0003](0003-choreography-saga.md)).
- Eventual consistency: an order is `PENDING` for a short window before confirmation.
- More operational surface (multiple services, a broker, schema management).
- Distributed debugging requires correlation ids propagated through every event.

## Alternatives considered

- **Modular monolith.** Simpler ops and real ACID transactions, but couples
  scaling and deployment, and doesn't demonstrate the distributed-systems skills
  this project is meant to showcase.
- **Synchronous microservices (REST/gRPC chains).** Still microservices, but a
  synchronous call chain fails as a unit and couples availability — if
  Notification is down, checkout 500s. Rejected for fragility.
