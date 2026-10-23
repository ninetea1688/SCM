import { type AttemptOutcome, type AttemptTrace, redact } from '@scm/domain';

export interface HttpCall {
  method: 'GET' | 'POST' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Writes that may have taken effect when the response is lost → `unknown`, not retryable. */
  isWrite: boolean;
  timeoutMs?: number;
}

export interface HttpResult {
  status: number;
  json: unknown;
  headers: Headers;
  trace: AttemptTrace;
}

export type FetchFn = typeof fetch;

export class TransportError extends Error {
  constructor(
    readonly outcome: AttemptOutcome,
    readonly trace: AttemptTrace,
  ) {
    super(outcome.kind === 'success' ? 'success' : outcome.errorMessage);
  }
}

/**
 * One HTTP call with timeout and a redacted trace. Network failures on writes become
 * `unknown` (the platform may have created the post) — see ADR-0004.
 */
export async function httpCall(call: HttpCall, fetchFn: FetchFn = fetch): Promise<HttpResult> {
  const traceReq = redact({ method: call.method, url: call.url, body: call.body });
  let res: Response;
  try {
    res = await fetchFn(call.url, {
      method: call.method,
      headers: {
        ...(call.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...call.headers,
      },
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(call.timeoutMs ?? 30_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const outcome: AttemptOutcome = call.isWrite
      ? { kind: 'unknown', errorCode: 'network', errorMessage: message }
      : { kind: 'retryable', errorCode: 'network', errorMessage: message };
    throw new TransportError(outcome, { request: traceReq });
  }
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }
  return {
    status: res.status,
    json,
    headers: res.headers,
    trace: { request: traceReq, response: redact(json), httpStatus: res.status },
  };
}

export function retryAfterMs(headers: Headers): number | undefined {
  const v = headers.get('retry-after');
  if (!v) return undefined;
  const sec = Number(v);
  return Number.isFinite(sec) ? sec * 1000 : undefined;
}
