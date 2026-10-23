---
name: new-migration
description: Change the database schema safely — new table/column/index, RLS policy, data backfill. Use for any edit to packages/db/src/schema.ts or when a feature needs storage.
argument-hint: <what changes>
---

# Schema change: $ARGUMENTS

1. Edit `packages/db/src/schema.ts`. Conventions: `id()` (uuidv7), `createdAt()`, `timestamptz`,
   text enums, `workspaceRef()` for tenant tables, indexes for every FK used in WHERE/JOIN.
2. `pnpm db:generate` (or `cd packages/db && npx drizzle-kit generate --name <slug>`). Read the SQL.
   Never use drizzle-kit's push command. Never edit a committed migration (hook blocks it) — make a new one.
3. **Tenant table?** Append to the generated SQL, separated by `--> statement-breakpoint`:
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   --> statement-breakpoint
   CREATE POLICY tenant_isolation ON <t>
     USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
   ```
   Add the table to `TENANT_TABLES` and a case to `packages/db/src/rls.test.ts`.
4. Destructive change (drop/rename/type change) on data that may exist in prod → expand/contract:
   add new → backfill → switch code → drop in a later release. Write the plan in the PR/STATUS note.
5. `pnpm build:packages && pnpm db:migrate && pnpm --filter @scm/db test`.
6. Ask `security-reviewer` to check RLS/PII if the table holds personal data (PDPA retention!).
