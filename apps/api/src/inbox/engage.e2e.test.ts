/**
 * INBOX-01/02 + ANA-01 skeleton, end to end against real Postgres/Redis:
 *  - LINE webhook → chat desk (conversation + messages), reply claims the thread, statuses cycle
 *  - Meta feed webhook → comment desk linked to our published post, reply + hide
 *  - Analytics: snapshots per post × platform after a successful publish (sandbox insights)
 */
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  conversations,
  createDb,
  createPool,
  inboxMessages,
  postComments,
  postMetrics,
  publishJobs,
  socialAccounts,
} from '@scm/db';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCipher } from '../common/crypto';
import type { FakeAdapter } from '../publishing/adapters/fake.adapter';
import { AdapterRegistry } from '../publishing/adapters/registry';
import { PublishRunner } from '../publishing/publish-runner.service';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';

let app: INestApplication;
let w: World;
let lineAccount: string;
let fbAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
// The dev/test default key (config.ts) — the sandbox account tokens were encrypted with it.
const cipher = new TokenCipher('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'engage');
  const line = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'line', name: 'OA ศูนย์แชท' })
    .expect(201);
  lineAccount = line.body.id;
  // The sandbox factory stores no channel secret; the webhook needs one to verify.
  await ownerDb
    .update(socialAccounts)
    .set({ webhookSecretEnc: cipher.encrypt('line-secret') })
    .where(eq(socialAccounts.id, lineAccount));
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจคอมเมนต์' })
    .expect(201);
  fbAccount = fb.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const runner = () => app.get(PublishRunner);
const fake = (p: 'line' | 'facebook') => app.get(AdapterRegistry).get(p) as FakeAdapter;

function sendLine(events: unknown[]) {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', 'line-secret').update(Buffer.from(body)).digest('base64');
  return request(app.getHttpServer())
    .post(`/webhooks/line/${lineAccount}`)
    .set('content-type', 'application/json')
    .set('x-line-signature', sig)
    .send(body);
}

function sendMeta(changes: unknown[]) {
  return request(app.getHttpServer())
    .post(`/webhooks/meta/feed/${fbAccount}`)
    .set('content-type', 'application/json')
    .send(JSON.stringify({ object: 'page', entry: [{ changes }] }));
}

/** draft → submit → approve → schedule → run, returns [variantId, postId, externalPostId]. */
async function publishNow(caption: string): Promise<[string, string, string]> {
  const created = await w
    .as('editor')
    .http('post', '/posts')
    .send({ title: caption, variants: [{ socialAccountId: fbAccount, caption }] })
    .expect(201);
  const variantId = created.body.variants[0].id as string;
  const postId = created.body.id as string;
  await w.as('editor').http('post', `/variants/${variantId}/submit`).expect(200);
  await w.as('approver').http('post', `/variants/${variantId}/approve`).send({}).expect(200);
  await w
    .as('approver')
    .http('post', `/variants/${variantId}/schedule`)
    .send({ scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString() })
    .expect(200);
  const [job] = await ownerDb
    .select()
    .from(publishJobs)
    .where(eq(publishJobs.variantId, variantId));
  expect(await runner().run({ publishJobId: job!.id, workspaceId: w.workspaceId })).toEqual({
    status: 'succeeded',
  });
  const [done] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.id, job!.id));
  return [variantId, postId, done!.externalPostId!];
}

describe('chat desk (INBOX-01/02)', () => {
  it('webhook messages land on the desk; replying claims the thread and reaches the platform', async () => {
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'evt-1',
        timestamp: Date.now(),
        source: { userId: 'U-citizen', type: 'user' },
        message: { id: 'msg-1', text: 'สอบถามสิทธิ์ตรวจสุขภาพครับ' },
      },
    ]).expect(200);

    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    expect(conv.body).toHaveLength(1);
    expect(conv.body[0]).toMatchObject({ platform: 'line', status: 'open' });
    const id = conv.body[0].id as string;

    const msgs = await w.as('agent').http('get', `/inbox/conversations/${id}/messages`).expect(200);
    expect(msgs.body.map((m: { text: string }) => m.text)).toEqual(['สอบถามสิทธิ์ตรวจสุขภาพครับ']);

    const reply = await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'เบอร์ 13 หลักขึ้นต้น 0 ครับ ตรวจได้ทุกที่ในเครือข่าย สปสช.' })
      .expect(200);
    expect(reply.body.direction).toBe('out');
    // Sandbox LINE adapter recorded the push.
    expect(fake('line').sent).toContainEqual({
      kind: 'dm',
      to: 'U-citizen',
      text: 'เบอร์ 13 หลักขึ้นต้น 0 ครับ ตรวจได้ทุกที่ในเครือข่าย สปสช.',
    });
    // INBOX-02: answering claims the thread for the answerer.
    const after = await w
      .as('agent')
      .http('get', '/inbox/conversations?status=claimed')
      .expect(200);
    expect(after.body).toHaveLength(1);
    expect(after.body[0].assignee).toBe('agent');

    await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/status`)
      .send({ status: 'closed' })
      .expect(200);
    // A new message reopens a closed thread (same contact = same conversation).
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'evt-2',
        timestamp: Date.now(),
        source: { userId: 'U-citizen' },
        message: { id: 'msg-2', text: 'ขอบคุณครับ' },
      },
    ]).expect(200);
    const reopened = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    expect(reopened.body).toHaveLength(1);
    expect(reopened.body[0].status).toBe('open');

    // Redelivery of the same messageId never duplicates a row.
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'evt-2b',
        timestamp: Date.now(),
        source: { userId: 'U-citizen' },
        message: { id: 'msg-2', text: 'ขอบคุณครับ' },
      },
    ]).expect(200);
    const [row] = await ownerDb.select().from(conversations).where(eq(conversations.id, id));
    const count = await ownerDb
      .select()
      .from(inboxMessages)
      .where(eq(inboxMessages.conversationId, id));
    expect(count.length).toBe(3); // in, out, in — no duplicate
    expect(row!.status).toBe('open');
  });

  it('a forged LINE signature is rejected', async () => {
    await request(app.getHttpServer())
      .post(`/webhooks/line/${lineAccount}`)
      .set('content-type', 'application/json')
      .set('x-line-signature', 'bm90LXRoZS1zaWc=')
      .send(
        JSON.stringify({
          events: [
            { type: 'message', source: { userId: 'U-x' }, message: { id: 'm', text: 'hi' } },
          ],
        }),
      )
      .expect(401);
  });
});

describe('comment desk (INBOX-01)', () => {
  it('comments on our published post link back to it; reply + hide work per comment', async () => {
    const [, postId, externalPostId] = await publishNow('ประกาศตรวจสุขภาพ');

    await sendMeta([
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          comment_id: 'c1',
          post_id: externalPostId,
          from_name: 'ประชาชน ก.',
          message: 'สมัครที่ไหนคะ',
        },
      },
    ]).expect(200);
    // A comment on an unknown post is kept but unlinked.
    await sendMeta([
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          comment_id: 'c2',
          post_id: 'OTHER_POST',
          from_name: 'สแปม',
          message: 'แจกเงินคลิก bit.ly/x',
        },
      },
    ]).expect(200);

    const list = await w.as('agent').http('get', '/comments').expect(200);
    expect(list.body.length).toBe(2);
    const ours = list.body.find(
      (c: { platform?: string; postTitle?: string }) => c.platform === 'facebook' && c.postTitle,
    );
    expect(ours).toMatchObject({ postId, postTitle: 'ประกาศตรวจสุขภาพ', status: 'open' });

    const replied = await w
      .as('agent')
      .http('post', `/comments/${ours.id}/reply`)
      .send({ text: 'สมัครผ่านหน้าเว็บ สปสช. หรือ แอป "สปสช. ทันมือ" ได้เลยครับ' })
      .expect(200);
    expect(replied.body.status).toBe('replied');
    expect(fake('facebook').sent).toContainEqual({
      kind: 'comment',
      to: 'c1',
      text: 'สมัครผ่านหน้าเว็บ สปสช. หรือ แอป "สปสช. ทันมือ" ได้เลยครับ',
    });

    const spam = list.body.find((c: { text: string }) => c.text.includes('แจกเงิน'));
    const hidden = await w
      .as('agent')
      .http('post', `/comments/${spam.id}/hide`)
      .send({ reason: 'ลิงก์อันตราย' })
      .expect(200);
    expect(hidden.body.status).toBe('hidden');
    const open = await w.as('agent').http('get', '/comments?status=open').expect(200);
    expect(open.body).toHaveLength(0);

    // Redelivery of the same comment id never duplicates.
    await sendMeta([
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          comment_id: 'c1',
          post_id: externalPostId,
          from_name: 'ประชาชน ก.',
          message: 'สมัครที่ไหนคะ',
        },
      },
    ]).expect(200);
    const total = await ownerDb
      .select()
      .from(postComments)
      .where(eq(postComments.workspaceId, w.workspaceId));
    expect(total.length).toBe(2);
  });
});

describe('engagement snapshots per post × platform (ANA-01 skeleton)', () => {
  it('collect captures one snapshot per published post; the overview splits post × platform', async () => {
    const lineCreated = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'ประกาศเตือนภัย',
        variants: [{ socialAccountId: lineAccount, caption: 'พายุฝนฟ้าคะนอง' }],
      })
      .expect(201);
    const lv = lineCreated.body.variants[0].id as string;
    await w.as('editor').http('post', `/variants/${lv}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${lv}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${lv}/schedule`)
      .send({ scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString() })
      .expect(200);
    const [ljob] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.variantId, lv));
    expect(await runner().run({ publishJobId: ljob!.id, workspaceId: w.workspaceId })).toEqual({
      status: 'succeeded',
    });

    const collect = await w.as('owner').http('post', '/analytics/collect').expect(200);
    expect(collect.body.captured).toBeGreaterThanOrEqual(2); // fb post + line broadcast

    const overview = await w.as('owner').http('get', '/analytics/posts').expect(200);
    const fbRow = overview.body.find(
      (r: { platform: string; postTitle: string }) => r.postTitle === 'ประกาศตรวจสุขภาพ',
    );
    const lineRow = overview.body.find(
      (r: { platform: string; postTitle: string }) => r.postTitle === 'ประกาศเตือนภัย',
    );
    expect(fbRow).toBeDefined();
    expect(fbRow.platform).toBe('facebook');
    expect(fbRow.reach).toBeGreaterThan(0);
    expect(typeof fbRow.engagementRate).toBe('number');
    expect(lineRow).toBeDefined();
    expect(lineRow.platform).toBe('line');
    // Same post on two platforms stays two rows; ours differ by platform.
    expect(fbRow.postId).not.toBe(lineRow.postId);

    // Snapshots are append-only: a second collect within the day adds nothing.
    const again = await w.as('owner').http('post', '/analytics/collect').expect(200);
    expect(again.body.captured).toBe(0);
    const snaps = await ownerDb
      .select()
      .from(postMetrics)
      .where(eq(postMetrics.workspaceId, w.workspaceId))
      .orderBy(desc(postMetrics.capturedAt));
    expect(snaps.length).toBeGreaterThanOrEqual(2);
  });
});
