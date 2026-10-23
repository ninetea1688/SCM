import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_RETRY_POLICY, idempotencyKey, nextStep } from './publish-job.js';

const fixed = () => 0.5;

describe('nextStep (PUB-03/04)', () => {
  it('retries retryable errors with backoff until maxAttempts, then gives up', () => {
    const fail = { kind: 'retryable', errorCode: '429', errorMessage: 'rate' } as const;
    for (let a = 1; a < DEFAULT_RETRY_POLICY.maxAttempts; a++) {
      expect(nextStep(a, fail, DEFAULT_RETRY_POLICY, fixed).action).toBe('retry');
    }
    expect(nextStep(DEFAULT_RETRY_POLICY.maxAttempts, fail).action).toBe('give_up');
  });

  it('never retries permanent errors', () => {
    expect(nextStep(1, { kind: 'permanent', errorCode: '190', errorMessage: 'x' })).toEqual({
      action: 'give_up',
      status: 'failed',
    });
  });

  it('PUB AC (no duplicate on network kill): unknown outcomes reconcile first, even on last attempt', () => {
    const unknown = { kind: 'unknown', errorCode: 'ETIMEDOUT', errorMessage: 't' } as const;
    expect(nextStep(1, unknown).action).toBe('reconcile');
    expect(nextStep(DEFAULT_RETRY_POLICY.maxAttempts, unknown).action).toBe('reconcile');
  });

  it('honours Retry-After when larger than backoff', () => {
    const step = nextStep(
      1,
      { kind: 'retryable', errorCode: '429', errorMessage: 'r', retryAfterMs: 10 * 60_000 },
      DEFAULT_RETRY_POLICY,
      fixed,
    );
    expect(step).toMatchObject({ action: 'retry', delayMs: 10 * 60_000 });
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const p = { maxAttempts: 10, baseDelayMs: 1000, maxDelayMs: 8000 };
    const max = () => 1;
    expect(backoffDelay(1, p, max)).toBe(1000);
    expect(backoffDelay(2, p, max)).toBe(2000);
    expect(backoffDelay(3, p, max)).toBe(4000);
    expect(backoffDelay(9, p, max)).toBe(8000);
    expect(backoffDelay(3, p, () => 0)).toBe(2000);
  });
});

describe('idempotencyKey', () => {
  it('is stable for the same variant/version/slot and changes with version', () => {
    const at = '2026-10-23T03:00:00.000Z';
    expect(idempotencyKey('v1', 2, at)).toBe(idempotencyKey('v1', 2, at));
    expect(idempotencyKey('v1', 2, at)).not.toBe(idempotencyKey('v1', 3, at));
  });
});
