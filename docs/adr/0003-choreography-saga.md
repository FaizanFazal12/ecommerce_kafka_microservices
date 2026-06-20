# ADR 0003 — Choreography-Based Saga for Distributed Transactions

**Status:** Accepted

## Context

A checkout spans three services that each own their own database: Order,
Payment, Inventory. There is no distributed ACID transaction across them (a
deliberate consequence of [ADR 0001](0001-event-driven-microservices.md)). Yet
the business needs all-or-nothing semantics: if payment fails after stock was
reserved, that stock must be released.

The **saga** pattern provides this: a sequence of local transactions, each with a
**compensating action** that undoes it if a later step fails.

## Decision

Implement the saga using **choreography**: each service reacts to events and
emits its own, with no central coordinator.

```
orders.created ─┬─▶ Payment   charges  ─▶ payments.completed / payments.failed
                └─▶ Inventory reserves ─▶ inventory.reserved / inventory.rejected

Order Service listens to the outcomes:
  both succeeded            → order CONFIRMED  → orders.confirmed
  payment failed            → order CANCELLED  → orders.cancelled
       └─▶ Inventory consumes orders.cancelled → releases stock (compensation)
```

Because every step is idempotent ([ADR 0004](0004-idempotency-three-layers.md)),
the saga can be safely retried at any point.

## Consequences

**Positive**
- Maximum decoupling — no service is a coordinator or a single point of failure.
- Easy to add a participant: it just subscribes to the relevant topic.
- Naturally event-driven; fits the Kafka backbone with no extra moving parts.

**Negative / costs accepted**
- The end-to-end flow is **implicit** — it lives across services, not in one place,
  which is harder to visualise (mitigated by the sequence diagrams in `docs/`).
- Risk of cyclic event chains if not designed carefully.
- Compensation logic must be written and tested for every failure branch.

## Alternatives considered

- **Orchestration saga.** A central Order orchestrator issues commands
  (`ChargePayment`, `ReserveStock`) and tracks state in one place — easier to
  reason about and monitor for complex flows. Rejected here because the flow is
  small and choreography better demonstrates decoupling; revisit if the saga
  grows more branches.
- **Two-phase commit (2PC).** Distributed locking across services; poor
  availability and scalability, and unsupported by the chosen stack. Rejected.
