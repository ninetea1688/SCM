import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface TenantContext {
  workspaceId: string;
  userId?: string;
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/**
 * The only supported way to touch tenant data with the `scm_app` role (ADR-0006).
 * Sets `app.workspace_id` / `app.user_id` for this transaction so RLS policies apply;
 * outside this helper every tenant query returns zero rows.
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.workspace_id', ${ctx.workspaceId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/** For pre-workspace lookups (e.g. "which workspaces am I in?"): scoped to the user only. */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.workspace_id', '', true), set_config('app.user_id', ${userId}, true)`,
    );
    return fn(tx);
  });
}
