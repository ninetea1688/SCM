/**
 * Sandbox publisher used when PUBLISHER_MODE=fake (dev, CI, demos) — never in production.
 * Behaves like a real platform including failure modes, triggered by markers in the caption:
 *   [[fail:retryable]] fail once with a retryable error, then succeed
 *   [[fail:permanent]] always fail permanently
 *   [[fail:unknown]]   create the post but "lose" the response once (tests reconcile)
 */
import {
  type AdapterResult,
  type AttemptOutcome,
  type MediaFacts,
  type Platform,
  type PublisherAdapter,
  type PublishRequest,
  type QuotaInfo,
  validateVariant,
} from '@scm/domain';

export class FakeAdapter implements PublisherAdapter {
  /** Published posts by idempotency key — lets tests assert "no duplicates". */
  readonly posts = new Map<string, { id: string; caption: string; count: number }>();
  private readonly failedOnce = new Set<string>();

  constructor(readonly platform: Platform) {}

  validate(variant: PublishRequest['variant'], media: readonly MediaFacts[]) {
    return validateVariant(variant, media);
  }

  async publish(req: PublishRequest): Promise<AdapterResult> {
    const caption = req.variant.caption;
    const key = req.idempotencyKey;
    const trace = { request: { platform: this.platform, caption }, httpStatus: 200 };

    if (caption.includes('[[fail:permanent]]')) {
      return {
        outcome: { kind: 'permanent', errorCode: 'fake_permanent', errorMessage: 'ปฏิเสธถาวร' },
        trace,
      };
    }
    if (caption.includes('[[fail:retryable]]') && !this.failedOnce.has(key)) {
      this.failedOnce.add(key);
      return {
        outcome: {
          kind: 'retryable',
          errorCode: 'fake_retryable',
          errorMessage: 'ชั่วคราว',
          retryAfterMs: 0,
        },
        trace,
      };
    }

    // Like a real platform, a second call creates a second post — we count them.
    const existing = this.posts.get(key);
    const id = existing?.id ?? `fake_${this.platform}_${this.posts.size + 1}`;
    this.posts.set(key, { id, caption, count: (existing?.count ?? 0) + 1 });

    if (caption.includes('[[fail:unknown]]') && !this.failedOnce.has(key)) {
      this.failedOnce.add(key);
      return {
        outcome: { kind: 'unknown', errorCode: 'fake_timeout', errorMessage: 'หมดเวลา' },
        trace,
      };
    }
    return {
      outcome: { kind: 'success', externalPostId: id, permalink: `https://sandbox.local/${id}` },
      trace,
    };
  }

  async reconcile(req: PublishRequest): Promise<AttemptOutcome | null> {
    const p = this.posts.get(req.idempotencyKey);
    return p
      ? { kind: 'success', externalPostId: p.id, permalink: `https://sandbox.local/${p.id}` }
      : null;
  }

  async getQuota(): Promise<QuotaInfo[]> {
    return [];
  }
}
