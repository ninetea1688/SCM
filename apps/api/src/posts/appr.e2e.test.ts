/**
 * APPR-03 (internal post comments) and APPR-04 (stuck-approval reminders) end to end.
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, notifications, postInternalComments, postVariants } from '@scm/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';
import { ApprovalReminderJob, PostDiscussionService } from './post-discussion.service';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let postId: string;
let variantId: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

let fbCache: string | null = null;
async function fbAccount(): Promise<string> {
  if (fbCache) return fbCache;
  const res = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจ APPR' })
    .expect(201);
  fbCache = res.body.id as string;
  return fbCache;
}

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'appr');
  const created = await w
    .as('editor')
    .http('post', '/posts')
    .send({
      title: 'งานรอความเห็น',
      variants: [{ socialAccountId: await fbAccount(), caption: 'แนบสื่อด้วย' }],
    })
    .expect(201);
  postId = created.body.id as string;
  variantId = created.body.variants[0].id as string;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const notificationService = () => app.get(NotificationService);
void PostDiscussionService;
void APP_DB;
describe('APPR-03 internal post comments', () => {
  it('team members discuss on the post; other workspaces see nothing', async () => {
    await w
      .as('editor')
      .http('post', `/posts/${postId}/comments`)
      .send({ text: 'ฝ่ายกฎหมายขอตรวจถ้อยคำก่อนได้ไหม' })
      .expect(200);
    await w
      .as('approver')
      .http('post', `/posts/${postId}/comments`)
      .send({ text: 'รับทราบ จะตรวจพร้อมอนุมัติพรุ่งนี้' })
      .expect(200);

    const list = await w.as('viewer').http('get', `/posts/${postId}/comments`).expect(200);
    expect(list.body.map((c: { author: string }) => c.author).sort()).toEqual([
      'approver',
      'editor',
    ]);

    const other = await createWorld(app, 'appr-b');
    await other.as('owner').http('get', `/posts/${postId}/comments`).expect(404);

    await w.as('editor').http('post', `/posts/${postId}/comments`).send({ text: '' }).expect(400);
  });

  it('comments live in their own RLS-protected table', async () => {
    const rows = await ownerDb
      .select()
      .from(postInternalComments)
      .where(eq(postInternalComments.postId, postId));
    expect(rows.length).toBe(2);
  });
});

describe('APPR-04 stuck-approval reminders', () => {
  it('a variant in review past the threshold reminds once per day; approval stops it', {
    timeout: 90_000,
  }, async () => {
    // Send for review and age the variant past APPROVAL_REMIND_HOURS.
    await w.as('editor').http('post', `/variants/${variantId}/submit`).expect(200);
    await ownerDb
      .update(postVariants)
      .set({ updatedAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(postVariants.id, variantId));

    const job = new ApprovalReminderJob(app.get(SYSTEM_DB), notificationService(), app.get(CONFIG));
    const first = await job.tick(new Date(), w.workspaceId);
    expect(first.reminded).toBeGreaterThanOrEqual(1);

    const rows = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, w.workspaceId),
          eq(notifications.type, 'approval_reminder'),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(rows.length).toBeGreaterThanOrEqual(3); // notifySystem row per admin + owners/admins in-app

    // Same day again → deduped.
    const second = await job.tick(new Date(), w.workspaceId);
    // Other (older) variants may remind, but ours must be deduped: no NEW row for it.
    void second;

    const before = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, w.workspaceId),
          eq(notifications.type, 'approval_reminder'),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    const countBefore = before.length;
    expect(countBefore).toBeGreaterThanOrEqual(3);
    await job.tick(new Date(), w.workspaceId);
    const after = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, w.workspaceId),
          eq(notifications.type, 'approval_reminder'),
          eq(notifications.link, `/posts/${postId}`),
        ),
      );
    expect(after.length).toBe(countBefore); // same-day dedupe

    // Approve → no longer in review → nothing left to remind.
    const approveRes = await w
      .as('approver')
      .http('post', `/variants/${variantId}/approve`)
      .send({});
    expect(approveRes.status).toBe(200);
    await ownerDb
      .update(postVariants)
      .set({ updatedAt: new Date(Date.now() - 48 * 3600_000) })
      .where(eq(postVariants.id, variantId));
    await expect(job.tick(new Date(), w.workspaceId)).resolves.toEqual({ reminded: 0 });
  });
});
