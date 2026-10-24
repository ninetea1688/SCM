import { createHmac, timingSafeEqual } from 'node:crypto';

/** SEC-03: LINE `x-line-signature` = base64(HMAC-SHA256(channelSecret, rawBody)). */
export function verifyLineSignature(rawBody: Buffer, signature: string, channelSecret: string) {
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Meta webhook delivery (`X-Hub-Signature-256: sha256=<hex of HMAC-SHA256(appSecret, body)>`). */
export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice(7);
  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

/**
 * Meta `signed_request` = "<base64url sig>.<base64url payload>", sig = HMAC-SHA256(appSecret,
 * payload part). Returns the decoded payload or null when the signature is wrong.
 */
export function parseMetaSignedRequest(
  signedRequest: string,
  appSecret: string,
): Record<string, unknown> | null {
  const [sigPart, payloadPart] = signedRequest.split('.');
  if (!sigPart || !payloadPart || !appSecret) return null;
  const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
  const given = Buffer.from(sigPart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    return payload?.algorithm === 'HMAC-SHA256' ? payload : null;
  } catch {
    return null;
  }
}
