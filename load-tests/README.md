# Load Tests — Proving Idempotency

This is the **evidence** behind the architecture: a load test that hammers the
checkout with duplicate requests and a verifier that confirms the system created
**exactly one** of everything.

## What it proves

`idempotency-burst.js` fires the **same `Idempotency-Key`** at `POST /orders`:

- **Phase A — the race:** `BURST` (default 100) identical requests fired
  *concurrently*. Exactly one wins and creates the order; the rest either replay
  it or get `409 In-Progress`. The test asserts all `201` responses carry **one
  and the same order id**.
- **Phase B — the retries:** the same key fired again, now that it's completed.
  Every response must be `201`, return the **same order id**, and be flagged
  `Idempotent-Replayed: true`.

If any invariant breaks, the run fails (k6 thresholds: `checks rate==1.0` and
`distinct_orders_created count==1`).

`verify.sh` then queries **all four service databases** and confirms the burst
produced a single order, payment, reservation, and notification — proof the
guarantee holds end-to-end, not just at the HTTP layer.

## Prerequisites

- Infra + all services running (see the [root README](../README.md) "Running the full flow").
- [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) installed
  (`brew install k6`, `sudo apt install k6`, or `docker run grafana/k6`).

## Run it

```bash
# 1. fire the burst
k6 run load-tests/idempotency-burst.js
#    optionally: k6 run -e BURST=200 load-tests/idempotency-burst.js

# 2. copy the ORDER_ID + CUSTOMER_ID it prints, then verify across DBs
ORDER_ID=<printed-uuid> CUSTOMER_ID=<printed-uuid> ./load-tests/verify.sh
```

Expected verifier output:

```
│  orders (for customer)       │  1       │  1
│  payments (for order)        │  1       │  1
│  reservations (for order)    │  1       │  1
│  notifications (for order)   │  1       │  1
✅  Exactly one order created from the entire burst. Idempotency holds.
```

> The saga is asynchronous, so payments/reservations/notifications may read `0`
> for a second right after the burst. Re-run `verify.sh` and they settle to `1`.

## The one-liner for the recruiter

> *"I fire the same idempotency key 200 times concurrently; the database ends
> with exactly one order, one charge, one reservation, one email. Here's the
> test that proves it."*
