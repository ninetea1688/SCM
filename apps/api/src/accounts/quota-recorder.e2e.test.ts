/**
 * PUB-05: live platform quota readings are persisted in quota_usage — one row per
 * (account, kind, window), a newer reading upserting the same row. The recorder is
 * exercised directly with the system DB (worker-style, cross-tenant).
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, quotaUsage, socialAccounts } from '@scm/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_DB } from '../common/core.module';
import { QuotaRecorder, windowAnchor } from '../common/quota-recorder.service';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let accountId: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'quota');
  const res = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'instagram', name: 'ig โควตา' })
    .expect(201);
  accountId = res.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const recorder = () => new QuotaRecorder(app.get(SYSTEM_DB));

describe('QuotaRecorder (PUB-05)', () => {
  it('anchors rolling 24h windows to the UTC day and monthly windows to the month', () => {
    const now = new Date('2026-10-23T09:30:00Z');
    expect(windowAnchor('ig_posts_24h', now)).toEqual(new Date('2026-10-23T00:00:00Z'));
    expect(windowAnchor('line_messages_month', now)).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('persists a reading and upserts the same row on a newer one', async () => {
    const acct = { id: accountId, workspaceId: w.workspaceId };
    expect(await recorder().record(acct, [{ kind: 'ig_posts_24h', used: 7, limit: 50 }])).toBe(1);

    let rows = await ownerDb
      .select()
      .from(quotaUsage)
      .where(eq(quotaUsage.socialAccountId, accountId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'ig_posts_24h',
      used: 7,
      quotaLimit: 50,
      windowStart: windowAnchor('ig_posts_24h'),
    });

    await recorder().record(acct, [{ kind: 'ig_posts_24h', used: 9, limit: 50 }]);
    rows = await ownerDb.select().from(quotaUsage).where(eq(quotaUsage.socialAccountId, accountId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.used).toBe(9);

    await recorder().record(acct, [{ kind: 'line_messages_month', used: 123, limit: 500 }]);
    const [month] = await ownerDb
      .select()
      .from(quotaUsage)
      .where(
        and(eq(quotaUsage.socialAccountId, accountId), eq(quotaUsage.kind, 'line_messages_month')),
      );
    expect(month!.windowStart).toEqual(windowAnchor('line_messages_month'));
  });

  it('the account row keeps pointing at its workspace (RLS key present)', async () => {
    const [a] = await ownerDb
      .select({ ws: socialAccounts.workspaceId })
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId));
    expect(a!.ws).toBe(w.workspaceId);
  });
});
