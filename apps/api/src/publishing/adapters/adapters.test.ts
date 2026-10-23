import { createHmac } from 'node:crypto';
import type { PublishRequest } from '@scm/domain';
import { describe, expect, it, vi } from 'vitest';
import { parseMetaSignedRequest, verifyLineSignature } from '../../webhooks/signatures';
import { FacebookAdapter } from './facebook.adapter';
import { LineAdapter, retryKey } from './line.adapter';

const req = (caption: string, media: PublishRequest['media'] = []): PublishRequest => ({
  jobId: 'j1',
  idempotencyKey: 'pub:v1:v1:2026-10-23T03:00:00.000Z',
  variant: { platform: 'facebook', caption },
  media,
  account: { socialAccountId: 'a1', externalId: 'PAGE', accessToken: 'TOKEN' },
  attemptStartedAt: new Date('2026-10-23T03:00:00Z'),
});

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers }));

describe('FacebookAdapter', () => {
  it('posts text to /feed with the token in a header, never in the URL or trace', async () => {
    const f = respond(200, { id: 'PAGE_123' });
    const r = await new FacebookAdapter('v24.0', f).publish(req('สวัสดี https://nhso.go.th'));
    expect(r.outcome).toMatchObject({ kind: 'success', externalPostId: 'PAGE_123' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v24.0/PAGE/feed');
    expect(url).not.toContain('TOKEN');
    expect(JSON.parse(String(init.body))).toMatchObject({ link: 'https://nhso.go.th' });
    expect(JSON.stringify(r.trace)).not.toContain('TOKEN');
  });

  it.each([
    [400, { error: { code: 190, message: 'expired' } }, 'permanent'],
    [400, { error: { code: 4, message: 'rate' } }, 'retryable'],
    [500, { error: { code: 0, message: 'boom' } }, 'unknown'],
    [400, { error: { code: 100, message: 'bad param' } }, 'permanent'],
  ])('classifies HTTP %i %j as %s', async (status, body, kind) => {
    const r = await new FacebookAdapter('v24.0', respond(status, body)).publish(req('x'));
    expect(r.outcome.kind).toBe(kind);
  });

  it('a network error on the final write is unknown, not retryable', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const r = await new FacebookAdapter('v24.0', f).publish(req('x'));
    expect(r.outcome.kind).toBe('unknown');
  });

  it('reconcile finds the post by exact message since the attempt', async () => {
    const f = respond(200, {
      data: [{ id: 'P_9', message: 'ข่าวดี', permalink_url: 'https://fb/p9' }],
    });
    const found = await new FacebookAdapter('v24.0', f).reconcile(req('ข่าวดี'));
    expect(found).toEqual({ kind: 'success', externalPostId: 'P_9', permalink: 'https://fb/p9' });
    expect(await new FacebookAdapter('v24.0', f).reconcile(req('อื่น'))).toBeNull();
  });
});

describe('LineAdapter', () => {
  it('sends a deterministic UUID retry key and treats 409+accepted id as success', async () => {
    const f = respond(409, { message: 'dup' }, { 'x-line-accepted-request-id': 'acc-1' });
    const r = await new LineAdapter(f).publish(req('ประกาศ'));
    expect(r.outcome).toEqual({ kind: 'success', externalPostId: 'acc-1' });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    const key = (init.headers as Record<string, string>)['x-line-retry-key'];
    expect(key).toBe(retryKey('pub:v1:v1:2026-10-23T03:00:00.000Z'));
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('5xx is retryable because the retry key makes resend safe', async () => {
    const r = await new LineAdapter(respond(500, {})).publish(req('x'));
    expect(r.outcome.kind).toBe('retryable');
  });
});

describe('webhook signatures (SEC-03)', () => {
  it('verifies LINE signatures over the raw body', () => {
    const body = Buffer.from('{"events":[]}');
    const sig = createHmac('sha256', 'secret').update(body).digest('base64');
    expect(verifyLineSignature(body, sig, 'secret')).toBe(true);
    expect(verifyLineSignature(body, sig, 'other')).toBe(false);
  });

  it('parses a valid Meta signed_request and rejects a forged one', () => {
    const payload = Buffer.from(
      JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '42' }),
    ).toString('base64url');
    const sig = createHmac('sha256', 'appsecret').update(payload).digest('base64url');
    expect(parseMetaSignedRequest(`${sig}.${payload}`, 'appsecret')?.user_id).toBe('42');
    expect(parseMetaSignedRequest(`${sig}.${payload}`, 'wrong')).toBeNull();
  });
});
