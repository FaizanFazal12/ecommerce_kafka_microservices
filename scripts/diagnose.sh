#!/usr/bin/env bash
#
# Pinpoints where the event pipeline breaks when orders stay PENDING.
# Walks the chain: topics exist? -> order published its event? -> payment/
# inventory consumed it? -> order-service got the outcomes back?
#
# Usage: ./scripts/diagnose.sh

set -uo pipefail
PG="docker exec -i postgres psql -U ecommerce -tA"
hr() { printf '─%.0s' {1..62}; echo; }

echo "A) Kafka topics that exist"
docker exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/dev/null \
  | sort | sed 's/^/   /' || echo "   ❌ could not reach Kafka"
echo "   (expected: orders.created/confirmed/cancelled, payments.*, inventory.*, *.DLQ)"
hr

echo "B) order-service outbox — has the relay PUBLISHED the events?"
echo "   topic | publishedAt (NULL = not yet published by the relay)"
$PG -d order_service -c \
  'SELECT topic, COALESCE("publishedAt"::text, ''NULL — NOT PUBLISHED'') FROM outbox_events ORDER BY "createdAt" DESC LIMIT 8;' \
  2>/dev/null | sed 's/^/   /' || echo "   ❌ query failed"
hr

echo "C) Did PAYMENT consume orders.created and act?"
echo -n "   payments rows: ";      $PG -d payment_service   -c 'SELECT count(*) FROM payments;' 2>/dev/null
echo -n "   processed_events: ";   $PG -d payment_service   -c 'SELECT count(*) FROM processed_events;' 2>/dev/null
echo -n "   payment outbox unpublished: "; $PG -d payment_service -c 'SELECT count(*) FROM outbox_events WHERE "publishedAt" IS NULL;' 2>/dev/null
hr

echo "D) Did INVENTORY consume orders.created and act?"
echo -n "   reservations rows: ";  $PG -d inventory_service -c 'SELECT count(*) FROM reservations;' 2>/dev/null
echo -n "   processed_events: ";    $PG -d inventory_service -c 'SELECT count(*) FROM processed_events;' 2>/dev/null
echo -n "   inventory outbox unpublished: "; $PG -d inventory_service -c 'SELECT count(*) FROM outbox_events WHERE "publishedAt" IS NULL;' 2>/dev/null
hr

echo "E) Did ORDER-SERVICE receive the outcomes back? (saga dedup table)"
echo -n "   order-service processed_events: "; $PG -d order_service -c 'SELECT count(*) FROM processed_events;' 2>/dev/null
echo -n "   orders still PENDING: ";            $PG -d order_service -c "SELECT count(*) FROM orders WHERE status='PENDING';" 2>/dev/null
hr

echo "INTERPRETATION:"
echo "  • B shows NULL publishedAt  -> the RELAY isn't publishing (topics missing, or"
echo "    order-service can't reach Kafka). Check order-service logs for 'Relay tick failed'."
echo "  • B published but C/D are 0 -> payment/inventory aren't CONSUMING. Check their"
echo "    logs for a 'Consuming ...' line and any Kafka connection errors."
echo "  • C/D acted but E is 0      -> outcomes aren't getting back to order-service."
echo "    Check order-service logs for the saga consumer + payment/inventory relays."
