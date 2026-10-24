/** The sandbox-adapter guard: prod must not boot with PUBLISHER_MODE=fake unless staging opts in. */
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config';
import { AdapterRegistry } from './registry';

const base = {
  PUBLISHER_MODE: 'fake',
  META_GRAPH_VERSION: 'v24.0',
  IG_CONTAINER_POLL_INTERVAL_SEC: 5,
  IG_CONTAINER_POLL_MAX: 12,
} as Partial<AppConfig> & Record<string, unknown>;

const cfg = (over: Record<string, unknown> = {}) =>
  ({
    NODE_ENV: 'production',
    ALLOW_FAKE_PUBLISHER: false,
    ...base,
    ...over,
  }) as unknown as AppConfig;

describe('AdapterRegistry sandbox guard', () => {
  it('fake + production throws without the explicit staging opt-in', () => {
    expect(() => new AdapterRegistry(cfg())).toThrow(/ALLOW_FAKE_PUBLISHER/);
  });

  it('fake + production boots with ALLOW_FAKE_PUBLISHER=true (staging)', () => {
    const r = new AdapterRegistry(cfg({ ALLOW_FAKE_PUBLISHER: true }));
    expect(r.has('facebook')).toBe(true);
  });

  it('fake is fine outside production (dev/test)', () => {
    const r = new AdapterRegistry(cfg({ NODE_ENV: 'development' }));
    expect(r.has('instagram')).toBe(true);
  });
});
