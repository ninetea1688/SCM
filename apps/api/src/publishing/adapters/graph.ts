/**
 * Shared Graph API error classification — Facebook and Instagram return the same
 * error envelope (`{ error: { code, error_subcode, message, is_transient } }`).
 * Codes verified against https://developers.facebook.com/docs/graph-api/guides/error-code
 */
import type { AttemptOutcome } from '@scm/domain';
import { retryAfterMs } from './http';

/** Graph error codes worth retrying (transient / throttling). */
export const GRAPH_RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);
/** Auth / permission problems — retrying cannot help; the account needs reconnecting. */
export const GRAPH_AUTH_CODES = new Set([10, 102, 190, 200]);

export interface GraphError {
  error?: { code?: number; error_subcode?: number; message?: string; is_transient?: boolean };
}

/**
 * Classify a Graph error response. `fiveHundred` says what a 5xx means for this call:
 * `unknown` when the write may have gone through (feed posts, media_publish — ADR-0004:
 * reconcile, never blind-retry) or `retryable` for invisible side effects (media
 * containers) where redoing the call cannot create anything user-visible.
 */
export function graphErrorOutcome(
  status: number,
  json: unknown,
  headers: Headers,
  fiveHundred: 'unknown' | 'retryable',
  prefix = 'graph',
): AttemptOutcome | null {
  if (status < 400) return null;
  const e = (json as GraphError)?.error ?? {};
  const code = e.code ?? 0;
  const errorCode = `${prefix}_${code}${e.error_subcode ? `_${e.error_subcode}` : ''}`;
  const errorMessage = e.message ?? `HTTP ${status}`;
  if (GRAPH_AUTH_CODES.has(code)) return { kind: 'permanent', errorCode, errorMessage };
  if (GRAPH_RETRYABLE_CODES.has(code) || e.is_transient || status === 429) {
    return { kind: 'retryable', errorCode, errorMessage, retryAfterMs: retryAfterMs(headers) };
  }
  if (status >= 500) return { kind: fiveHundred, errorCode, errorMessage };
  return { kind: 'permanent', errorCode, errorMessage };
}
