# Checkout — Happy Path

Both payment and inventory succeed; the order is confirmed and the customer is emailed.
Every Kafka hop is at-least-once; idempotency makes redelivery safe at each consumer.

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant O as Order Service
    participant DB as Order DB (+outbox)
    participant R as Outbox Relay
    participant K as Kafka
    participant P as Payment Service
    participant I as Inventory Service
    participant N as Notification Service

    C->>O: POST /orders (Idempotency-Key)
    Note over O,DB: Layer 1 — HTTP idempotency check
    O->>DB: BEGIN; INSERT order + INSERT outbox; COMMIT
    O-->>C: 201 Created (order PENDING)

    Note over R,K: Layer 2 — reliable publishing
    R->>DB: poll unpublished outbox rows
    R->>K: publish orders.created
    K-->>R: ack
    R->>DB: mark row published

    K-->>P: orders.created
    K-->>I: orders.created

    Note over P: Layer 3 — dedup on event_id
    P->>P: charge card (idempotent)
    P->>K: payments.completed

    Note over I: Layer 3 — dedup on event_id
    I->>I: reserve stock (idempotent)
    I->>K: inventory.reserved

    K-->>O: payments.completed
    K-->>O: inventory.reserved
    Note over O: both outcomes positive
    O->>DB: order -> CONFIRMED (+outbox)
    R->>K: publish orders.confirmed
    K-->>N: orders.confirmed
    N->>N: send confirmation email
```

**Key point:** the client's request (steps 1–3) completes after a single DB
commit. Everything after step 4 is asynchronous and independently scalable.
