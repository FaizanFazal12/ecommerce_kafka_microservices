#!/usr/bin/env bash
#
# End-to-end smoke test for the running platform.
# Exercises: auth -> happy-path order (CONFIRMED) -> failure-path order
# (CANCELLED + compensation) -> idempotency (same key twice = one order).
#
# Prereqs: all services running, `docker compose up -d`, and `curl`.
# Usage:   ./scripts/smoke-test.sh           (drives the API GATEWAY on :3000)
#          GATEWAY=http://localhost:3000 ./scripts/smoke-test.sh

set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:3000}"
ORDER="${ORDER:-http://localhost:3001}"
# A valid RFC-4122 UUID (version digit 4, variant digit 8) — the API validates this.
PRODUCT="11111111-1111-4111-8111-111111111111"

# --- tiny helpers ---------------------------------------------------------
uuid() { cat /proc/sys/kernel/random/uuid; }
# extract a top-level JSON string field without requiring jq
field() { sed -E "s/.*\"$1\":\"?([^\",}]+)\"?.*/\1/"; }
hr() { printf '─%.0s' {1..62}; echo; }

CUSTOMER="$(uuid)"
echo "Customer for this run: $CUSTOMER"
hr

# --- 0. health ------------------------------------------------------------
echo "0) Health checks"
for p in 3000 3001 3002 3003 3004; do
  s=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$p/health" || echo 000)
  echo "   :$p -> $s"
done
hr

# --- 1. get a JWT from the gateway ---------------------------------------
echo "1) Minting a token via the gateway"
TOKEN=$(curl -s -X POST "$GATEWAY/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$CUSTOMER\"}" | field accessToken)
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "   ❌ could not get token — is the gateway up on $GATEWAY?"; exit 1
fi
echo "   ✅ token acquired"
hr

# --- 2. happy path: total 4000c -> CONFIRMED ------------------------------
echo "2) HAPPY PATH — place an order (expect CONFIRMED)"
KEY=$(uuid)
RESP=$(curl -s -X POST "$GATEWAY/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT\",\"quantity\":2,\"unitPriceCents\":2000}]}")
ORDER_ID=$(echo "$RESP" | field id)
echo "   order id: $ORDER_ID"
echo -n "   settling"
for _ in $(seq 1 10); do
  sleep 1; echo -n "."
  STATUS=$(curl -s "$GATEWAY/orders/$ORDER_ID" -H "Authorization: Bearer $TOKEN" | field status)
  [ "$STATUS" = "CONFIRMED" ] || [ "$STATUS" = "CANCELLED" ] && break
done
echo " -> $STATUS"
[ "$STATUS" = "CONFIRMED" ] && echo "   ✅ CONFIRMED" || echo "   ⚠️  expected CONFIRMED, got $STATUS"
hr

# --- 3. failure path: total ends in 13c -> CANCELLED ----------------------
echo "3) FAILURE PATH — total ending in 13c is declined (expect CANCELLED + stock released)"
KEY=$(uuid)
RESP=$(curl -s -X POST "$GATEWAY/orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"productId\":\"$PRODUCT\",\"quantity\":1,\"unitPriceCents\":2013}]}")
FAIL_ID=$(echo "$RESP" | field id)
echo "   order id: $FAIL_ID"
echo -n "   settling"
for _ in $(seq 1 10); do
  sleep 1; echo -n "."
  STATUS=$(curl -s "$GATEWAY/orders/$FAIL_ID" -H "Authorization: Bearer $TOKEN" | field status)
  [ "$STATUS" = "CONFIRMED" ] || [ "$STATUS" = "CANCELLED" ] && break
done
echo " -> $STATUS"
[ "$STATUS" = "CANCELLED" ] && echo "   ✅ CANCELLED (saga compensated)" || echo "   ⚠️  expected CANCELLED, got $STATUS"
hr

# --- 4. idempotency: same key twice = ONE order ---------------------------
echo "4) IDEMPOTENCY — fire the SAME Idempotency-Key twice"
KEY=$(uuid)
BODY="{\"items\":[{\"productId\":\"$PRODUCT\",\"quantity\":1,\"unitPriceCents\":500}]}"
R1=$(curl -s -D - -o /tmp/b1 -X POST "$GATEWAY/orders" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json' -d "$BODY")
R2=$(curl -s -D - -o /tmp/b2 -X POST "$GATEWAY/orders" -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $KEY" -H 'Content-Type: application/json' -d "$BODY")
ID1=$(field id < /tmp/b1); ID2=$(field id < /tmp/b2)
REPLAYED=$(echo "$R2" | grep -i 'idempotent-replayed' | sed -E 's/.*: *//' | tr -d '\r')
echo "   1st order id: $ID1"
echo "   2nd order id: $ID2   (Idempotent-Replayed: ${REPLAYED:-?})"
[ "$ID1" = "$ID2" ] && echo "   ✅ same order id — no duplicate created" || echo "   ❌ different ids — idempotency broken!"
hr
echo "Done. For the heavy proof, run the k6 burst:  k6 run load-tests/idempotency-burst.js"
