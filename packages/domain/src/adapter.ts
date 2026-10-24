/**
 * Publisher Adapter contract — PRD §9.2, extended by ADR-0004 with `reconcile()` and
 * `prepare()` (pre-stage slow media before the slot so NFR-02's 1-minute target holds).
 *
 * Adapters live in apps/api; this file only defines the shapes so both API and worker
 * (and tests) agree on them.
 */
import type { Platform } from './platform.js';
import type { AttemptOutcome } from './publish-job.js';
import type { MediaFacts, ValidationIssue, VariantDraft } from './validation.js';

export interface AccountCredentials {
  socialAccountId: string;
  externalId: string;
  /** Decrypted only in memory inside the worker; never logged. */
  accessToken: string;
}

export interface SignedMedia extends MediaFacts {
  mediaAssetId: string;
  url: string;
  expiresAt: Date;
}

export interface PublishRequest {
  jobId: string;
  idempotencyKey: string;
  variant: VariantDraft;
  media: readonly SignedMedia[];
  account: AccountCredentials;
  /** When the platform allows a time window, the moment the attempt began. */
  attemptStartedAt: Date;
}

export interface PreparedHandle {
  /** e.g. IG container id, YouTube private video id. Expires per platform rules. */
  handle: string;
  expiresAt?: Date;
}

export interface QuotaInfo {
  kind: string;
  used: number;
  limit: number;
  resetsAt?: Date;
}

/** ANA-02 central metric names — every platform's native numbers map onto these. */
export interface CentralMetrics {
  reach: number;
  likes: number;
  comments: number;
  shares: number;
}

/** Raw request/response captured for Publish Log; adapters must pass it through `redact()`. */
export interface AttemptTrace {
  request?: unknown;
  response?: unknown;
  httpStatus?: number;
}

export interface AdapterResult {
  outcome: AttemptOutcome;
  trace: AttemptTrace;
}

export interface PublisherAdapter {
  readonly platform: Platform;

  validate(variant: VariantDraft, media: readonly MediaFacts[]): ValidationIssue[];

  /** Optional pre-stage (upload/container). Called ahead of the slot; idempotent per job. */
  prepare?(req: PublishRequest): Promise<PreparedHandle>;

  publish(req: PublishRequest, prepared?: PreparedHandle): Promise<AdapterResult>;

  /**
   * Look for a post this job may already have created (after an `unknown` outcome).
   * Returns a success outcome if found, `null` if proven absent.
   */
  reconcile(req: PublishRequest): Promise<AttemptOutcome | null>;

  getQuota(account: AccountCredentials): Promise<QuotaInfo[]>;

  /**
   * PUB-08: approximate recipient count for a broadcast preview (LINE targeted
   * reach), for the newest complete day `yyyymmdd`. Optional — most platforms
   * don't have it and the preview just shows the quota.
   */
  followerCount?(account: AccountCredentials, yyyymmdd: string): Promise<number | null>;

  /** INBOX-01: send one direct message to a contact (LINE push; Messenger send API later). */
  sendMessage?(
    account: AccountCredentials,
    externalUserId: string,
    text: string,
  ): Promise<{ externalId: string | null }>;

  /** INBOX-01: reply publicly under a comment on our published post. */
  replyToComment?(
    account: AccountCredentials,
    externalCommentId: string,
    text: string,
  ): Promise<{ externalId: string | null }>;

  /** ANA-01/02: central engagement metrics for one published post; null when unavailable. */
  getInsights?(account: AccountCredentials, externalPostId: string): Promise<CentralMetrics | null>;
}
