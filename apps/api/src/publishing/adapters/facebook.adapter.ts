/**
 * Facebook Page publisher — PRD PUB-02 (P1), §9.3.
 * Docs (verify before changing): https://developers.facebook.com/documentation/pages-api/posts
 *
 * Formats: text/link → /feed; one photo → /photos; several photos → unpublished /photos +
 * /feed attached_media; one video → /videos (file_url). Reels are P2 (needs upload session).
 * Graph does not honour idempotency keys, so reconcile() searches recent page posts.
 */
import {
  type AccountCredentials,
  type AdapterResult,
  type AttemptOutcome,
  type MediaFacts,
  type PublisherAdapter,
  type PublishRequest,
  type QuotaInfo,
  validateVariant,
} from '@scm/domain';
import { graphErrorOutcome } from './graph';
import { type FetchFn, httpCall, TransportError } from './http';

export class FacebookAdapter implements PublisherAdapter {
  readonly platform = 'facebook' as const;

  constructor(
    private readonly graphVersion: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.graphVersion}/${path}`;
  }

  validate(variant: PublishRequest['variant'], media: readonly MediaFacts[]) {
    return validateVariant(variant, media);
  }

  async publish(req: PublishRequest): Promise<AdapterResult> {
    const { account, variant, media } = req;
    const page = account.externalId;
    const auth = { authorization: `Bearer ${account.accessToken}` };
    try {
      const images = media.filter((m) => m.kind === 'image');
      const video = media.find((m) => m.kind === 'video');

      if (video) {
        const r = await httpCall(
          {
            method: 'POST',
            url: this.url(`${page}/videos`),
            headers: auth,
            body: { file_url: video.url, description: variant.caption },
            isWrite: true,
            timeoutMs: 120_000,
          },
          this.fetchFn,
        );
        return this.finish(r.status, r.json, r.headers, r.trace, (j) => j.id);
      }

      if (images.length === 1) {
        const r = await httpCall(
          {
            method: 'POST',
            url: this.url(`${page}/photos`),
            headers: auth,
            body: { url: images[0]!.url, message: variant.caption },
            isWrite: true,
          },
          this.fetchFn,
        );
        return this.finish(r.status, r.json, r.headers, r.trace, (j) => j.post_id ?? j.id);
      }

      let attached: { media_fbid: string }[] | undefined;
      if (images.length > 1) {
        attached = [];
        for (const img of images) {
          // Unpublished photos are invisible until attached, so retrying this step is safe.
          const r = await httpCall(
            {
              method: 'POST',
              url: this.url(`${page}/photos`),
              headers: auth,
              body: { url: img.url, published: false },
              isWrite: false,
            },
            this.fetchFn,
          );
          const failed = this.errorOutcome(r.status, r.json, r.headers);
          if (failed) return { outcome: failed, trace: r.trace };
          attached.push({ media_fbid: String((r.json as { id: string }).id) });
        }
      }

      const link = firstUrl(variant.caption);
      const r = await httpCall(
        {
          method: 'POST',
          url: this.url(`${page}/feed`),
          headers: auth,
          body: {
            message: variant.caption,
            ...(attached ? { attached_media: attached } : {}),
            ...(!attached && link ? { link } : {}),
          },
          isWrite: true,
        },
        this.fetchFn,
      );
      return this.finish(r.status, r.json, r.headers, r.trace, (j) => j.id);
    } catch (e) {
      if (e instanceof TransportError) return { outcome: e.outcome, trace: e.trace };
      throw e;
    }
  }

  async reconcile(req: PublishRequest): Promise<AttemptOutcome | null> {
    const since = Math.floor(req.attemptStartedAt.getTime() / 1000) - 120;
    const r = await httpCall(
      {
        method: 'GET',
        url: this.url(
          `${req.account.externalId}/published_posts?fields=id,message,permalink_url,created_time&since=${since}&limit=50`,
        ),
        headers: { authorization: `Bearer ${req.account.accessToken}` },
        isWrite: false,
      },
      this.fetchFn,
    );
    if (r.status >= 400) throw new Error(`reconcile failed: HTTP ${r.status}`);
    const posts = ((r.json as { data?: FbPost[] }).data ?? []) as FbPost[];
    const caption = req.variant.caption.trim();
    const hit = posts.find((p) => (p.message ?? '').trim() === caption);
    return hit ? { kind: 'success', externalPostId: hit.id, permalink: hit.permalink_url } : null;
  }

  async getQuota(_account: AccountCredentials): Promise<QuotaInfo[]> {
    // Feed posts have no published cap; Reels cap is tracked in our own quota_usage.
    return [];
  }

  private finish(
    status: number,
    json: unknown,
    headers: Headers,
    trace: AdapterResult['trace'],
    pickId: (j: Record<string, string>) => string | undefined,
  ): AdapterResult {
    const failed = this.errorOutcome(status, json, headers);
    if (failed) return { outcome: failed, trace };
    const id = pickId(json as Record<string, string>);
    if (!id) {
      return {
        outcome: { kind: 'unknown', errorCode: 'no_id', errorMessage: 'Graph returned no id' },
        trace,
      };
    }
    return {
      outcome: { kind: 'success', externalPostId: id, permalink: `https://www.facebook.com/${id}` },
      trace,
    };
  }

  private errorOutcome(status: number, json: unknown, headers: Headers): AttemptOutcome | null {
    // A 5xx on a write may still have created the post → unknown (ADR-0004).
    return graphErrorOutcome(status, json, headers, 'unknown', 'fb');
  }
}

interface FbPost {
  id: string;
  message?: string;
  permalink_url?: string;
}

function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0];
}
