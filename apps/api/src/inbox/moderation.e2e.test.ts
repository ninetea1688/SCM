import type { INestApplication } from '@nestjs/common';
import { createDb, createPool } from '@scm/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenCipher } from '../common/crypto';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';

let app: INestApplication;
let w: World;
let fbAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const _ownerDb = createDb(ownerPool);
const _cipher = new TokenCipher('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE=');

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'mod');
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจมอดิเรต' })
    .expect(201);
  fbAccount = fb.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

function sendMeta(changes: unknown[]) {
  return request(app.getHttpServer())
    .post(`/webhooks/meta/feed/${fbAccount}`)
    .set('content-type', 'application/json')
    .send(JSON.stringify({ object: 'page', entry: [{ changes }] }));
}

let n = 0;
function comment(text: string, from = 'ประชาชน ดี') {
  n++;
  return {
    field: 'feed',
    value: {
      item: 'comment',
      verb: 'add',
      comment_id: `mod-${n}`,
      post_id: `P-${n}`,
      from_name: from,
      message: text,
    },
  };
}

describe('MOD-02/03 comment moderation', () => {
  it('forbidden words auto-hide, borderline words queue for a human, unhide restores', async () => {
    // Owner configures the lists (PRD §0 / MOD-02).
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({
        moderation: {
          forbiddenWords: ['คาสิโน'],
          borderlineWords: ['ขอความเป็นธรรม'],
          watchAccounts: ['ติดตามเสมอ'],
        },
      })
      .expect(200);

    await sendMeta([
      comment('ฝากเว็บคาสิโนสิครับ'), // forbidden → auto-hidden
      comment('ขอความเป็นธรรมกับหน่วยงานด้วยครับ'), // borderline → pending queue
      comment('ขอบคุณครับ'), // clean → open
      comment('สอบถามครับ', 'ติดตามเสมอ'), // watched account → pending queue
    ]).expect(200);

    const open = await w.as('agent').http('get', '/comments?status=open').expect(200);
    expect(open.body).toHaveLength(1);
    const pending = await w.as('agent').http('get', '/comments?status=pending').expect(200);
    expect(pending.body).toHaveLength(2);
    const hidden = await w.as('agent').http('get', '/comments?status=hidden').expect(200);
    expect(hidden.body).toHaveLength(1);
    expect(hidden.body[0].text).toContain('คาสิโน');

    // MOD-03: staff decides the borderline ones — hide one, keep (unhide route restores) the other.
    const keep = pending.body.find((c: { text: string }) => c.text.includes('ขอความเป็นธรรม'));
    await w.as('agent').http('post', `/comments/${keep.id}/unhide`).expect(200);
    const nowOpen = await w.as('agent').http('get', '/comments?status=open').expect(200);
    expect(nowOpen.body).toHaveLength(2);

    const watched = pending.body.find((c: { authorName: string }) => c.authorName === 'ติดตามเสมอ');
    await w
      .as('agent')
      .http('post', `/comments/${watched.id}/hide`)
      .send({ reason: 'สแปมซ้ำ' })
      .expect(200);

    // Redelivery of the SAME comment id never resurrects or duplicates it.
    const forbidden = hidden.body[0];
    await sendMeta([
      {
        field: 'feed',
        value: {
          item: 'comment',
          verb: 'add',
          comment_id: forbidden.externalCommentId,
          post_id: forbidden.externalPostId,
          from_name: 'ประชาชน ดี',
          message: forbidden.text,
        },
      },
    ]).expect(200);
    const stillHidden = await w.as('agent').http('get', '/comments?status=hidden').expect(200);
    expect(stillHidden.body).toHaveLength(2); // forbidden + the one staff hid — no duplicate
  });

  it('moderation lists are owner-only and audited; editor gets 403', async () => {
    await w
      .as('editor')
      .http('patch', '/workspaces/current/settings')
      .send({ moderation: { forbiddenWords: ['x'] } })
      .expect(403);
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({ moderation: { forbiddenWords: ['คำต้องห้ามใหม่'] } })
      .expect(200);
    const ws = await w.as('viewer').http('get', '/workspaces/current').expect(200);
    expect(ws.body.settings.moderation.forbiddenWords).toEqual(['คำต้องห้ามใหม่']);
    const log = await w.as('owner').http('get', '/workspaces/current/audit-log').expect(200);
    expect(log.body.some((e: { action: string }) => e.action === 'workspace.settings')).toBe(true);
  });
});
