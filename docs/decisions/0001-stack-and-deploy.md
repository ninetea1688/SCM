# ADR-0001 — TypeScript modular monolith, Docker Compose deploy

**Context.** PRD §17 left backend language and hosting open. The owner asked to start immediately
and specified production deploy via Docker Compose.

**Decision.**
- pnpm monorepo: `apps/api` (NestJS 11, HTTP + worker entrypoints from one codebase),
  `apps/web` (Next.js 16, BFF holds tokens in httpOnly cookies), `packages/domain` (pure rules),
  `packages/db` (Drizzle + migrations).
- PostgreSQL 18 + pgvector, Redis 8 + BullMQ, S3-compatible storage (SeaweedFS; swap to R2 via env).
- One host, `docker-compose.prod.yml`, Caddy for automatic HTTPS. Scale workers with `--scale`.
- Versions pinned to stable majors (TS 5.9, Nest 11, Vitest 4) rather than freshly released ones.
- Python is reserved for a future Thai-NLP/embedding worker (P4), behind a queue — not a second API.

**Consequences.** One language for API/web/rules; heavy AI/video work can be a separate worker
later without touching the API. MinIO images are no longer distributed, hence SeaweedFS.
