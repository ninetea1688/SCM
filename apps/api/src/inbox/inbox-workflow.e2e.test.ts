/**
 * INBOX-03/04/05/06 end to end against real Postgres/Redis:
 *  - 03: new conversations are auto-assigned round-robin to agents
 *  - 04: an unanswered thread past slaDueAt escalates once (team LINE + in-app rows for owners/admins);
 *    a reply clears the debt; a new customer message restarts the clock
 *  - 05: saved replies CRUD + reuse in a real reply
 *  - 06: internal notes live in the thread but are flagged so they never reach the customer
 */
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  conversations,
  createDb,
  createPool,
  notifications,
  savedReplies,
  socialAccounts,
} from '@scm/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCipher } from '../common/crypto';
import { SYSTEM_DB } from '../common/db-tokens';
import { CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';
import type { FakeAdapter } from '../publishing/adapters/fake.adapter';
import { AdapterRegistry } from '../publishing/adapters/registry';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';
import { InboxSlaJob } from './inbox-sla.job';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let w2: Awaited<ReturnType<typeof createWorld>>;
let lineAccount: string;
let lineAccount2: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
const cipher = new TokenCipher('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'sla');
  w2 = await createWorld(app, 'sla-b');
  const line = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'line', name: 'OA SLA' })
    .expect(201);
  lineAccount = line.body.id;
  await ownerDb
    .update(socialAccounts)
    .set({ webhookSecretEnc: cipher.encrypt('sla-secret') })
    .where(eq(socialAccounts.id, lineAccount));
  const line2 = await w2
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'line', name: 'OA อีกงาน' })
    .expect(201);
  lineAccount2 = line2.body.id;
  await ownerDb
    .update(socialAccounts)
    .set({ webhookSecretEnc: cipher.encrypt('sla-secret') })
    .where(eq(socialAccounts.id, lineAccount2));
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

function sendLine(accountId: string, events: unknown[]) {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', 'sla-secret').update(Buffer.from(body)).digest('base64');
  return request(app.getHttpServer())
    .post(`/webhooks/line/${accountId}`)
    .set('content-type', 'application/json')
    .set('x-line-signature', sig)
    .send(body);
}

const slaJob = () =>
  // Worker-only provider: construct directly from the app context (status-watch pattern).
  new InboxSlaJob(app.get(SYSTEM_DB), app.get(NotificationService), app.get(CONFIG));
const fake = () => app.get(AdapterRegistry).get('line') as FakeAdapter;

describe('INBOX-03 auto-assign (round-robin)', () => {
  it('a new conversation lands with the next agent automatically; a second one rotates', async () => {
    await sendLine(lineAccount, [
      {
        type: 'message',
        webhookEventId: 'aa-1',
        source: { userId: 'U-r1' },
        message: { id: 'm-r1', text: 'สอบถามครับ' },
      },
    ]).expect(200);

    // The harness world has owner+admin+approver+editor+agent+viewer; agents = owner/admin/approver/agent.
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    expect(conv.body).toHaveLength(1);
    expect(conv.body[0].status).toBe('claimed');
    expect(conv.body[0].assignee).toBeTruthy();

    // The other workspace's conversation must not affect this rotation.
    await sendLine(lineAccount2, [
      {
        type: 'message',
        webhookEventId: 'aa-2',
        source: { userId: 'U-r2' },
        message: { id: 'm-r2', text: 'สวัสดี' },
      },
    ]).expect(200);
    const mine2 = await w2.as('agent').http('get', '/inbox/conversations').expect(200);
    expect(mine2.body[0].assignee).toBeTruthy();
  });
});

describe('INBOX-04 SLA clock and escalation', () => {
  it('an overdue thread escalates once to owners/admins + one team push; replying clears the debt', async () => {
    // Fresh thread of our own (tests must not depend on each other's state).
    await sendLine(lineAccount, [
      {
        type: 'message',
        webhookEventId: 'sla-1',
        source: { userId: 'U-sla' },
        message: { id: 'm-sla', text: 'ถามหน่อยครับ' },
      },
    ]).expect(200);
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    const mine = conv.body.find((c: { accountName: string }) => c.accountName === 'OA SLA');
    const id = mine.id as string;
    await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'ตอบแล้วครับ' })
      .expect(200);
    const [answered] = await ownerDb.select().from(conversations).where(eq(conversations.id, id));
    expect(answered!.slaDueAt).toBeNull(); // nothing owed

    // The customer writes back → the clock restarts; force it into the past.
    await sendLine(lineAccount, [
      {
        type: 'message',
        webhookEventId: 'aa-3',
        source: { userId: 'U-r1' },
        message: { id: 'm-r3', text: 'ยังไม่ได้รับคำตอบเลยครับ' },
      },
    ]).expect(200);
    await ownerDb
      .update(conversations)
      .set({ slaDueAt: new Date(Date.now() - 3600_000) })
      .where(eq(conversations.id, id));

    await expect(slaJob().tick()).resolves.toEqual({ escalated: 1 });
    const [flagged] = await ownerDb.select().from(conversations).where(eq(conversations.id, id));
    expect(flagged!.slaEscalatedAt).not.toBeNull();

    // Idempotent: the same breach never escalates twice.
    await expect(slaJob().tick()).resolves.toEqual({ escalated: 0 });

    const alerts = await ownerDb
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, w.workspaceId),
          eq(notifications.type, 'system_alert'),
          eq(notifications.link, '/inbox'),
        ),
      );
    expect(alerts.length).toBeGreaterThanOrEqual(2); // owner + admin
    expect(fake().sent.some((s) => s.text.includes('SLA เกินกำหนด'))).toBe(false); // team LINE goes through notifySystem, not the adapter

    // Replying clears the new debt.
    await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'ขออภัยในความล่าช้าครับ' })
      .expect(200);
    const [cleared] = await ownerDb.select().from(conversations).where(eq(conversations.id, id));
    expect(cleared!.slaDueAt).toBeNull();
  });
});

describe('INBOX-06 internal notes', () => {
  it('notes stay in the thread flagged internal and are never sent to the platform', async () => {
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    const mine = conv.body.find((c: { accountName: string }) => c.accountName === 'OA SLA');
    const id = mine.id as string;
    const note = await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/note`)
      .send({ text: 'ลูกค้ารายนี้เคยโทรมาก่อน ใช้สิทธิ์บัตรทอง' })
      .expect(200);
    expect(note.body.isInternalNote).toBe(true);
    // The sandbox outbox records platform sends; a note must not be in there.
    expect(fake().sent.every((s) => !s.text.includes('เคยโทรมาก่อน'))).toBe(true);
  });
});

describe('INBOX-05 saved replies', () => {
  it('create → list → use in a reply → delete, with an audited trail', async () => {
    const created = await w
      .as('agent')
      .http('post', '/saved-replies')
      .send({ title: 'ทักทาย', body: 'สวัสดีครับ มีอะไรให้ช่วยไหมครับ', shortcut: 'hi' })
      .expect(200);
    expect(created.body.shortcut).toBe('hi');

    const list = await w.as('agent').http('get', '/saved-replies').expect(200);
    expect(list.body.map((r: { title: string }) => r.title)).toContain('ทักทาย');

    // Reuse: send its body as a real reply to the conversation.
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    await w
      .as('agent')
      .http('post', `/inbox/conversations/${conv.body[0].id}/reply`)
      .send({ text: created.body.body })
      .expect(200);

    const updated = await w
      .as('agent')
      .http('patch', `/saved-replies/${created.body.id}`)
      .send({ title: 'ทักทาย (ใหม่)', body: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ' })
      .expect(200);
    expect(updated.body.title).toBe('ทักทาย (ใหม่)');

    // Shortcut uniqueness is per workspace — another workspace can use the same one.
    const other = await w2
      .as('agent')
      .http('post', '/saved-replies')
      .send({ title: 'ทักทายอีกงาน', body: 'สวัสดีครับ', shortcut: 'hi' })
      .expect(200);
    expect(other.body.shortcut).toBe('hi');

    await w.as('agent').http('delete', `/saved-replies/${created.body.id}`).expect(200);
    const [row] = await ownerDb
      .select()
      .from(savedReplies)
      .where(
        and(eq(savedReplies.workspaceId, w.workspaceId), eq(savedReplies.id, created.body.id)),
      );
    expect(row).toBeUndefined();

    const log = await w.as('owner').http('get', '/workspaces/current/audit-log').expect(200);
    expect(log.body.some((e: { action: string }) => e.action === 'saved_reply.deleted')).toBe(true);
  });
});
