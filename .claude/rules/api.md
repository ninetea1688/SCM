---
paths:
  - "apps/api/**"
---
# apps/api rules

- Module per feature (`posts/`, `publishing/`, …). Controllers parse input with zod via `parseInput`
  and declare `@RequirePermission()`; services hold logic; `TenantGuard` resolves `x-workspace-id`.
- Every tenant query inside `withTenant(this.db, { workspaceId, userId }, tx => …)`.
- Every state-changing action calls `AuditService.record(tx, …)` inside the same transaction.
- Side effects that must not happen on rollback (queue add/remove, LINE/email sends) are collected
  into `afterCommit` and run after the transaction resolves.
- Errors: throw Nest HTTP exceptions with `{ code, message? }` — `code` is a stable snake_case
  identifier the web maps to Thai text; `message` may be Thai for direct display.
- No `console.log`; use Nest `Logger` (pino JSON in prod). Never log tokens or full payloads.
- Tests: unit tests next to code; AC tests use `src/test/harness.ts` against dev infra.
