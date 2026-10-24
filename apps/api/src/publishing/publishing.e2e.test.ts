/**
 * P1 walking skeleton, end to end — each test names the PRD AC it proves.
 * Needs `pnpm dev:infra` (Postgres + Redis). The runner is invoked directly instead of
 * waiting for the BullMQ delay, which keeps the tests fast and deterministic.
 */
import type { INestApplication } from '@nestjs/common';
import {
  createDb,
  createPool,
  notifications,
  postVariants,
  publishAttempts,
  publishJobs,
} from '@scm/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';
import type { FakeAdapter } from './adapters/fake.adapter';
import { AdapterRegistry } from './adapters/registry';
import { PublishRunner } from './publish-runner.service';

let app: INestApplication;
let w: World;
let fbAccount: string;
let igAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app);
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจทดสอบ' });
  const ig = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'instagram', name: 'ig' });
  expect(fb.status).toBe(201);
  fbAccount = fb.body.id;
  igAccount = ig.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const runner = () => app.get(PublishRunner);
const fake = () => app.get(AdapterRegistry).get('facebook') as FakeAdapter;
const inTwoMinutes = () => new Date(Date.now() + 2 * 60_000).toISOString();

async function jobFor(variantId: string) {
  const [job] = await ownerDb
    .select()
    .from(publishJobs)
    .where(eq(publishJobs.variantId, variantId));
  return job!;
}

/** draft → in_review → approved → scheduled, returns the variant id. */
async function scheduledVariant(caption: string): Promise<string> {
  const created = await w
    .as('editor')
    .http('post', '/posts')
    .send({ title: 'ทดสอบ', variants: [{ socialAccountId: fbAccount, caption }] })
    .expect(201);
  const id = created.body.variants[0].id as string;
  await w.as('editor').http('post', `/variants/${id}/submit`).expect(200);
  await w.as('approver').http('post', `/variants/${id}/approve`).send({}).expect(200);
  await w
    .as('approver')
    .http('post', `/variants/${id}/schedule`)
    .send({ scheduledAt: inTwoMinutes() })
    .expect(200);
  return id;
}

async function run(variantId: string) {
  const job = await jobFor(variantId);
  return runner().run({ publishJobId: job.id, workspaceId: w.workspaceId });
}

describe('approval workflow', () => {
  it('AUTH AC: a user without approve permission gets 403 and an audit entry', async () => {
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({ title: 'x', variants: [{ socialAccountId: fbAccount, caption: 'สวัสดี' }] })
      .expect(201);
    const id = created.body.variants[0].id;
    await w.as('editor').http('post', `/variants/${id}/submit`).expect(200);
    const denied = await w.as('editor').http('post', `/variants/${id}/approve`).send({});
    expect(denied.status).toBe(403);

    const log = await w.as('owner').http('get', '/workspaces/current/audit-log').expect(200);
    expect(
      log.body.some(
        (e: { action: string; actorUserId: string }) =>
          e.action === 'permission.denied' && e.actorUserId === w.as('editor').userId,
      ),
    ).toBe(true);
  });

  it('POST-04 AC: a variant failing validate() cannot be submitted; reasons are in Thai', async () => {
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({ title: 'ig', variants: [{ socialAccountId: igAccount, caption: 'ไม่มีรูป' }] })
      .expect(201);
    const res = await w
      .as('editor')
      .http('post', `/variants/${created.body.variants[0].id}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.issues[0].messageTh).toMatch(/สื่อ/);
  });

  it('APPR-01: the author cannot approve their own version', async () => {
    const created = await w
      .as('approver')
      .http('post', '/posts')
      .send({ title: 'self', variants: [{ socialAccountId: fbAccount, caption: 'เขียนเอง' }] })
      .expect(201);
    const id = created.body.variants[0].id;
    await w.as('approver').http('post', `/variants/${id}/submit`).expect(200);
    const res = await w.as('approver').http('post', `/variants/${id}/approve`).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('self_approval_forbidden');
  });

  it('NOTI-02 AC: submitting pings the approvers in-app, never the submitter', async () => {
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'รออนุมัติแจ้งเตือน',
        variants: [{ socialAccountId: fbAccount, caption: 'ส่งตรวจ' }],
      })
      .expect(201);
    await w
      .as('editor')
      .http('post', `/variants/${created.body.variants[0].id}/submit`)
      .expect(200);

    const rows = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, w.workspaceId),
          eq(notifications.type, 'approval_requested'),
          eq(notifications.link, `/posts/${created.body.id}`),
        ),
      );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const recipients = new Set(rows.map((r) => r.userId));
    expect(recipients.has(w.as('owner').userId)).toBe(true);
    expect(recipients.has(w.as('admin').userId)).toBe(true);
    expect(recipients.has(w.as('approver').userId)).toBe(true);
    expect(recipients.has(w.as('editor').userId)).toBe(false);
  });

  it('POST AC: editing after approval returns to review and cancels the scheduled job', async () => {
    const id = await scheduledVariant('จะถูกแก้');
    const res = await w
      .as('editor')
      .http('patch', `/variants/${id}`)
      .send({ caption: 'แก้แล้ว' })
      .expect(200);
    expect(res.body.status).toBe('in_review');
    expect(res.body.approvedVersion).toBeNull();
    expect((await jobFor(id)).status).toBe('cancelled');
    expect((await run(id)).status).toBe('skipped');
  });
});

describe('publishing (PUB AC)', () => {
  it('publishes a scheduled, approved variant and stores the external id + permalink', async () => {
    const id = await scheduledVariant('โพสต์ปกติ');
    expect(await run(id)).toEqual({ status: 'succeeded' });
    const post = await w.as('viewer').http('get', `/backlog`).expect(200);
    expect(post.body.find((v: { id: string }) => v.id === id)).toBeUndefined();
    const job = await jobFor(id);
    expect(job.status).toBe('succeeded');
    expect(job.externalPostId).toMatch(/^fake_facebook_/);
    expect(job.permalink).toBeTruthy();
  });

  it('a duplicate wake-up after success does nothing', async () => {
    const id = await scheduledVariant('ปลุกซ้ำ');
    await run(id);
    expect(await run(id)).toEqual({ status: 'skipped', reason: 'job_succeeded' });
  });

  it('network lost after the platform accepted → reconcile, never a duplicate post', async () => {
    const id = await scheduledVariant('เน็ตหลุด [[fail:unknown]]');
    expect(await run(id)).toEqual({ status: 'outcome_unknown' });
    expect(await run(id)).toEqual({ status: 'succeeded' });
    const job = await jobFor(id);
    expect(fake().posts.get(job.idempotencyKey)?.count).toBe(1);
  });

  it('PUB-03: retryable error → retrying → success', async () => {
    const id = await scheduledVariant('ชั่วคราว [[fail:retryable]]');
    expect(await run(id)).toEqual({ status: 'retrying' });
    expect(await run(id)).toEqual({ status: 'succeeded' });
    expect((await jobFor(id)).attempts).toBe(2);
  });

  it('permanent failure → failed and the responsible people are notified', async () => {
    const id = await scheduledVariant('พัง [[fail:permanent]]');
    expect(await run(id)).toEqual({ status: 'failed' });
    const rows = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.workspaceId, w.workspaceId), eq(notifications.type, 'publish_failed')),
      );
    const recipients = new Set(rows.map((r) => r.userId));
    expect(recipients.has(w.as('editor').userId)).toBe(true);
    expect(recipients.has(w.as('approver').userId)).toBe(true);
  });
});

describe('prepare() pre-stage (ADR-0004, PUB-02)', () => {
  it('an early prepare wake-up stores the container handle without publishing; the slot then publishes once', async () => {
    const id = await scheduledVariant('พรีสเตจ');
    const job = await jobFor(id);
    const data = { publishJobId: job.id, workspaceId: w.workspaceId, phase: 'prepare' as const };

    // runAt is +2 min → this is the pre-stage wake-up, not the slot.
    expect(await runner().run(data)).toEqual({ status: 'skipped', reason: 'prestaged' });
    let after = await jobFor(id);
    expect(after.status).toBe('queued');
    expect(after.preparedHandle).toContain('fake_facebook_container_');
    expect(fake().posts.get(after.idempotencyKey)).toBeUndefined(); // nothing published yet

    const variantRow = await ownerDb
      .select({ status: postVariants.status })
      .from(postVariants)
      .where(eq(postVariants.id, id));
    expect(variantRow[0]!.status).toBe('scheduled');

    // A repeated prepare wake-up is a no-op.
    expect(await runner().run(data)).toEqual({ status: 'skipped', reason: 'already_prepared' });

    // The slot wake-up (no phase) publishes — exactly once, reusing the prepared handle.
    expect(await run(id)).toEqual({ status: 'succeeded' });
    after = await jobFor(id);
    expect(fake().posts.get(after.idempotencyKey)?.count).toBe(1);
    const kinds = await ownerDb
      .select({ kind: publishAttempts.kind, outcome: publishAttempts.outcome })
      .from(publishAttempts)
      .where(eq(publishAttempts.jobId, job.id));
    expect(kinds.filter((k) => k.kind === 'prepare')).toEqual([
      { kind: 'prepare', outcome: 'success' },
    ]);
    expect(kinds.filter((k) => k.kind === 'publish')).toHaveLength(1);
  });
});

describe('reschedule (CAL-01)', () => {
  it('moves a scheduled variant in one call: new job armed, old wake-up cancelled, still scheduled', async () => {
    const id = await scheduledVariant('ลากย้าย');
    const firstJob = await jobFor(id);

    const nextDay = new Date(Date.now() + 26 * 3600_000).toISOString();
    const r = await w
      .as('approver')
      .http('post', `/variants/${id}/reschedule`)
      .send({ scheduledAt: nextDay })
      .expect(200);
    expect(r.body.status).toBe('scheduled');

    // Old job cancelled; a new queued job exists for the new slot with a fresh key.
    expect(firstJob!.status).toBe('queued'); // snapshot before
    const jobs = await ownerDb.select().from(publishJobs).where(eq(publishJobs.variantId, id));
    const active = jobs.filter((j) => j.status === 'queued');
    expect(active).toHaveLength(1);
    expect(active[0]!.runAt.toISOString()).toBe(nextDay);
    expect(active[0]!.idempotencyKey).not.toBe(firstJob!.idempotencyKey);

    const [variant] = await ownerDb.select().from(postVariants).where(eq(postVariants.id, id));
    expect(variant!.status).toBe('scheduled');
    expect(variant!.scheduledAt!.toISOString()).toBe(nextDay);
  });

  it('rejects a too-soon slot and a reschedule while the Kill Switch is on', async () => {
    const id = await scheduledVariant('เลื่อนไม่ได้');
    await w
      .as('approver')
      .http('post', `/variants/${id}/reschedule`)
      .send({ scheduledAt: new Date().toISOString() })
      .expect(400); // schedule_too_soon

    await w.as('approver').http('post', '/kill-switch').send({ active: true }).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${id}/reschedule`)
      .send({ scheduledAt: new Date(Date.now() + 3600_000).toISOString() })
      .expect(409); // kill_switch_active (via unschedule/schedule guard)
    await w.as('approver').http('post', '/kill-switch').send({ active: false }).expect(200);
  });
});

describe('POST-07 forbidden words (workspace list)', () => {
  it('a caption containing a workspace forbidden word cannot be submitted; others pass', async () => {
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({ moderation: { forbiddenWords: ['ยาปฏิจุลิชีพ'] } })
      .expect(200);

    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'คำต้องห้าม',
        variants: [{ socialAccountId: fbAccount, caption: 'โฆษณายาปฏิจุลิชีพราคาถูก' }],
      })
      .expect(201);
    const blocked = await w
      .as('editor')
      .http('post', `/variants/${created.body.variants[0].id}/submit`);
    expect(blocked.status).toBe(400);
    expect(
      blocked.body.issues.some(
        (i: { code: string; messageTh: string }) =>
          i.code === 'forbidden_word' && i.messageTh.includes('คำต้องห้าม'),
      ),
    ).toBe(true);

    // Clean caption goes through.
    const clean = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'ไม่มีคำต้องห้าม',
        variants: [{ socialAccountId: fbAccount, caption: 'ประกาศทั่วไปครับ' }],
      })
      .expect(201);
    await w.as('editor').http('post', `/variants/${clean.body.variants[0].id}/submit`).expect(200);

    // Restore the list for other tests.
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({ moderation: { forbiddenWords: [] } })
      .expect(200);
  });
});

describe('calendar filters (CAL-02)', () => {
  const window = `from=${new Date(Date.now() - 3600_000).toISOString()}&to=${new Date(Date.now() + 2 * 3600_000).toISOString()}`;

  it('AC: filters by platform and status; unknown values are rejected', async () => {
    const line = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'line', name: 'oa ทดสอบ' })
      .expect(201);
    const fb = await scheduledVariant('แคลนดาร์ fb');
    const lineCreated = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'แคลนดาร์ line',
        variants: [{ socialAccountId: line.body.id, caption: 'line ประกาศ' }],
      });
    const lineVariant = lineCreated.body.variants[0].id as string;
    await w.as('editor').http('post', `/variants/${lineVariant}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${lineVariant}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${lineVariant}/schedule`)
      .send({ scheduledAt: inTwoMinutes() })
      .expect(200);

    // Other tests share this workspace and window, so assert membership, not exact sets.
    const ids = (r: { body: { id: string }[] }) => r.body.map((v) => v.id);
    const all = await w.as('approver').http('get', `/calendar?${window}`).expect(200);
    expect(ids(all)).toContain(fb);
    expect(ids(all)).toContain(lineVariant);

    const onlyLine = await w
      .as('approver')
      .http('get', `/calendar?${window}&platforms=line`)
      .expect(200);
    expect(ids(onlyLine)).toContain(lineVariant);
    expect(ids(onlyLine)).not.toContain(fb);
    expect(onlyLine.body.every((v: { platform: string }) => v.platform === 'line')).toBe(true);

    // Publish the fb one; a status filter then keeps only it.
    expect(await run(fb)).toEqual({ status: 'succeeded' });
    const publishedFb = await w
      .as('approver')
      .http('get', `/calendar?${window}&platforms=facebook&statuses=published`)
      .expect(200);
    expect(ids(publishedFb)).toContain(fb);
    expect(
      publishedFb.body.every(
        (v: { platform: string; status: string }) =>
          v.platform === 'facebook' && v.status === 'published',
      ),
    ).toBe(true);

    const linePublished = await w
      .as('approver')
      .http('get', `/calendar?${window}&platforms=line&statuses=published`)
      .expect(200);
    expect(linePublished.body).toHaveLength(0);

    await w.as('approver').http('get', `/calendar?${window}&platforms=myspace`).expect(400);
  });
});

describe('Kill Switch (PUB-10)', () => {
  it('pauses everything scheduled, blocks resume while active, then releases', async () => {
    const id = await scheduledVariant('รอ kill switch');
    const on = await w
      .as('approver')
      .http('post', '/kill-switch')
      .send({ active: true })
      .expect(200);
    expect(on.body.paused).toBeGreaterThanOrEqual(1);
    expect((await run(id)).status).toBe('skipped');

    await w
      .as('approver')
      .http('post', '/kill-switch/resume')
      .send({ variantIds: [id] })
      .expect(409);
    await w.as('editor').http('post', '/kill-switch').send({ active: false }).expect(403);

    await w.as('approver').http('post', '/kill-switch').send({ active: false }).expect(200);
    const res = await w
      .as('approver')
      .http('post', '/kill-switch/resume')
      .send({ variantIds: [id] })
      .expect(200);
    expect(res.body.resumed).toBe(1);
    expect(await run(id)).toEqual({ status: 'succeeded' });
  });
});

describe('tenant isolation (AUTH-01 AC)', () => {
  it('a member of A cannot reach B by header or by id', async () => {
    const other = await createWorld(app, 'other');
    const created = await other
      .as('editor')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'facebook', name: 'b' });
    expect(created.status).toBe(403); // editor lacks account.connect
    const acct = await other
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'line', name: 'b' });
    const post = await other
      .as('editor')
      .http('post', '/posts')
      .send({ title: 'ของ B', variants: [{ socialAccountId: acct.body.id, caption: 'B' }] })
      .expect(201);

    // A's token with B's workspace header → not a member.
    const byHeader = await w
      .as('editor')
      .http('get', `/posts/${post.body.id}`)
      .set('x-workspace-id', other.workspaceId);
    expect(byHeader.status).toBe(403);
    // A's own workspace, B's post id → invisible.
    const byId = await w.as('editor').http('get', `/posts/${post.body.id}`);
    expect(byId.status).toBe(404);
  });
});

describe('membership (AUTH-06/07)', () => {
  it('cannot remove an owner when only the minimum remain; revoke reports connected accounts', async () => {
    const res = await w
      .as('owner')
      .http('delete', `/workspaces/current/members/${w.as('owner').userId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('min_owners');

    const revoked = await w
      .as('owner')
      .http('delete', `/workspaces/current/members/${w.as('admin').userId}`)
      .expect(200);
    expect(revoked.body.connectedAccounts.length).toBeGreaterThanOrEqual(2);
    expect(revoked.body.sessionsRevoked).toBeGreaterThanOrEqual(1);
    // The admin's session is dead immediately.
    await w.as('admin').http('get', '/accounts').expect(401);
  });
});
