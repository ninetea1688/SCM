/**
 * AUTH-04 AC: owner/admin must have 2FA *when enforcement is on*. Enforcement is
 * config-gated (`AUTH_ENFORCE_MFA`, default: production only) so dev sessions skip
 * the OTP setup step until SSO lands (SEC-02). This file proves both sides.
 * Needs `pnpm dev:infra`.
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, users } from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';

let app: INestApplication;
let w: World;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  process.env.AUTH_ENFORCE_MFA = 'true'; // boot with enforcement on
  app = await bootApp();
  w = await createWorld(app, 'mfa');
});

afterAll(async () => {
  delete process.env.AUTH_ENFORCE_MFA;
  await ownerPool.end();
  await app.close();
});

describe('AUTH-04 with AUTH_ENFORCE_MFA=true', () => {
  it('an owner whose TOTP is disabled gets 403 mfa_required_for_role', async () => {
    const owner = w.as('owner');
    await ownerDb.update(users).set({ totpEnabled: false }).where(eq(users.id, owner.userId));
    const denied = await owner.http('get', '/backlog');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('mfa_required_for_role');
  });

  it('the same owner passes once TOTP is enabled again', async () => {
    const owner = w.as('owner');
    await ownerDb.update(users).set({ totpEnabled: true }).where(eq(users.id, owner.userId));
    const ok = await owner.http('get', '/backlog');
    expect(ok.status).toBe(200);
  });

  it('roles below owner/admin are never blocked by the 2FA rule', async () => {
    const viewer = w.as('viewer');
    await ownerDb.update(users).set({ totpEnabled: false }).where(eq(users.id, viewer.userId));
    const res = await viewer.http('get', '/backlog');
    expect(res.status).toBe(200);
  });
});
