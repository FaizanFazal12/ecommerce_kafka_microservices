# API Gateway

The single public entry point. It handles the cross-cutting edge concerns so the
internal services don't have to, then reverse-proxies to the Order Service.

## Responsibilities

| Concern | How |
|---|---|
| **Authentication** | JWT `Bearer` token verified at the edge ([jwt-auth.guard.ts](src/auth/jwt-auth.guard.ts)). Internal services trust the gateway. |
| **Rate limiting** | Distributed fixed-window counter in **Redis** ([rate-limit.guard.ts](src/rate-limit/rate-limit.guard.ts)) — enforced across all gateway instances. Fails open if Redis is down. |
| **Request tracing** | `X-Request-Id` minted per request ([request-id.middleware.ts](src/common/request-id.middleware.ts)) and propagated downstream. |
| **Reverse proxy** | Forwards to the Order Service, injecting the authenticated `customerId` and relaying the `Idempotency-Key` ([proxy.service.ts](src/proxy/proxy.service.ts)). |

**Security property:** `customerId` is taken from the verified token, not the
request body — a caller can only place orders as themselves.

## Endpoints

```
POST /auth/token     { "customerId": "<uuid>" }  -> { accessToken }   (demo issuer)
POST /orders         (Bearer + Idempotency-Key)  -> proxied to Order Service
GET  /orders/:id     (Bearer)                     -> proxied to Order Service
GET  /health
```

## Run it

```bash
cd services/api-gateway
cp .env.example .env
npm install
npm run start:dev          # listens on :3000, proxies to :3001
```

## Demo

```bash
CUSTOMER=11111111-1111-1111-1111-111111111111

# 1. get a token
TOKEN=$(curl -s -X POST localhost:3000/auth/token \
  -H 'Content-Type: application/json' \
  -d "{\"customerId\":\"$CUSTOMER\"}" | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')

# 2. place an order through the gateway (note: no customerId in the body — the
#    gateway injects it from the token)
curl -i -X POST localhost:3000/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' \
  -d '{ "items": [ { "productId": "22222222-2222-2222-2222-222222222222", "quantity": 1, "unitPriceCents": 4999 } ] }'

# 3. hammer it to see 429s once you exceed RATE_LIMIT_MAX in the window
for i in $(seq 1 30); do
  curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/orders \
    -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: $(uuidgen)" \
    -H 'Content-Type: application/json' -d '{"items":[{"productId":"22222222-2222-2222-2222-222222222222","quantity":1,"unitPriceCents":100}]}'
done; echo
```

Response headers to look for: `X-Request-Id`, `X-RateLimit-Remaining`, and
`Retry-After` once limited.

## Production follow-ups

- Real identity provider (OAuth/OIDC) instead of the demo `/auth/token`.
- mTLS or a network policy so internal services are only reachable via the gateway.
- Per-route limits and burst allowances; sliding-window or token-bucket algorithm.
