/**
 * PUB-08: GET /accounts/:id/publish-preview — the recipients/quota preview shown
 * before a user confirms a LINE broadcast. Sandbox accounts answer "unknown";
 * live-adapter behaviour is unit-tested in adapters.test.ts.
 */
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, type World } from '../test/harness';

let app: INestApplication;
let w: World;
let other: World;

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'preview');
  other = await createWorld(app, 'preview-other');
});

afterAll(async () => {
  await app.close();
});

describe('publish-preview (PUB-08)', () => {
  it('a sandbox LINE account previews with unknown recipients and no quota', async () => {
    const acct = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'line', name: 'oa ทดสอบ' })
      .expect(201);
    const r = await w
      .as('editor')
      .http('get', `/accounts/${acct.body.id}/publish-preview`)
      .expect(200);
    expect(r.body).toEqual({ recipients: null, quota: [] });
  });

  it('a platform without follower insight answers recipients null', async () => {
    const acct = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'facebook', name: 'เพจ ทดสอบ' })
      .expect(201);
    const r = await w
      .as('editor')
      .http('get', `/accounts/${acct.body.id}/publish-preview`)
      .expect(200);
    expect(r.body).toEqual({ recipients: null, quota: [] });
  });

  it('another workspace cannot preview someone else’s account (AUTH-01)', async () => {
    const acct = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'line', name: 'oa' })
      .expect(201);
    await other.as('owner').http('get', `/accounts/${acct.body.id}/publish-preview`).expect(404);
  });
});
