# ADR-0006 — Tenant isolation with Postgres Row-Level Security

**Context.** AUTH-01 AC: a Workspace A user must not reach Workspace B data through any channel.
Application-level `WHERE workspace_id = ?` fails open the first time someone forgets it.

**Decision.**
- Every tenant table has `workspace_id` and an RLS policy (`packages/db/migrations/*_rls.sql`).
- Runtime roles: `scm_app` (RLS enforced, used by API and worker) and `scm_system` (BYPASSRLS, only
  for cross-tenant system tasks: sweeper, webhook account routing, retention). Migrations run as owner.
- Code touches tenant data only inside `withTenant(db, { workspaceId, userId }, tx => …)`, which sets
  `app.workspace_id` for the transaction. Outside it, queries return zero rows.
- Adding a tenant table without an RLS policy is a review blocker (`/new-migration` skill checks it).

**Consequences.** Isolation holds even with a buggy query. Using `SYSTEM_DB` needs a comment
explaining why. Proven by `packages/db/src/rls.test.ts`.
