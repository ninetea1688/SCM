/**
 * PublishJob attempt policy — PRD PUB-03/04/07, amended by ADR-0004.
 *
 * The platforms do not honour our idempotency key, so "retry safely" needs a third
 * outcome besides success/failure: `unknown` — the request may have reached the platform
 * (timeout, connection reset after send, 5xx after write). An unknown outcome is never
 * blindly retried; the worker must first ask the adapter to `reconcile()` (look the post up
 * on the platform). Only when reconcile proves the post does not exist do we retry.
 */

export const JOB_STATUSES = [
  'queued',
  'running',
  'outcome_unknown',
  'retrying',
  'succeeded',
  'failed',
  'paused',
  'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type AttemptOutcome =
  | { kind: 'success'; externalPostId: string; permalink?: string }
  | { kind: 'retryable'; errorCode: string; errorMessage: string; retryAfterMs?: number }
  | { kind: 'permanent'; errorCode: string; errorMessage: string }
  | { kind: 'unknown'; errorCode: string; errorMessage: string };

export interface RetryPolicy {
  /** Total attempts including the first (PRD default: 1 + 3 retries). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 30_000,
  maxDelayMs: 15 * 60_000,
};

export type NextStep =
  | { action: 'complete'; status: 'succeeded' }
  | { action: 'retry'; status: 'retrying'; delayMs: number }
  | { action: 'reconcile'; status: 'outcome_unknown'; delayMs: number }
  | { action: 'give_up'; status: 'failed' };

/** Exponential backoff with full jitter. `random` is injectable for deterministic tests. */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  // Keep at least half the window so retries never hammer the platform.
  return Math.round(exp / 2 + random() * (exp / 2));
}

/**
 * Decide what happens after attempt number `attempt` (1-based) ended with `outcome`.
 * Unknown outcomes always go through reconcile first, even on the last attempt —
 * giving up without checking could hide a post that actually went live.
 */
export function nextStep(
  attempt: number,
  outcome: AttemptOutcome,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
): NextStep {
  switch (outcome.kind) {
    case 'success':
      return { action: 'complete', status: 'succeeded' };
    case 'permanent':
      return { action: 'give_up', status: 'failed' };
    case 'unknown':
      return { action: 'reconcile', status: 'outcome_unknown', delayMs: policy.baseDelayMs };
    case 'retryable': {
      if (attempt >= policy.maxAttempts) return { action: 'give_up', status: 'failed' };
      const delay = Math.max(outcome.retryAfterMs ?? 0, backoffDelay(attempt, policy, random));
      return { action: 'retry', status: 'retrying', delayMs: delay };
    }
  }
}

/** Deterministic idempotency key: one per (variant, approved version, schedule slot). */
export function idempotencyKey(variantId: string, version: number, scheduledAtIso: string): string {
  return `pub:${variantId}:v${version}:${scheduledAtIso}`;
}
