import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { PLATFORMS, type Platform, type PublisherAdapter } from '@scm/domain';
import { type AppConfig, CONFIG } from '../../config';
import { FacebookAdapter } from './facebook.adapter';
import { FakeAdapter } from './fake.adapter';
import { InstagramAdapter } from './instagram.adapter';
import { LineAdapter } from './line.adapter';

/**
 * Picks the adapter per platform. Adding a platform = new adapter file + one line here
 * (PRD §4 principle 2). Instagram/TikTok/YouTube live adapters are tracked in docs/STATUS.md.
 */
@Injectable()
export class AdapterRegistry {
  private readonly adapters = new Map<Platform, PublisherAdapter>();

  constructor(@Inject(CONFIG) cfg: AppConfig) {
    if (cfg.PUBLISHER_MODE === 'fake') {
      if (cfg.NODE_ENV === 'production') {
        throw new Error('PUBLISHER_MODE=fake is not allowed in production');
      }
      for (const p of PLATFORMS) this.adapters.set(p, new FakeAdapter(p));
      return;
    }
    this.adapters.set('facebook', new FacebookAdapter(cfg.META_GRAPH_VERSION));
    this.adapters.set(
      'instagram',
      new InstagramAdapter(cfg.META_GRAPH_VERSION, fetch, {
        intervalMs: cfg.IG_CONTAINER_POLL_INTERVAL_SEC * 1000,
        maxTries: cfg.IG_CONTAINER_POLL_MAX,
      }),
    );
    this.adapters.set('line', new LineAdapter());
  }

  get(platform: Platform): PublisherAdapter {
    const a = this.adapters.get(platform);
    if (!a) throw new NotImplementedException(`ยังไม่รองรับการโพสต์ไปที่ ${platform}`);
    return a;
  }

  has(platform: Platform): boolean {
    return this.adapters.has(platform);
  }
}
