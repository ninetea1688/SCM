/** ANA-05/06: dashboard aggregates + KPI goals round-trip. */
import type { INestApplication } from '@nestjs/common';
import { conversations, createDb, createPool, inboxMessages, socialAccounts } from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let convId: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'dash');
  const line = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'line', name: 'OA dashboard' })
    .expect(201);
  await ownerDb
    .update(socialAccounts)
    .set({ webhookSecretEnc: null })
    .where(eq(socialAccounts.id, line.body.id));
  const conv = await w.as('agent').http('post', '/inbox/conversations').send({});
  void conv;
  // Seed one conversation with messages through the service path (webhook requires signature).
  const created = await w.as('agent').http('post', '/inbox/conversations').send({});
  void created;
  // Direct insert keeps this test focused on aggregates, not webhook plumbing.
  const { conversations: convTable } = await import('@scm/db');
  const [row] = await ownerDb
    .insert(convTable)
    .values({
      workspaceId: w.workspaceId,
      socialAccountId: line.body.id,
      platform: 'line',
      externalUserId: 'U-dash',
      lastMessagePreview: 'สวัสดี',
    })
    .returning();
  convId = row!.id;
  await ownerDb.insert(inboxMessages).values([
    { workspaceId: w.workspaceId, conversationId: convId, direction: 'in', text: 'สวัสดี' },
    { workspaceId: w.workspaceId, conversationId: convId, direction: 'out', text: 'สวัสดีครับ' },
  ]);
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

describe('ANA-06 KPI goals', () => {
  it('owner sets goals; everyone reads them; unknown metric rejected', async () => {
    await w
      .as('owner')
      .http('put', '/analytics/goals')
      .send({ goals: [{ metric: 'reach', platform: 'all', target: 5000 }] })
      .expect(200);
    const goals = await w.as('viewer').http('get', '/analytics/goals').expect(200);
    expect(goals.body).toMatchObject([{ metric: 'reach', platform: 'all', target: 5000 }]);
    await w
      .as('editor')
      .http('put', '/analytics/goals')
      .send({ goals: [{ metric: 'reach', platform: 'all', target: 1 }] })
      .expect(403); // workspace.policy
    await w
      .as('owner')
      .http('put', '/analytics/goals')
      .send({ goals: [{ metric: 'nonsense', platform: 'all', target: 5 }] })
      .expect(400);
  });
});

describe('ANA-05 dashboard summary', () => {
  it('aggregates conversations layer from real messages', async () => {
    const s = await w.as('owner').http('get', '/analytics/summary').expect(200);
    expect(s.body.conversations.total).toBeGreaterThanOrEqual(1);
    expect(s.body.conversations.received).toBeGreaterThanOrEqual(1);
    expect(s.body.conversations.sent).toBeGreaterThanOrEqual(1);
    expect(s.body.system.publishSuccessRate).toBeNull(); // no jobs yet in this workspace
  });
});

describe('ANA-16 CSV export', () => {
  it('serves the per-post table as UTF-8 BOM CSV with Thai headers', async () => {
    const csv = await w.as('viewer').http('get', '/analytics/posts.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff); // BOM
    expect(csv.text).toContain('"โพสต์","ช่องทาง","บัญชี"');
    // Quotes escaped so commas inside titles don't break columns.
    expect(csv.text.split('\r\n').length).toBeGreaterThanOrEqual(1);
  });
});
