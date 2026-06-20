# Checkout — Failure Path (Saga Compensation)

Inventory reserves stock, but payment is declined. The saga compensates: the
order is cancelled and the reserved stock is **released**.

```mermaid
sequenceDiagram
    autonumber
    participant K as Kafka
    participant P as Payment Service
    participant I as Inventory Service
    participant O as Order Service

    K-->>I: orders.created
    I->>I: reserve stock  ✅
    I->>K: inventory.reserved

    K-->>P: orders.created
    P->>P: charge card  ❌ declined
    P->>K: payments.failed

    K-->>O: payments.failed
    Note over O: saga decides: cancel
    O->>O: order -> CANCELLED (+outbox)
    O->>K: orders.cancelled

    Note over I: compensating action
    K-->>I: orders.cancelled
    I->>I: RELEASE previously reserved stock
```

**Key points**
- The compensation (releasing stock) is itself an **idempotent** consumer — if
  `orders.cancelled` is redelivered, stock is released only once.
- Order of arrival doesn't matter: whether payment fails before or after the
  reservation, the end state converges to CANCELLED + stock released.
- This is **eventual consistency** — there's a brief window where stock is
  reserved for an order that will be cancelled. Acceptable for checkout.
