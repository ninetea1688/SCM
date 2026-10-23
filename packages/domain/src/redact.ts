/**
 * Strip secrets from request/response payloads before they are written to Publish Log,
 * Audit Log or error tracking (PRD PUB-07, SEC-01).
 */

const SECRET_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|cookie|signature)/i;
const SECRET_QUERY =
  /([?&](?:access_token|refresh_token|client_secret|appsecret_proof)=)[^&#\s]+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;

export const REDACTED = '[REDACTED]';

export function redactString(value: string): string {
  return value.replace(SECRET_QUERY, `$1${REDACTED}`).replace(BEARER, `$1${REDACTED}`);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
