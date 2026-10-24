/**
 * INBOX-07/08/09 end to end against real Postgres/Redis:
 *  - 07: an inbound message outside working hours gets one polite auto-answer (deduped);
 *    a workspace can configure its own hours (empty workdays = always closed)
 *  - 08: the desk reports the per-platform reply window (LINE = unlimited → null)
 *  - 09: an agent's reply containing sensitive keywords waits as 'pending'; a supervisor
 *    approval sends it through the adapter; a rejection returns it without sending
 */
import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, socialAccounts, workspaces } from '@scm/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCipher } from '../common/crypto';
import type { FakeAdapter } from '../publishing/adapters/fake.adapter';
import { AdapterRegistry } from '../publishing/adapters/registry';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';

let app: INestApplication;
let w: World;
let lineAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
const cipher = new TokenCipher('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'rules');
  const line = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'line', name: 'OA กฎเวลา' })
    .expect(201);
  lineAccount = line.body.id;
  await ownerDb
    .update(socialAccounts)
    .set({ webhookSecretEnc: cipher.encrypt('rules-secret') })
    .where(eq(socialAccounts.id, lineAccount));
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

function sendLine(events: unknown[]) {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', 'rules-secret').update(Buffer.from(body)).digest('base64');
  return request(app.getHttpServer())
    .post(`/webhooks/line/${lineAccount}`)
    .set('content-type', 'application/json')
    .set('x-line-signature', sig)
    .send(body);
}

const fake = () => app.get(AdapterRegistry).get('line') as FakeAdapter;

describe('INBOX-07 out-of-hours auto-reply', () => {
  it('answers once outside working hours and stays silent on the next message', async () => {
    // Always-closed configuration: no working days → every moment is out of hours.
    await ownerDb
      .update(workspaces)
      .set({ settings: { inboxWorkingHours: { start: '09:00', end: '17:00', workdays: [] } } })
      .where(eq(workspaces.id, w.workspaceId));

    await sendLine([
      {
        type: 'message',
        webhookEventId: 'ar-1',
        source: { userId: 'U-ar' },
        message: { id: 'm-ar-1', text: 'เปิดไหมครับ' },
      },
    ]).expect(200);

    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    const mine = conv.body.find((c: { accountName: string }) => c.accountName === 'OA กฎเวลา');
    const msgs = await w
      .as('agent')
      .http('get', `/inbox/conversations/${mine.id}/messages`)
      .expect(200);
    const auto = msgs.body.find((m: { isAutoReply: boolean }) => m.isAutoReply);
    expect(auto).toBeDefined();
    expect(auto.text).toContain('นอกเวลาทำการ');
    expect(fake().sent.some((s) => s.text.includes('นอกเวลาทำการ'))).toBe(true);

    // A second message while the auto-answer is still the last word → no nag.
    const before = fake().sent.filter((s) => s.text.includes('นอกเวลาทำการ')).length;
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'ar-2',
        source: { userId: 'U-ar' },
        message: { id: 'm-ar-2', text: 'หรือยังไม่เปิด' },
      },
    ]).expect(200);
    const after = fake().sent.filter((s) => s.text.includes('นอกเวลาทำการ')).length;
    expect(after).toBe(before);

    // Restore default hours for the later tests.
    await ownerDb.update(workspaces).set({ settings: {} }).where(eq(workspaces.id, w.workspaceId));
  });
});

describe('INBOX-08 reply window per platform', () => {
  it('reports the window deadline; LINE (unlimited) answers null', async () => {
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'rw-1',
        source: { userId: 'U-rw' },
        message: { id: 'm-rw-1', text: 'สอบถามครับ' },
      },
    ]).expect(200);
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    const mine = conv.body.find((c: { accountName: string }) => c.accountName === 'OA กฎเวลา');
    expect(mine.replyWindowUntil).toBeNull(); // LINE push has no 24-hour window
  });
});

describe('INBOX-09 sensitive replies need supervisor approval', () => {
  it('agent sensitive reply waits as pending; approval sends it, rejection does not', async () => {
    await sendLine([
      {
        type: 'message',
        webhookEventId: 'sv-1',
        source: { userId: 'U-sv' },
        message: { id: 'm-sv-1', text: 'จะฟ้องร้องราชการไหมครับ' },
      },
    ]).expect(200);
    const conv = await w.as('agent').http('get', '/inbox/conversations').expect(200);
    const mine = conv.body.find((c: { accountName: string }) => c.accountName === 'OA กฎเวลา');
    const id = mine.id as string;

    // Agent drafts something containing a default sensitive keyword → held as pending.
    const pending = await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'เรื่องที่จะฟ้องร้องกรุณาติดต่อฝ่ายกฎหมายครับ' })
      .expect(200);
    expect(pending.body.status).toBe('pending');
    expect(fake().sent.some((s) => s.text.includes('ฟ้องร้อง'))).toBe(false); // nothing sent

    // A supervisor rejection returns it without sending.
    const rejected = await w
      .as('approver')
      .http('post', `/inbox/messages/${pending.body.id}/reject`)
      .expect(200);
    expect(rejected.body.status).toBe('rejected');
    expect(fake().sent.some((s) => s.text.includes('ฟ้องร้อง'))).toBe(false);

    // Draft again → supervisor approval pushes it through the adapter.
    const pending2 = await w
      .as('agent')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'กรณีฟ้องร้องขอให้ติดต่อฝ่ายกฎหมายตามช่องทางที่ระบุครับ' })
      .expect(200);
    const approved = await w
      .as('admin')
      .http('post', `/inbox/messages/${pending2.body.id}/approve`)
      .expect(200);
    expect(approved.body.status).toBe('sent');
    expect(approved.body.externalId).toBeTruthy();
    expect(fake().sent.some((s) => s.text.includes('ฟ้องร้อง'))).toBe(true);

    // Supervisors themselves are never gated.
    const direct = await w
      .as('approver')
      .http('post', `/inbox/conversations/${id}/reply`)
      .send({ text: 'เรื่องฟ้องร้องติดต่อฝ่ายกฎหมายได้เลยครับ' })
      .expect(200);
    expect(direct.body.status).toBe('sent');
  });
});
