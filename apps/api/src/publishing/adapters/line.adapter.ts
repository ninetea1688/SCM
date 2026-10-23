/**
 * LINE OA publisher — PRD PUB-02/PUB-08 (P1). Broadcast only in P1; Narrowcast needs
 * Audience management (CRM-03, P5).
 * Docs (verify before changing): https://developers.line.biz/en/reference/messaging-api/
 *
 * LINE supports real idempotency via `X-Line-Retry-Key`: a retried request with the same
 * key returns 409 and is NOT re-sent, so retrying an `unknown` outcome is safe and
 * reconcile() can simply answer "absent → retry".
 */
import { createHash } from 'node:crypto';
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
import { type FetchFn, httpCall, retryAfterMs, TransportError } from './http';

const API = 'https://api.line.me/v2/bot';

export class LineAdapter implements PublisherAdapter {
  readonly platform = 'line' as const;

  constructor(private readonly fetchFn: FetchFn = fetch) {}

  validate(variant: PublishRequest['variant'], media: readonly MediaFacts[]) {
    return validateVariant(variant, media);
  }

  async publish(req: PublishRequest): Promise<AdapterResult> {
    const messages: unknown[] = [];
    for (const m of req.media.filter((x) => x.kind === 'image')) {
      messages.push({ type: 'image', originalContentUrl: m.url, previewImageUrl: m.url });
    }
    if (req.variant.caption.trim()) {
      messages.unshift({ type: 'text', text: req.variant.caption });
    }
    try {
      const r = await httpCall(
        {
          method: 'POST',
          url: `${API}/message/broadcast`,
          headers: {
            authorization: `Bearer ${req.account.accessToken}`,
            'x-line-retry-key': retryKey(req.idempotencyKey),
          },
          body: { messages: messages.slice(0, 5) },
          isWrite: true,
        },
        this.fetchFn,
      );
      const requestId =
        r.headers.get('x-line-accepted-request-id') ?? r.headers.get('x-line-request-id') ?? '';
      // 409 with an accepted-request-id = an earlier attempt with this key already went out.
      if (r.status === 200 || (r.status === 409 && r.headers.get('x-line-accepted-request-id'))) {
        return { outcome: { kind: 'success', externalPostId: requestId }, trace: r.trace };
      }
      return { outcome: this.errorOutcome(r.status, r.json, r.headers), trace: r.trace };
    } catch (e) {
      if (e instanceof TransportError) return { outcome: e.outcome, trace: e.trace };
      throw e;
    }
  }

  /** Retry key makes resend safe; a resend will itself report 409 if it already went out. */
  async reconcile(_req: PublishRequest): Promise<AttemptOutcome | null> {
    return null;
  }

  async getQuota(account: AccountCredentials): Promise<QuotaInfo[]> {
    const headers = { authorization: `Bearer ${account.accessToken}` };
    const [quota, used] = await Promise.all([
      httpCall(
        { method: 'GET', url: `${API}/message/quota`, headers, isWrite: false },
        this.fetchFn,
      ),
      httpCall(
        { method: 'GET', url: `${API}/message/quota/consumption`, headers, isWrite: false },
        this.fetchFn,
      ),
    ]);
    const q = quota.json as { type?: string; value?: number };
    const u = used.json as { totalUsage?: number };
    if (q.type !== 'limited') return [];
    return [{ kind: 'line_messages_month', used: u.totalUsage ?? 0, limit: q.value ?? 0 }];
  }

  /** PUB-08: recipients for a broadcast preview. */
  async followerCount(account: AccountCredentials, yyyymmdd: string): Promise<number | null> {
    const r = await httpCall(
      {
        method: 'GET',
        url: `${API}/insight/followers?date=${yyyymmdd}`,
        headers: { authorization: `Bearer ${account.accessToken}` },
        isWrite: false,
      },
      this.fetchFn,
    );
    const j = r.json as { status?: string; targetedReaches?: number };
    return j.status === 'ready' ? (j.targetedReaches ?? null) : null;
  }

  private errorOutcome(status: number, json: unknown, headers: Headers): AttemptOutcome {
    const message = (json as { message?: string })?.message ?? `HTTP ${status}`;
    const errorCode = `line_${status}`;
    if (status === 429) {
      return {
        kind: 'retryable',
        errorCode,
        errorMessage: message,
        retryAfterMs: retryAfterMs(headers),
      };
    }
    // With a retry key, a 5xx resend is safe → retryable rather than unknown.
    if (status >= 500) return { kind: 'retryable', errorCode, errorMessage: message };
    return { kind: 'permanent', errorCode, errorMessage: message };
  }
}

/** Deterministic UUID-shaped key from our idempotency key (LINE requires UUID format). */
export function retryKey(idempotencyKey: string): string {
  const h = createHash('sha256').update(idempotencyKey).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
