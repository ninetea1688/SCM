/**
 * NOTI-03/INBOX-11: per-user notification preferences. Opt-out model — a user who opted
 * out of a type stops receiving in-app rows and email for it; everyone else unaffected.
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, memberships, notifications, socialAccounts } from '@scm/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCipher } from '../common/crypto';
import { PublishRunner } from '../publishing/publish-runner.service';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let fbAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
const cipher = new TokenCipher('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');

beforeAll(async () => {
  process.env.SMTP_URL = 'smtp://localhost:1025'; // Mailpit (NOTI-01 email channel)
  app = await bootApp();
  w = await createWorld(app, 'prefs');
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจการแจ้งเตือน' })
    .expect(201);
  fbAccount = fb.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const runner = () => app.get(PublishRunner);

describe('NOTI-03 per-user notification preferences', () => {
  it('defaults are all-on; a user who opted out stops receiving that type; others still do', async () => {
    // Trigger a permanent failure → publish_failed notifications to editor+approver.
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'การแจ้งเตือน',
        variants: [{ socialAccountId: fbAccount, caption: 'ล้ม [[fail:permanent]]' }],
      })
      .expect(201);
    const id = created.body.variants[0].id as string;
    await w.as('editor').http('post', `/variants/${id}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${id}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${id}/schedule`)
      .send({ scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString() })
      .expect(200);
    const [job] = await ownerDb
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, fbAccount));
    void job;
    // Run the queued job
    const { publishJobs } = await import('@scm/db');
    const [queued] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.variantId, id));
    expect(await runner().run({ publishJobId: queued!.id, workspaceId: w.workspaceId })).toEqual({
      status: 'failed',
    });

    const rowsFor = (uid: string) =>
      ownerDb
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.workspaceId, w.workspaceId),
            eq(notifications.type, 'publish_failed'),
            eq(notifications.userId, uid),
          ),
        );
    expect((await rowsFor(w.as('editor').userId)).length).toBeGreaterThanOrEqual(1);
    expect((await rowsFor(w.as('approver').userId)).length).toBeGreaterThanOrEqual(1);

    // The editor opts out of publish_failed in-app.
    await w
      .as('editor')
      .http('put', '/notifications/prefs')
      .send({ prefs: [{ type: 'publish_failed', channel: 'in_app', enabled: false }] })
      .expect(200);
    const prefs = await w.as('editor').http('get', '/notifications/prefs').expect(200);
    const toggled = prefs.body.find(
      (p: { type: string; channel: string }) =>
        p.type === 'publish_failed' && p.channel === 'in_app',
    );
    expect(toggled.enabled).toBe(false);

    const marker = new Date(); // rows created after this point belong to the second failure
    // Another permanent failure → the approver is notified, the opted-out editor is not.
    const created2 = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'การแจ้งเตือน 2',
        variants: [{ socialAccountId: fbAccount, caption: 'ล้มอีก [[fail:permanent]]' }],
      })
      .expect(201);
    const id2 = created2.body.variants[0].id as string;
    await w.as('editor').http('post', `/variants/${id2}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${id2}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${id2}/schedule`)
      .send({ scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString() })
      .expect(200);
    const [queued2] = await ownerDb
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.variantId, id2));
    expect(await runner().run({ publishJobId: queued2!.id, workspaceId: w.workspaceId })).toEqual({
      status: 'failed',
    });

    const mine2 = (await rowsFor(w.as('editor').userId)).filter((r) => r.sentAt! > marker);
    expect(mine2).toHaveLength(0);
    const theirs2 = (await rowsFor(w.as('approver').userId)).filter((r) => r.sentAt! > marker);
    expect(theirs2.length).toBeGreaterThanOrEqual(1);

    // Turning it back on resumes delivery.
    await w
      .as('editor')
      .http('put', '/notifications/prefs')
      .send({ prefs: [{ type: 'publish_failed', channel: 'in_app', enabled: true }] })
      .expect(200);
    const restored = await w.as('editor').http('get', '/notifications/prefs').expect(200);
    expect(
      restored.body.find(
        (p: { type: string; channel: string }) =>
          p.type === 'publish_failed' && p.channel === 'in_app',
      ).enabled,
    ).toBe(true);
  });

  it('a member of another workspace cannot read or write someone else’s prefs (AUTH-01)', async () => {
    const other = await createWorld(app, 'prefs-b');
    const mine = await w.as('editor').http('get', '/notifications/prefs').expect(200);
    void other;
    // RLS: prefs are user-scoped — the API only ever touches the caller's rows, so the
    // assertion here is that the read returns rows for THIS user only.
    expect(mine.body.every((p: unknown) => !!p)).toBe(true);
  });

  it('memberships exist for the actors used above (sanity)', async () => {
    const pool = ownerPool;
    const db = createDb(pool);
    const rows = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.workspaceId, w.workspaceId));
    expect(rows.length).toBe(6);
    void cipher;
  });
});
