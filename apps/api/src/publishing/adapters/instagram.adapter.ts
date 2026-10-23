/**
 * Instagram publisher — PRD PUB-02 (P1), §9.3.
 * Docs (verify before changing): https://developers.facebook.com/docs/instagram-platform/content-publishing
 *
 * The Content Publishing API is two-step: create an invisible media container
 * (`/{ig-id}/media`) then publish it (`/{ig-id}/media_publish`). Containers expire
 * after 24 h and nothing is visible until media_publish, so prepare() pre-stages the
 * container before the slot (ADR-0004, NFR-02) and a duplicate container is harmless.
 * Images publish as JPEG (guaranteed by MEDIA-04's publish rendition), several media
 * become a carousel; one video becomes a VIDEO/REELS container.
 */
import {
  type AccountCredentials,
  type AdapterResult,
  type AttemptOutcome,
  type MediaFacts,
  type PreparedHandle,
  type PublisherAdapter,
  type PublishRequest,
  type QuotaInfo,
  validateVariant,
} from '@scm/domain';
import { graphErrorOutcome } from './graph';
import { type FetchFn, httpCall, TransportError } from './http';

export interface IgPollOptions {
  /** Delay between `status_code` polls while a container processes a video. */
  intervalMs: number;
  /** Give up after this many polls and return retryable (the container survives). */
  maxTries: number;
}

/** Terminal container states, from GET /{container-id}?fields=status_code. */
type WaitState = 'finished' | 'gone' | AttemptOutcome;

export class InstagramAdapter implements PublisherAdapter {
  readonly platform = 'instagram' as const;

  constructor(
    private readonly graphVersion: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly poll: IgPollOptions = { intervalMs: 5_000, maxTries: 12 },
  ) {}

  private url(path: string) {
    return `https://graph.facebook.com/${this.graphVersion}/${path}`;
  }

  validate(variant: PublishRequest['variant'], media: readonly MediaFacts[]) {
    return validateVariant(variant, media);
  }

  /** ADR-0004: create the container(s) ahead of the slot; expires with the container (24 h). */
  async prepare(req: PublishRequest): Promise<PreparedHandle> {
    const id = await this.createContainer(req);
    return { handle: id, expiresAt: new Date(Date.now() + 24 * 3600_000) };
  }

  async publish(req: PublishRequest, prepared?: PreparedHandle): Promise<AdapterResult> {
    try {
      let containerId = usable(prepared);
      if (containerId) {
        const state = await this.wait(req.account, containerId);
        if (state === 'gone')
          containerId = undefined; // expired/errored pre-stage → recreate
        else if (state !== 'finished') return { outcome: state, trace: {} };
      }
      if (!containerId) {
        containerId = await this.createContainer(req);
        const state = await this.wait(req.account, containerId);
        if (state !== 'finished') {
          // A freshly created container that went EXPIRED/ERROR means the media itself
          // was rejected; timing out is transient (the container keeps processing).
          return {
            outcome:
              state === 'gone'
                ? {
                    kind: 'permanent',
                    errorCode: 'ig_container_error',
                    errorMessage: 'แพลตฟอร์มประมวลผลสื่อไม่สำเร็จ',
                  }
                : state,
            trace: {},
          };
        }
      }

      // The only visible step. A 5xx may still have published → unknown (ADR-0004).
      const r = await httpCall(
        {
          method: 'POST',
          url: this.url(`${req.account.externalId}/media_publish`),
          headers: { authorization: `Bearer ${req.account.accessToken}` },
          body: { creation_id: containerId },
          isWrite: true,
        },
        this.fetchFn,
      );
      const failed = graphErrorOutcome(r.status, r.json, r.headers, 'unknown', 'ig');
      if (failed) return { outcome: failed, trace: r.trace };
      const id = (r.json as { id?: string }).id;
      if (!id) {
        return {
          outcome: {
            kind: 'unknown',
            errorCode: 'ig_no_id',
            errorMessage: 'media_publish returned no id',
          },
          trace: r.trace,
        };
      }
      return {
        outcome: {
          kind: 'success',
          externalPostId: id,
          ...(await this.permalink(req.account, id)),
        },
        trace: r.trace,
      };
    } catch (e) {
      if (e instanceof TransportError) return { outcome: e.outcome, trace: e.trace };
      throw e;
    }
  }

  /** After an `unknown` media_publish: look for this caption among the newest media. */
  async reconcile(req: PublishRequest): Promise<AttemptOutcome | null> {
    const since = new Date(req.attemptStartedAt.getTime() - 120_000);
    const r = await httpCall(
      {
        method: 'GET',
        url: this.url(
          `${req.account.externalId}/media?fields=id,caption,permalink,timestamp&limit=50`,
        ),
        headers: { authorization: `Bearer ${req.account.accessToken}` },
        isWrite: false,
      },
      this.fetchFn,
    );
    if (r.status >= 400) throw new Error(`reconcile failed: HTTP ${r.status}`);
    const posts = ((r.json as { data?: IgMedia[] }).data ?? []) as IgMedia[];
    const caption = req.variant.caption.trim();
    const hit = posts.find(
      (p) =>
        (p.caption ?? '').trim() === caption && (!p.timestamp || new Date(p.timestamp) >= since),
    );
    return hit ? { kind: 'success', externalPostId: hit.id, permalink: hit.permalink } : null;
  }

  /** PUB-05: live 24 h publishing window (docs: quota_total 50, quota_usage at top level). */
  async getQuota(account: AccountCredentials): Promise<QuotaInfo[]> {
    const r = await httpCall(
      {
        method: 'GET',
        url: this.url(`${account.externalId}/content_publishing_limit`),
        headers: { authorization: `Bearer ${account.accessToken}` },
        isWrite: false,
      },
      this.fetchFn,
    );
    const row = (r.json as { data?: { quota_usage?: number; config?: { quota_total?: number } }[] })
      ?.data?.[0];
    if (!row?.config?.quota_total) return [];
    return [{ kind: 'ig_posts_24h', used: row.quota_usage ?? 0, limit: row.config.quota_total }];
  }

  // ── containers ─────────────────────────────────────────────────────────────

  /**
   * POST /{ig-id}/media. Every container call is an *invisible* write: a network
   * failure is retryable (isWrite: false) because redoing it cannot publish anything.
   */
  private async createContainer(req: PublishRequest): Promise<string> {
    const headers = { authorization: `Bearer ${req.account.accessToken}` };
    const ig = req.account.externalId;

    const create = async (body: Record<string, unknown>): Promise<string> => {
      const r = await httpCall(
        { method: 'POST', url: this.url(`${ig}/media`), headers, body, isWrite: false },
        this.fetchFn,
      );
      const failed = graphErrorOutcome(r.status, r.json, r.headers, 'retryable', 'ig');
      if (failed) throw new TransportError(failed, r.trace);
      const id = (r.json as { id?: string }).id;
      if (!id)
        throw new TransportError(
          { kind: 'unknown', errorCode: 'ig_no_container_id', errorMessage: 'no container id' },
          r.trace,
        );
      return id;
    };

    const single = (m: PublishRequest['media'][number], caption?: string) =>
      m.kind === 'image'
        ? { image_url: m.url, ...(caption ? { caption } : {}) }
        : {
            video_url: m.url,
            media_type: req.variant.options?.igFormat === 'reel' ? 'REELS' : 'VIDEO',
            ...(caption ? { caption } : {}),
          };

    if (req.media.length > 1) {
      // Carousel: children first (no caption on children), then the parent container.
      const children: string[] = [];
      for (const m of req.media) children.push(await create(single(m)));
      return await create({
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: req.variant.caption,
      });
    }
    const m = req.media[0];
    if (!m)
      throw new TransportError(
        { kind: 'permanent', errorCode: 'ig_no_media', errorMessage: 'Instagram requires media' },
        {},
      );
    return await create(single(m, req.variant.caption));
  }

  /** Poll the container until it is publishable. Video processing is asynchronous. */
  private async wait(account: AccountCredentials, containerId: string): Promise<WaitState> {
    for (let i = 0; i < this.poll.maxTries; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, this.poll.intervalMs));
      const r = await httpCall(
        {
          method: 'GET',
          url: this.url(`${containerId}?fields=status_code`),
          headers: { authorization: `Bearer ${account.accessToken}` },
          isWrite: false,
        },
        this.fetchFn,
      );
      if (r.status >= 500)
        return {
          kind: 'retryable',
          errorCode: `ig_${r.status}`,
          errorMessage: 'status check failed',
        };
      if (r.status >= 400) {
        const failed = graphErrorOutcome(r.status, r.json, r.headers, 'retryable', 'ig');
        if (failed) return failed;
      }
      const s = (r.json as { status_code?: string }).status_code;
      if (s === 'FINISHED' || s === 'PUBLISHED') return 'finished';
      if (s === 'EXPIRED' || s === 'ERROR') return 'gone';
    }
    return {
      kind: 'retryable',
      errorCode: 'ig_container_processing',
      errorMessage: 'สื่อยังประมวลผลไม่เสร็จ จะลองใหม่',
    };
  }

  private async permalink(
    account: AccountCredentials,
    mediaId: string,
  ): Promise<{ permalink: string }> {
    const r = await httpCall(
      {
        method: 'GET',
        url: this.url(`${mediaId}?fields=permalink`),
        headers: { authorization: `Bearer ${account.accessToken}` },
        isWrite: false,
      },
      this.fetchFn,
    );
    const p = (r.json as { permalink?: string }).permalink;
    return p ? { permalink: p } : { permalink: `https://www.instagram.com/p/${mediaId}` };
  }
}

interface IgMedia {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
}

function usable(prepared?: PreparedHandle): string | undefined {
  if (!prepared?.handle) return undefined;
  if (prepared.expiresAt && prepared.expiresAt.getTime() < Date.now()) return undefined;
  return prepared.handle;
}
