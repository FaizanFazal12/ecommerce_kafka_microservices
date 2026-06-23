# ADR 0006 — Per-Service Generated Prisma Client

**Status:** Accepted

## Context

The repo is an npm-workspaces monorepo. By default npm **hoists** shared
dependencies (`@prisma/client`, `prisma`) to the root `node_modules`, and
`prisma generate` writes the generated client to a single hoisted location
(`node_modules/.prisma/client`).

Each service has a **different** schema (orders vs payments vs products …). With a
single shared client location, whichever service ran `prisma generate` last wins —
its models overwrite everyone else's. Two services can't run simultaneously with
correct types, and a typecheck only passes if you regenerate immediately before it.
This is a correctness bug in a database-per-service architecture.

## Decision

Give every service its **own** generated client, checked by configuration:

- Each `schema.prisma` sets `generator client { output = "../src/generated/prisma" }`
  so the client lands inside that service.
- A tiny barrel, `src/prisma/client.ts` (`export * from '../generated/prisma'`), is
  the single import point; all service code imports `PrismaClient` / `Prisma` from
  the barrel, never from `@prisma/client`.
- The generated client is JavaScript, so `tsc` ignores it; `nest-cli.json` `assets`
  copies `generated/prisma/**` into `dist` at build time so the runtime client +
  query engine ship alongside the compiled code.
- `prebuild: prisma generate` keeps the client fresh; the dir is git-ignored.

## Consequences

**Positive**
- Each service is permanently bound to its own schema — no cross-service clobbering.
- All services typecheck and run concurrently with correct types.
- One-line import surface (the barrel) means the isolation detail is centralized.

**Negative / costs accepted**
- A small amount of generated code lives under each service (git-ignored, rebuilt on demand).
- The `assets` copy step is required for runtime; forgetting it would break
  `node dist/main.js` (documented here and encoded in `nest-cli.json`).

## Alternatives considered

- **Shared hoisted client.** The default; clobbers across services. Rejected (the bug above).
- **Disable hoisting / per-service `node_modules`.** npm workspaces don't support
  per-package nohoist cleanly; fragile. Rejected.
- **Separate repos per service.** Eliminates the issue but loses the single-repo
  convenience this portfolio project wants. Rejected.
