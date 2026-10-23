/** CONN-05: probe classification. DB flows are covered by the e2e file. */
import type { Db } from '@scm/db';
import { describe, expect, it, vi } from 'vitest';
import { TokenCipher } from '../common/crypto';
import { loadConfig } from '../config';
import type { NotificationService } from '../notifications/notification.service';
import { AccountHealthService } from './account-health.service';

type Row = Parameters<AccountHealthService['probe']>[0];

const cfg = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const cipher = new TokenCipher(cfg.TOKEN_ENC_KEYS);

const row = (over: Partial<Row> = {}): Row =>
  ({
    id: 'a1',
    workspaceId: 'w1',
    platform: 'facebook',
    externalId: 'PAGE',
    name: 'เพจ',
    status: 'active',
    accessTokenEnc: cipher.encrypt('real-token'),
    scopes: [],
    tokenExpiresAt: null,
    ...over,
  }) as Row;

const service = () => {
  const s = new AccountHealthService({} as Db, cfg, cipher, {} as NotificationService);
  s.probeFetch = vi.fn();
  return s;
};

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('AccountHealthService.probe (CONN-05)', () => {
  it('sandbox accounts are healthy without any network call', async () => {
    const s = service();
    const verdict = await s.probe(row({ scopes: ['sandbox'], accessTokenEnc: null }));
    expect(verdict).toBe('ok');
    expect(s.probeFetch).not.toHaveBeenCalled();
  });

  it('a missing token counts as expired', async () => {
    expect(await service().probe(row({ accessTokenEnc: null }))).toBe('expired');
  });

  it.each([
    ['ok', respond(200, { id: 'PAGE' })],
    ['expired', respond(400, { error: { code: 190 } })],
    ['transient', respond(500, { error: { code: 2 } })],
  ])('facebook/instagram: 200→ok, auth code→expired, 5xx→transient (%s)', async (want, f) => {
    const s = service();
    s.probeFetch = f as unknown as typeof fetch;
    expect(await s.probe(row())).toBe(want);
  });

  it.each([
    ['expired', 401],
    ['transient', 500],
  ])('line: %s on HTTP %i', async (want, status) => {
    const s = service();
    s.probeFetch = respond(status, {}) as unknown as typeof fetch;
    expect(await s.probe(row({ platform: 'line' }))).toBe(want);
  });

  it('a network error is transient, never a disconnect', async () => {
    const s = service();
    s.probeFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await s.probe(row())).toBe('transient');
  });
});
