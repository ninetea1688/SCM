---
paths:
  - "packages/db/**"
---
# packages/db rules

- Schema changes: edit `src/schema.ts` → `pnpm db:generate` → review SQL → `pnpm db:migrate`.
  Use the `/new-migration` skill. Never edit an existing file in `migrations/` (hook blocks it).
- New tenant table ⇒ `workspace_id uuid not null references workspaces` + RLS policy in the same
  migration (append to the generated SQL) + add the name to `TENANT_TABLES` + extend `rls.test.ts`.
- IDs: `uuidv7()` default (Postgres 18). Timestamps: `timestamptz`.
- `audit_logs` is append-only (trigger + revoked grants). Do not add update paths.
- Runtime roles: `scm_app` (RLS) and `scm_system` (BYPASSRLS). Grants for new tables come from
  default privileges in `0001_rls.sql`.
