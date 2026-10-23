/**
 * AUTH-01 AC: "ผู้ใช้ Workspace A ค้นหา/เรียก ID ของ Workspace B ไม่ได้ทุกช่องทาง"
 * Runs against the dev Postgres as the real runtime role `scm_app`.
 */
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, createPool, withTenant, withUser } from './client.js';
import { auditLogs, memberships, posts, users, workspaces } from './schema.js';

const APP_URL = process.env.DATABASE_URL ?? 'postgres://scm_app:scm_app@localhost:5433/scm';
const pool = createPool(APP_URL, 2);
const db = createDb(pool);

const wsA = randomUUID();
const wsB = randomUUID();
let userA = '';
let userB = '';

beforeAll(async () => {
  const [ua] = await db
    .insert(users)
    .values({ email: `a-${wsA}@test.local`, displayName: 'A' })
    .returning();
  const [ub] = await db
    .insert(users)
    .values({ email: `b-${wsB}@test.local`, displayName: 'B' })
    .returning();
  userA = ua!.id;
  userB = ub!.id;
  for (const [ws, user] of [
    [wsA, userA],
    [wsB, userB],
  ] as const) {
    await withTenant(db, { workspaceId: ws, userId: user }, async (tx) => {
      await tx.insert(workspaces).values({ id: ws, name: `ws-${ws}` });
      await tx.insert(memberships).values({ workspaceId: ws, userId: user, role: 'owner' });
      await tx.insert(posts).values({ workspaceId: ws, title: `post-${ws}`, createdBy: user });
    });
  }
});

afterAll(async () => {
  await pool.end();
});

describe('row-level security (scm_app)', () => {
  it('sees nothing without a tenant context', async () => {
    const rows = await db.select().from(posts);
    expect(rows).toEqual([]);
  });

  it('sees only its own workspace rows', async () => {
    const rows = await withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.select().from(posts),
    );
    expect(rows.map((r) => r.workspaceId)).toEqual([wsA]);
  });

  it('cannot read another workspace by ID', async () => {
    const rows = await withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.select().from(workspaces).where(eq(workspaces.id, wsB)),
    );
    expect(rows).toEqual([]);
  });

  it('cannot write into another workspace', async () => {
    await expect(
      withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
        tx.insert(posts).values({ workspaceId: wsB, title: 'evil', createdBy: userA }),
      ),
    ).rejects.toThrow();
  });

  it('cannot update rows of another workspace (silently affects 0 rows)', async () => {
    const updated = await withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.update(posts).set({ title: 'hacked' }).where(eq(posts.workspaceId, wsB)).returning(),
    );
    expect(updated).toEqual([]);
  });

  it('a user can list workspaces they belong to before picking one', async () => {
    const rows = await withUser(db, userA, (tx) => tx.select().from(workspaces));
    expect(rows.map((r) => r.id)).toEqual([wsA]);
  });

  it('OPS-01: audit log is append-only', async () => {
    await withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
      tx.insert(auditLogs).values({ workspaceId: wsA, action: 'test', targetType: 'x' }),
    );
    await expect(
      withTenant(db, { workspaceId: wsA, userId: userA }, (tx) =>
        tx.execute(sql`delete from audit_logs where workspace_id = ${wsA}`),
      ),
    ).rejects.toThrow();
  });
});
