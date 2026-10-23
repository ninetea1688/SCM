# SCM — Social Content Management

Thai government-agency content hub: plan → AI-assist → approve → schedule → publish to
Facebook, Instagram, TikTok, YouTube, LINE OA; later Unified Inbox, chatbot, monitoring, analytics.
Spec: `prd/prd.md` (Thai, owner's document). Progress: `docs/STATUS.md`. Decisions: `docs/decisions/`.

## Map

```
packages/domain  pure rules: variant state machine, RBAC, validate(), retry/idempotency, redact, thai-date
packages/db      Drizzle schema, forward-only SQL migrations, RLS, withTenant()
apps/api         NestJS: src/main.ts (HTTP) + src/worker.ts (BullMQ + sweeper), one image
apps/web         Next.js 16 App Router, Thai UI; BFF (/bff, /session) keeps tokens in httpOnly cookies
docker/          Dockerfiles, Caddyfile, Postgres role init, backup
```

## Commands

```bash
pnpm dev:infra                # Postgres :5433, Redis :6380, SeaweedFS S3 :8333, Mailpit :8025
pnpm build:packages && pnpm db:migrate   # DATABASE_OWNER_URL defaults to local owner
pnpm --filter @scm/api build && pnpm dev:api / dev:worker / dev:web
pnpm verify                   # lint + typecheck + all tests (needs dev:infra). Run before saying "done".
pnpm --filter @scm/api test -- -t "Kill Switch"   # one test
node apps/api/dist/cli/seed.js <email> <password12+> [name] [workspace]   # no public sign-up
```

## Non-negotiables (each one maps to a PRD AC — breaking it is a bug, not a trade-off)

1. **Never edit `prd/prd.md`.** Deviations go in a new ADR + `docs/prd-review.md`. Formatters exclude it.
2. **Tenant data only inside `withTenant()`** (role `scm_app`, RLS). `SYSTEM_DB` only for cross-tenant
   system work, with a comment saying why. Every new tenant table ships with its RLS policy (ADR-0006).
3. **Every variant status change goes through `transitionVariant()`** in `@scm/domain`. No `status:`
   literals written elsewhere. Nothing reaches a platform without an approval for the *current version*.
4. **Publishing is at-most-once.** Adapters classify outcomes `success|retryable|permanent|unknown`;
   `unknown` is reconciled, never blindly retried (ADR-0004). Queue side effects run *after* commit.
5. **Secrets never leave the server or reach logs.** Tokens encrypted with `TokenCipher`; payloads to
   Publish/Audit logs go through `redact()`; browser JS never sees access/refresh tokens.
6. **Platform limits live in `PLATFORM_LIMITS` / `DAILY_PUBLISH_LIMITS` with a source URL** — never
   inline a number. Verify against official docs before changing (`/verify-platform-limits`).
7. **Defaults are configurable** (PRD §0): workspace `settings` or env, never hard-coded constants
   scattered in services.
8. **Applied migrations are immutable.** Change schema → `pnpm db:generate` → new file.

## How work is done here

- Reference requirement IDs (`PUB-03`, `AUTH-01`, `NFR-02`, ADR numbers) in code comments, test
  names, commits. A prompt mentioning an ID gets that PRD row injected automatically (hook).
- Start a requirement with `/implement-req <ID>`: read PRD row + AC → write the failing test named
  after the AC → implement → update `docs/STATUS.md` → `pnpm verify`.
- Tests prove ACs against real Postgres/Redis (`apps/api/src/test/harness.ts` → `createWorld()`);
  use `PUBLISHER_MODE=fake` and caption markers `[[fail:retryable|permanent|unknown]]`.
- User-facing text is Thai, dates Asia/Bangkok with พ.ศ. (`formatThaiDateTime`). Code, comments,
  commits in English.
- Before claiming done: `pnpm verify` green, and for UI changes look at the page.

## Agents and skills in `.claude/`

Skills: `/implement-req`, `/new-adapter`, `/new-migration`, `/verify-platform-limits`, `/phase-gate`,
`/thai-ux`. Agents: `prd-guardian` (diff vs PRD/AC), `security-reviewer` (tenancy, secrets, PDPA,
prompt-injection), `platform-researcher` (official API docs), `test-author` (AC → tests).
How it all fits: `docs/context-engineering.md`.

## Gotchas

- Biome must not format Markdown (it reflowed the PRD once). `biome.json` excludes `*.md` and `prd`.
- MinIO images are gone from Docker Hub → SeaweedFS. Signed URLs must use `S3_PUBLIC_ENDPOINT`.
- Vitest + Nest DI needs SWC (`apps/api/vitest.config.mts`, ESM output). Tests run serially.
- `z.coerce.boolean()` turns `"false"` into `true` — use `z.stringbool()` for env/query booleans.
- Next 16: `params`/`searchParams`/`cookies()` are async.
