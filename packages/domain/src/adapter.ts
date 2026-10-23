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
}
