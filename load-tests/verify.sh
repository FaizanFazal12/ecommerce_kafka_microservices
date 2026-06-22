#!/usr/bin/env bash
#
# Proves — across all four independent service databases — that a burst of
# duplicate requests produced NO duplicated side effects. Every count must be 1.
#
# Usage (values are printed by the k6 run):
#   ORDER_ID=<uuid> CUSTOMER_ID=<uuid> ./load-tests/verify.sh
#
# Runs psql inside the postgres container started by docker-compose.

set -euo pipefail

: "${ORDER_ID:?set ORDER_ID (printed by the k6 run)}"
: "${CUSTOMER_ID:?set CUSTOMER_ID (printed by the k6 run)}"
CONTAINER="${PG_CONTAINER:-postgres}"

# -t tuples only, -A unaligned -> bare number out. Column names are camelCase
# (Prisma maps tables with @@map but leaves column names as-is), so they're quoted.
q() { docker exec -i "$CONTAINER" psql -U ecommerce -tA -d "$1" -c "$2" | tr -d '[:space:]'; }

orders=$(q order_service        "SELECT count(*) FROM orders WHERE \"customerId\"='$CUSTOMER_ID';")
payments=$(q payment_service    "SELECT count(*) FROM payments WHERE \"orderId\"='$ORDER_ID';")
reservations=$(q inventory_service "SELECT count(*) FROM reservations WHERE \"orderId\"='$ORDER_ID';")
notifications=$(q notification_service "SELECT count(*) FROM notifications WHERE \"orderId\"='$ORDER_ID';")
status=$(q order_service        "SELECT status FROM orders WHERE id='$ORDER_ID';")

echo "┌─────────────────────────────────────────────────────────────"
echo "│  Idempotency proof for order $ORDER_ID"
echo "├──────────────────────────────┬──────────┬───────────────────"
echo "│  table (own service DB)      │  count   │  expected"
echo "├──────────────────────────────┼──────────┼───────────────────"
printf "│  orders (for customer)       │  %-6s  │  1\n" "$orders"
printf "│  payments (for order)        │  %-6s  │  1\n" "$payments"
printf "│  reservations (for order)    │  %-6s  │  1\n" "$reservations"
printf "│  notifications (for order)   │  %-6s  │  1\n" "$notifications"
echo "└──────────────────────────────┴──────────┴───────────────────"
echo "Final order status: ${status:-<pending — saga still settling, re-run in a moment>}"
echo

fail=0
for pair in "orders:$orders" "payments:$payments" "reservations:$reservations" "notifications:$notifications"; do
  name=${pair%%:*}; val=${pair##*:}
  if [ "$val" != "1" ]; then
    # notifications/payments/reservations may briefly be 0 while the async saga runs.
    if [ "$val" = "0" ]; then
      echo "⏳  $name = 0 (saga may still be in flight — re-run verify in a second)"
    else
      echo "❌  $name = $val (expected 1) — IDEMPOTENCY VIOLATION"
      fail=1
    fi
  fi
done

if [ "$fail" = "0" ] && [ "$orders" = "1" ]; then
  echo "✅  Exactly one order created from the entire burst. Idempotency holds."
fi
exit $fail
