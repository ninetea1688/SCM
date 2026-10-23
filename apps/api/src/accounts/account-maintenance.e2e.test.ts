/**
 * CONN-05/07 AC: the maintenance sweep disconnects an account whose token the
 * platform rejects, alerts owners/admins immediately (in-app rows), and the
 * prepare wake-up reports a dead account before the slot. Needs `pnpm dev:infra`.
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, notifications, publishJobs, socialAccounts } from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TokenCipher } from '../common/crypto';
import { loadConfig } from '../config';
import { PublishRunner } from '../publishing/publish-runner.service';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';
import { AccountHealthService } from './account-health.service';

let app: INestApplication;
let w: World;
let accountId: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
const cipher = new TokenCipher(
  loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv).TOKEN_ENC_KEYS,
);

const expired = vi.fn(async () =>
  Response.json({ error: { code: 190, message: 'token expired' } }, { status: 400 }),
);
const transient = vi.fn(async () => new Response('{}', { status: 500 }));
const healthy = vi.fn(async () => Response.json({ id: 'PAGE' }, { status: 200 }));

/** Make the sandbox account look like a real (non-sandbox) facebook Page. */
async function asLiveAccount() {
  await ownerDb
    .update(socialAccounts)
    .set({ scopes: [], platform: 'facebook', accessTokenEnc: cipher.encrypt('dead-token') })
    .where(eq(socialAccounts.id, accountId));
}

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'conn');
  const res = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจทดสอบสุขภาพ' })
    .expect(201);
  accountId = res.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const health = () => app.get(AccountHealthService);
const runner = () => app.get(PublishRunner);
const accountRow = async () => {
  const [a] = await ownerDb.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
  return a!;
};

describe('CONN-05 maintenance sweep', () => {
  it('a transient error keeps the account active (only lastCheckedAt moves)', async () => {
    await asLiveAccount();
    const r = await health().runMaintenance(transient as unknown as typeof fetch);
    expect(r.checked).toBeGreaterThan(0);
    const a = await accountRow();
    expect(a.status).toBe('active');
    expect(a.lastCheckedAt).toBeTruthy();
  });

  it('an auth failure disconnects the account and alerts owners/admins at once (CONN-07)', async () => {
    await asLiveAccount();
    const r = await health().runMaintenance(expired as unknown as typeof fetch);
    expect(r.disconnected).toBeGreaterThanOrEqual(1);
    const a = await accountRow();
    expect(a.status).toBe('disconnected');
    expect(a.lastError).toContain('เชื่อมต่อใหม่');

    const alerts = await ownerDb
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'account_disconnected'));
    const ours = alerts.filter((n) => n.workspaceId === w.workspaceId);
    expect(ours.length).toBeGreaterThanOrEqual(2); // owner + admin
    expect(ours[0]!.title).toContain('เพจทดสอบสุขภาพ');
    expect(ours[0]!.link).toBe('/accounts');
  });

  it('a healthy probe restores an account that was merely flagged', async () => {
    // Reconnect (upsert sets active) then prove the sweep keeps it active.
    await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'facebook', name: 'เพจทดสอบสุขภาพ' })
      .expect(201);
    await asLiveAccount();
    const r = await health().runMaintenance(healthy as unknown as typeof fetch);
    expect(r.disconnected).toBe(0);
    expect((await accountRow()).status).toBe('active');
  });
});

describe('CONN-05 pre-slot health check (prepare wake-up)', () => {
  it('reports the dead account before the slot and the slot then fails loudly', async () => {
    await asLiveAccount();
    // schedule an approved variant on this account
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({ title: 'พรีเช็ก', variants: [{ socialAccountId: accountId, caption: 'ตรวจก่อนสล็อต' }] })
      .expect(201);
    const variantId = created.body.variants[0].id as string;
    await w.as('editor').http('post', `/variants/${variantId}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${variantId}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${variantId}/schedule`)
      .send({ scheduledAt: new Date(Date.now() + 2 * 60_000).toISOString() })
      .expect(200);
    const [job] = await ownerDb
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.variantId, variantId));

    const first = await runner().run({
      publishJobId: job!.id,
      workspaceId: w.workspaceId,
      phase: 'prepare',
    });
    expect(first).toEqual({ status: 'skipped', reason: 'account_disconnected_precheck' });
    expect((await accountRow()).status).toBe('disconnected');

    const slot = await runner().run({ publishJobId: job!.id, workspaceId: w.workspaceId });
    expect(slot).toEqual({ status: 'failed' });
    const [after] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.id, job!.id));
    expect(after!.errorCode).toBe('account_disconnected');
  });
});
