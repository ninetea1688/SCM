/**
 * P1 walking skeleton, end to end — each test names the PRD AC it proves.
 * Needs `pnpm dev:infra` (Postgres + Redis). The runner is invoked directly instead of
 * waiting for the BullMQ delay, which keeps the tests fast and deterministic.
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, notifications, publishJobs } from '@scm/db';
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
