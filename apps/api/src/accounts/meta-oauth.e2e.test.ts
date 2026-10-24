/**
 * CONN-01 OAuth round trip: start returns the consent-dialog URL with a signed state;
 * the public callback verifies the state, exchanges the code and stores every Page and
 * its Instagram Professional account. The Graph HTTP chain is stubbed — real-Meta
 * verification is an owner action (Meta App review).
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, socialAccounts } from '@scm/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

process.env.META_APP_ID = 'test-app';
process.env.META_APP_SECRET = 'test-secret';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'oauth');
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

describe('Meta OAuth (CONN-01)', () => {
  it('start returns the consent-dialog URL with client, redirect and scope', async () => {
    const r = await w.as('admin').http('get', '/accounts/meta/oauth/start').expect(200);
    expect(r.body.redirectUrl).toContain('https://www.facebook.com/v24.0/dialog/oauth');
    expect(r.body.redirectUrl).toContain('client_id=test-app');
    expect(r.body.redirectUrl).toContain('scope=pages_show_list');
    expect(new URL(r.body.redirectUrl).searchParams.get('state')!.split('.')).toHaveLength(4);
  });

  it('the callback exchanges the code, stores Pages + IG and redirects back to /accounts', async () => {
    const start = await w.as('admin').http('get', '/accounts/meta/oauth/start').expect(200);
    const state = new URL(start.body.redirectUrl).searchParams.get('state')!;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'SHORT' })) // code exchange
      .mockResolvedValueOnce(Response.json({ access_token: 'LONG' })) // fb_exchange_token
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: 'PAGE1',
              name: 'เพจหลัก',
              access_token: 'PT1',
              instagram_business_account: { id: 'IG1', username: 'nhso.ig' },
            },
            { id: 'PAGE2', name: 'เพจรอง', access_token: 'PT2' },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await request(app.getHttpServer())
        .get(`/api/accounts/meta/oauth/callback?code=abc&state=${encodeURIComponent(state)}`)
        .expect(302);
      expect(res.headers.location).toBe('http://localhost:3000/accounts?connected=meta&added=3');
    } finally {
      vi.unstubAllGlobals();
    }

    const rows = await ownerDb
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.workspaceId, w.workspaceId));
    expect(rows.map((r) => `${r.platform}:${r.externalId}`).sort()).toEqual([
      'facebook:PAGE1',
      'facebook:PAGE2',
      'instagram:IG1',
    ]);
  });

  it('a forged state never reaches the exchange and bounces back with an error', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/accounts/meta/oauth/callback?code=abc&state=garbage')
      .expect(302);
    // A bad signature returns before any Graph call (the service short-circuits).
    expect(res.headers.location).toContain('connected=error&reason=bad_state');
  });
});
