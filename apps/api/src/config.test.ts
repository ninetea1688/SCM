import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = {
  JWT_SECRET: 'x'.repeat(32),
  TOKEN_ENC_KEYS: `k1:${Buffer.alloc(32, 7).toString('base64')}`,
  S3_SECRET_KEY: 'real-secret',
};

describe('AUTH_ENFORCE_MFA default (AUTH-04, SEC-02)', () => {
  it('follows NODE_ENV: off in development/test, on in production', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).AUTH_ENFORCE_MFA).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).AUTH_ENFORCE_MFA).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).AUTH_ENFORCE_MFA).toBe(true);
  });

  it('an explicit value always wins', () => {
    expect(
      loadConfig({ ...base, NODE_ENV: 'development', AUTH_ENFORCE_MFA: 'true' }).AUTH_ENFORCE_MFA,
    ).toBe(true);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', AUTH_ENFORCE_MFA: 'false' }).AUTH_ENFORCE_MFA,
    ).toBe(false);
  });
});

describe('ALLOW_FAKE_PUBLISHER default (staging sandbox opt-in)', () => {
  it('defaults to false; an explicit true wins', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).ALLOW_FAKE_PUBLISHER).toBe(false);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', ALLOW_FAKE_PUBLISHER: 'true' })
        .ALLOW_FAKE_PUBLISHER,
    ).toBe(true);
  });
});
