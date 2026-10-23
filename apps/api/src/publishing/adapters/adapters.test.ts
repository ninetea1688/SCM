import { createHmac } from 'node:crypto';
import type { PublishRequest } from '@scm/domain';
import { describe, expect, it, vi } from 'vitest';
import { parseMetaSignedRequest, verifyLineSignature } from '../../webhooks/signatures';
import { FacebookAdapter } from './facebook.adapter';
import { InstagramAdapter } from './instagram.adapter';
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

/** Several canned responses in call order; the last one repeats if extra calls happen. */
function respondSeq(...steps: [status: number, body: unknown][]) {
  let i = 0;
  return vi.fn(async () => {
    const [status, body] = steps[Math.min(i++, steps.length - 1)]!;
    return new Response(JSON.stringify(body), { status });
  });
}

const igMedia = (
  over: Partial<PublishRequest['media'][number]> = {},
): PublishRequest['media'][number] =>
  ({
    mediaAssetId: 'm1',
    kind: 'image',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    url: 'https://s3.local/img.publish.jpg',
    expiresAt: new Date(Date.now() + 3600_000),
    ...over,
  }) as PublishRequest['media'][number];

const igReq = (media: PublishRequest['media'], caption = 'ประกาศ'): PublishRequest => ({
  ...req(caption, media),
  variant: { platform: 'instagram', caption },
  account: { socialAccountId: 'a1', externalId: 'IGUSER', accessToken: 'TOKEN' },
});

/** Adapter with instant polling so tests never really sleep. */
const ig = (f: unknown) =>
  new InstagramAdapter('v24.0', f as typeof fetch, { intervalMs: 0, maxTries: 3 });

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

describe('InstagramAdapter', () => {
  it('prepare() creates a single-image container with the caption and a 24 h handle', async () => {
    const f = respondSeq([200, { id: 'C1' }]);
    const h = await ig(f).prepare(igReq([igMedia()]));
    expect(h.handle).toBe('C1');
    expect(h.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v24.0/IGUSER/media');
    expect(url).not.toContain('TOKEN');
    expect(JSON.parse(String(init.body))).toMatchObject({
      image_url: 'https://s3.local/img.publish.jpg',
      caption: 'ประกาศ',
    });
  });

  it('publish() reuses a FINISHED prepared container: status → media_publish → permalink', async () => {
    const f = respondSeq(
      [200, { status_code: 'FINISHED' }], // container status
      [200, { id: 'M9' }], // media_publish
      [200, { permalink: 'https://insta/p/M9' }],
    );
    const r = await ig(f).publish(igReq([igMedia()]), { handle: 'C1' });
    expect(r.outcome).toEqual({
      kind: 'success',
      externalPostId: 'M9',
      permalink: 'https://insta/p/M9',
    });
    expect(f).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({
      creation_id: 'C1',
    });
    expect(JSON.stringify(r.trace)).not.toContain('TOKEN');
  });

  it('several images become a carousel: children without caption, then the parent', async () => {
    const f = respondSeq(
      [200, { id: 'C1' }],
      [200, { id: 'C2' }],
      [200, { id: 'CARO' }],
      [200, { status_code: 'FINISHED' }],
      [200, { id: 'M10' }],
      [200, { permalink: 'https://insta/p/M10' }],
    );
    const r = await ig(f).publish(igReq([igMedia(), igMedia()]));
    expect(r.outcome.kind).toBe('success');
    const bodies = f.mock.calls
      .slice(0, 3)
      .map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0]).toEqual({ image_url: 'https://s3.local/img.publish.jpg' });
    expect(bodies[2]).toEqual({
      media_type: 'CAROUSEL',
      children: 'C1,C2',
      caption: 'ประกาศ',
    });
  });

  it.each([
    [undefined, 'VIDEO'],
    [{ igFormat: 'reel' as const }, 'REELS'],
  ])('a video container uses media_type %j → %s', async (options, mediaType) => {
    const f = respondSeq(
      [200, { id: 'CV' }],
      [200, { status_code: 'FINISHED' }],
      [200, { id: 'M11' }],
      [200, { permalink: 'https://insta/p/M11' }],
    );
    const video = igMedia({
      kind: 'video',
      mimeType: 'video/mp4',
      url: 'https://s3.local/v.publish.mp4',
    });
    const r = await ig(f).publish({
      ...igReq([video], 'คลิป'),
      variant: { platform: 'instagram' as const, caption: 'คลิป', options },
    });
    expect(r.outcome.kind).toBe('success');
    const first = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(first).toMatchObject({
      video_url: 'https://s3.local/v.publish.mp4',
      media_type: mediaType,
    });
  });

  it('an EXPIRED prepared container is re-created, not published', async () => {
    const f = respondSeq(
      [200, { status_code: 'EXPIRED' }], // prepared C0 gone
      [200, { id: 'C3' }], // fresh container
      [200, { status_code: 'FINISHED' }],
      [200, { id: 'M12' }],
      [200, { permalink: 'https://insta/p/M12' }],
    );
    const r = await ig(f).publish(igReq([igMedia()]), { handle: 'C0' });
    expect(r.outcome).toMatchObject({ kind: 'success', externalPostId: 'M12' });
    expect(
      JSON.parse(String((f.mock.calls[3] as unknown as [string, RequestInit])[1].body)),
    ).toEqual({
      creation_id: 'C3',
    });
  });

  it('media_publish 5xx is unknown (the post may exist) — ADR-0004', async () => {
    const f = respondSeq(
      [200, { status_code: 'FINISHED' }],
      [500, { error: { code: 0, message: 'boom' } }],
    );
    const r = await ig(f).publish(igReq([igMedia()]), { handle: 'C1' });
    expect(r.outcome).toMatchObject({ kind: 'unknown' });
  });

  it('auth errors are permanent and throttling retryable (shared Graph classification)', async () => {
    const f = respondSeq([200, { status_code: 'FINISHED' }], [400, { error: { code: 190 } }]);
    const r = await ig(f).publish(igReq([igMedia()]), { handle: 'C1' });
    expect(r.outcome).toMatchObject({ kind: 'permanent', errorCode: 'ig_190' });

    const g = respondSeq([200, { status_code: 'FINISHED' }], [400, { error: { code: 4 } }]);
    const r2 = await ig(g).publish(igReq([igMedia()]), { handle: 'C1' });
    expect(r2.outcome).toMatchObject({ kind: 'retryable', errorCode: 'ig_4' });
  });

  it('a container still processing after the poll budget is retryable', async () => {
    const f = respondSeq([200, { status_code: 'IN_PROGRESS' }]);
    const r = await ig(f).publish(igReq([igMedia()]), { handle: 'C1' });
    expect(r.outcome).toMatchObject({ kind: 'retryable', errorCode: 'ig_container_processing' });
    expect(f).toHaveBeenCalledTimes(3); // maxTries
  });

  it('a network failure while creating the container is retryable (invisible write)', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const r = await ig(f).publish(igReq([igMedia()]));
    expect(r.outcome).toMatchObject({ kind: 'retryable', errorCode: 'network' });
  });

  it('reconcile matches the exact caption since the attempt', async () => {
    const f = respond(200, {
      data: [
        { id: 'M_8', caption: 'ข่าวอื่น', timestamp: '2026-10-23T03:00:10+0000' },
        {
          id: 'M_9',
          caption: 'ประกาศ',
          permalink: 'https://insta/p/M9',
          timestamp: '2026-10-23T03:00:30+0000',
        },
      ],
    });
    const found = await ig(f).reconcile(igReq([igMedia()], 'ประกาศ'));
    expect(found).toEqual({
      kind: 'success',
      externalPostId: 'M_9',
      permalink: 'https://insta/p/M9',
    });
    expect(await ig(f).reconcile(igReq([igMedia()], 'ไม่มี'))).toBeNull();
  });

  it('getQuota reads the live 24 h window (PUB-05)', async () => {
    const f = respond(200, {
      data: [{ quota_usage: 7, config: { quota_total: 50, quota_duration: 86400 } }],
    });
    const q = await ig(f).getQuota({
      socialAccountId: 'a1',
      externalId: 'IGUSER',
      accessToken: 'T',
    });
    expect(q).toEqual([{ kind: 'ig_posts_24h', used: 7, limit: 50 }]);
  });
});

describe('LineAdapter quota and recipients (PUB-05/PUB-08)', () => {
  const line = (f: unknown) => new LineAdapter(f as typeof fetch);
  const creds = { socialAccountId: 'a1', externalId: 'U1', accessToken: 'TOKEN' };

  it('getQuota reads the monthly message window (PUB-05)', async () => {
    const f = respondSeq([200, { type: 'limited', value: 500 }], [200, { totalUsage: 123 }]);
    expect(await line(f).getQuota(creds)).toEqual([
      { kind: 'line_messages_month', used: 123, limit: 500 },
    ]);
  });

  it('getQuota answers empty for an unlimited channel', async () => {
    const f = respondSeq([200, { type: 'none' }], [200, { totalUsage: 1 }]);
    expect(await line(f).getQuota(creds)).toEqual([]);
  });

  it('followerCount returns targetedReaches when insight is ready (PUB-08)', async () => {
    const f = respond(200, { status: 'ready', followers: 4200, targetedReaches: 3900 });
    expect(await line(f).followerCount(creds, '20261023')).toBe(3900);
  });

  it('followerCount returns null while the insight is still processing', async () => {
    const f = respond(200, { status: 'out_of_date' });
    expect(await line(f).followerCount(creds, '20261023')).toBeNull();
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
