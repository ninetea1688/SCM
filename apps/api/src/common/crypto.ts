import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * CONN-04 / SEC-01: AES-256-GCM envelope for platform tokens and TOTP secrets.
 * Format: `<keyId>.<iv b64>.<tag b64>.<ciphertext b64>` — the key id allows rotation.
 * A dumped database contains no readable token (CONN AC).
 */
export class TokenCipher {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentId: string;

  constructor(spec: string) {
    const entries = spec.split(',').map((s) => s.trim().split(':'));
    for (const [id, b64] of entries) {
      if (!id || !b64) throw new Error('TOKEN_ENC_KEYS must look like "id:base64key"');
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) throw new Error(`Encryption key ${id} must be 32 bytes`);
      this.keys.set(id, key);
    }
    this.currentId = entries[0]![0]!;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentId)!, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [this.currentId, iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
      .join('.');
  }

  decrypt(envelope: string): string {
    const [id, iv, tag, ct] = envelope.split('.');
    const key = id ? this.keys.get(id) : undefined;
    if (!key || !iv || !tag || !ct) throw new Error('Unreadable token envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
