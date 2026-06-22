// k6 load test — proves HTTP idempotency (Layer 1) under concurrency.
//
// The claim: firing the SAME Idempotency-Key many times — concurrently and then
// again as retries — creates exactly ONE order and ONE charge.
//
// Run:
//   k6 run load-tests/idempotency-burst.js
//   k6 run -e BURST=200 -e ORDER_URL=http://localhost:3001 load-tests/idempotency-burst.js
//
// At the end it prints an ORDER_ID + CUSTOMER_ID you feed into verify.sh to
// confirm — across all four service databases — that nothing was duplicated.

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BURST = Number(__ENV.BURST || 100);
const BASE = __ENV.ORDER_URL || 'http://localhost:3001';

const createdOrders = new Counter('distinct_orders_created');

export const options = {
  vus: 1,
  iterations: 1,
  // The whole point is correctness, so fail the run if our invariants break.
  thresholds: {
    checks: ['rate==1.0'],
    distinct_orders_created: ['count==1'],
  },
};

// RFC-4122 v4 UUID (the API validates the key is a UUID).
function uuidv4() {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(Math.random() * 4)]; // variant 8-b
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

export default function () {
  const key = uuidv4();
  const customerId = uuidv4(); // fresh customer => order count for them is a clean proof
  const productId = uuidv4();
  const body = JSON.stringify({
    customerId,
    items: [{ productId, quantity: 2, unitPriceCents: 2000 }], // total 4000c -> payment succeeds
  });
  const params = {
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
  };
  const oneRequest = ['POST', `${BASE}/orders`, body, params];

  // ── Phase A: concurrent burst (the race) ──────────────────────────────────
  // Many requests with the same key hit the server simultaneously. Expected:
  // one wins and creates the order; the rest either replay it or get 409
  // (in-progress). Either way — never a second order.
  const burst = http.batch(Array.from({ length: BURST }, () => oneRequest));

  const created = burst.filter((r) => r.status === 201);
  const inProgress = burst.filter((r) => r.status === 409);
  const orderIds = new Set(created.map((r) => r.json('id')));

  check(null, {
    'A: no server errors': () => burst.every((r) => r.status < 500),
    'A: every response is 201 or 409': () =>
      burst.every((r) => r.status === 201 || r.status === 409),
    'A: all 201 responses share exactly ONE order id': () => orderIds.size === 1,
  });

  const orderId = [...orderIds][0];
  orderIds.forEach(() => createdOrders.add(1)); // -> threshold asserts == 1

  // ── Phase B: replay (the retries) ─────────────────────────────────────────
  // The key is now COMPLETED. Firing it again must return the SAME order, every
  // time, flagged as a replay — and create nothing new.
  const replays = http.batch(Array.from({ length: BURST }, () => oneRequest));
  check(null, {
    'B: all replays return 201': () => replays.every((r) => r.status === 201),
    'B: all replays return the SAME order id': () =>
      replays.every((r) => r.json('id') === orderId),
    'B: all replays are flagged Idempotent-Replayed': () =>
      replays.every((r) => r.headers['Idempotent-Replayed'] === 'true'),
  });

  console.log('\n===================  IDEMPOTENCY BURST RESULT  ===================');
  console.log(`Idempotency-Key      : ${key}`);
  console.log(`customerId           : ${customerId}`);
  console.log(`Requests fired       : ${BURST} concurrent + ${BURST} replays`);
  console.log(`Phase A  201 / 409   : ${created.length} / ${inProgress.length}`);
  console.log(`Distinct order ids   : ${orderIds.size}  ->  ${orderId}`);
  console.log('------------------------------------------------------------------');
  console.log('Now prove it across every service DB:');
  console.log(`  ORDER_ID=${orderId} \\`);
  console.log(`  CUSTOMER_ID=${customerId} \\`);
  console.log('  ./load-tests/verify.sh');
  console.log('==================================================================\n');
}
