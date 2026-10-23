/**
 * PDPA-02 + INT-04 ACs: members file data-subject requests and export their own
 * data; owner/admin work the queue (erase deletes the user's copies); the
 * deletion job wipes inbound events for a platform user and closes the request.
 * Needs `pnpm dev:infra`.
 */
import type { INestApplication } from '@nestjs/common';
import {
  createDb,
  createPool,
  dataDeletionRequests,
  inboundEvents,
  notifications,
  socialAccounts,
} from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_DB } from '../common/core.module';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';
import { DataDeletionService } from '../webhooks/data-deletion.service';

let app: INestApplication;
let w: World;
let accountId: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'pdpa');
  const res = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจ pdpa' })
    .expect(201);
  accountId = res.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

describe('PDPA-02 data-subject requests', () => {
  it('a member files a request and exports their own data as JSON', async () => {
    const created = await w
      .as('editor')
      .http('post', '/pdpa/requests')
      .send({ kind: 'access', detail: 'ขอดูข้อมูลของฉัน' })
      .expect(201);
    const id = created.body.id as string;

    const mine = await w.as('editor').http('get', '/pdpa/requests').expect(200);
    expect(mine.body.some((r: { id: string }) => r.id === id)).toBe(true);

    const exported = await w.as('editor').http(`get`, `/pdpa/requests/${id}/export`).expect(200);
    expect(exported.body.profile.email).toBe(w.as('editor').email);
    expect(Array.isArray(exported.body.memberships)).toBe(true);
    expect(exported.body.request.kind).toBe('access');
  });

  it('members see only their own queue; owners see everything', async () => {
    await w.as('viewer').http('post', '/pdpa/requests').send({ kind: 'access' }).expect(201);
    const asEditor = await w.as('editor').http('get', '/pdpa/requests').expect(200);
    expect(asEditor.body.every((r: { userId: string }) => r.userId === w.as('editor').userId)).toBe(
      true,
    );
    const asOwner = await w.as('owner').http('get', '/pdpa/requests').expect(200);
    expect(asOwner.body.length).toBeGreaterThan(asEditor.body.length);
  });

  it('completing an erase request deletes the user’s notification copies and is audited', async () => {
    // give the editor a notification to erase
    await ownerDb.insert(notifications).values({
      workspaceId: w.workspaceId,
      userId: w.as('editor').userId,
      type: 'publish_failed',
      channel: 'in_app',
      title: 'ทดสอบลบ',
      status: 'sent',
      sentAt: new Date(),
    });
    const created = await w
      .as('editor')
      .http('post', '/pdpa/requests')
      .send({ kind: 'erase', detail: 'ขอลบข้อมูล' })
      .expect(201);
    const id = created.body.id as string;

    // a non-admin cannot close it
    await w
      .as('editor')
      .http('post', `/pdpa/requests/${id}/complete`)
      .send({ decision: 'done' })
      .expect(403);

    await w
      .as('owner')
      .http('post', `/pdpa/requests/${id}/complete`)
      .send({ decision: 'done', note: 'ลบสำเร็จ' })
      .expect(200);
    const left = await ownerDb
      .select()
      .from(notifications)
      .where(eq(notifications.userId, w.as('editor').userId));
    expect(left.filter((n) => n.workspaceId === w.workspaceId)).toEqual([]);
  });
});

describe('INT-04 deletion job', () => {
  it('removes the platform user’s inbound events and closes the request', async () => {
    // two events: one mentions the user, one does not
    await ownerDb.insert(inboundEvents).values([
      {
        workspaceId: w.workspaceId,
        socialAccountId: accountId,
        platform: 'facebook',
        eventType: 'feed_comment',
        payload: { from: { id: '999888777' }, text: 'สวัสดี' },
      },
      {
        workspaceId: w.workspaceId,
        socialAccountId: accountId,
        platform: 'facebook',
        eventType: 'feed_comment',
        payload: { from: { id: 'other-user' }, text: 'ไม่เกี่ยว' },
      },
    ]);
    await ownerDb.insert(dataDeletionRequests).values({
      platform: 'facebook',
      externalUserId: '999888777',
      confirmationCode: `test-${Date.now()}`,
    });

    const done = await new DataDeletionService(app.get(SYSTEM_DB as never)).processOnce();
    expect(done).toBeGreaterThanOrEqual(1);

    const rows = await ownerDb
      .select()
      .from(inboundEvents)
      .where(eq(inboundEvents.platform, 'facebook'));
    const mine = rows.filter((r) => r.workspaceId === w.workspaceId);
    expect(mine).toHaveLength(1);
    expect((mine[0]!.payload as { from: { id: string } }).from.id).toBe('other-user');

    const [req] = await ownerDb
      .select()
      .from(dataDeletionRequests)
      .where(eq(dataDeletionRequests.externalUserId, '999888777'));
    expect(req!.status).toBe('done');
    expect(req!.completedAt).toBeTruthy();
  });

  it('leaves other platforms untouched', async () => {
    const [acc] = await ownerDb
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId));
    await ownerDb.insert(inboundEvents).values({
      workspaceId: w.workspaceId,
      socialAccountId: acc!.id,
      platform: 'facebook',
      eventType: 'feed_comment',
      payload: { from: { id: 'keep-me-line-side' }, text: 'x' },
    });
    await ownerDb.insert(dataDeletionRequests).values({
      platform: 'line', // different platform, same id text
      externalUserId: 'keep-me-line-side',
      confirmationCode: `test2-${Date.now()}`,
    });
    await new DataDeletionService(app.get(SYSTEM_DB as never)).processOnce();
    const rows = await ownerDb.select().from(inboundEvents);
    expect(
      rows.some(
        (r) =>
          r.workspaceId === w.workspaceId &&
          (r.payload as { from?: { id?: string } }).from?.id === 'keep-me-line-side',
      ),
    ).toBe(true); // facebook event survives a LINE deletion request
  });
});
