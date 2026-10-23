/**
 * E2E harness: boots the real AppModule against the dev Postgres/Redis (pnpm dev:infra),
 * with PUBLISHER_MODE=fake. Each call to `createWorld()` makes a fresh workspace + users,
 * so tests never collide and never need cleanup.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDb, createPool, memberships, users, workspaces } from '@scm/db';
import type { Role } from '@scm/domain';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../app.module';
import { TokenCipher } from '../common/crypto';
import { loadConfig } from '../config';

export const OWNER_URL = process.env.DATABASE_OWNER_URL ?? 'postgres://scm:scm@localhost:5433/scm';
const PASSWORD = 'correct-horse-battery-staple';

export async function bootApp(): Promise<INestApplication> {
  process.env.LOG_LEVEL ??= 'error';
  process.env.NODE_ENV = 'test';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ rawBody: true, logger: false });
  app.setGlobalPrefix('api', { exclude: ['health', 'webhooks/{*path}'] });
  await app.init();
  return app;
}

export interface Actor {
  userId: string;
  email: string;
  token: string;
  http: (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => request.Test;
}

export interface World {
  workspaceId: string;
  actors: Record<Role, Actor>;
  as: (role: Role) => Actor;
}

/** One workspace with one user per role. Owner/admin get 2FA (AUTH-04). */
export async function createWorld(app: INestApplication, name = 'test'): Promise<World> {
  const pool = createPool(OWNER_URL, 1);
  const db = createDb(pool);
  const cipher = new TokenCipher(loadConfig().TOKEN_ENC_KEYS);
  const workspaceId = randomUUID();
  const hash = await argon2.hash(PASSWORD);
  const secrets: Partial<Record<Role, string>> = {};
  const ids: Partial<Record<Role, { id: string; email: string }>> = {};
  try {
    await db.insert(workspaces).values({ id: workspaceId, name: `${name}-${workspaceId}` });
    for (const role of ['owner', 'admin', 'approver', 'editor', 'agent', 'viewer'] as Role[]) {
      const email = `${role}-${workspaceId}@test.local`;
      const needs2fa = role === 'owner' || role === 'admin';
      const secret = needs2fa ? authenticator.generateSecret() : undefined;
      const [u] = await db
        .insert(users)
        .values({
          email,
          displayName: role,
          passwordHash: hash,
          totpEnabled: needs2fa,
          totpSecretEnc: secret ? cipher.encrypt(secret) : null,
        })
        .returning();
      await db.insert(memberships).values({ workspaceId, userId: u!.id, role });
      ids[role] = { id: u!.id, email };
      if (secret) secrets[role] = secret;
    }
  } finally {
    await pool.end();
  }

  const actors = {} as Record<Role, Actor>;
  for (const [role, { id, email }] of Object.entries(ids) as [
    Role,
    { id: string; email: string },
  ][]) {
    const secret = secrets[role];
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email,
        password: PASSWORD,
        ...(secret ? { totp: authenticator.generate(secret) } : {}),
      });
    if (res.status !== 200) throw new Error(`login ${role} failed: ${JSON.stringify(res.body)}`);
    const token = res.body.accessToken as string;
    actors[role] = {
      userId: id,
      email,
      token,
      http: (method, path) =>
        request(app.getHttpServer())
          [method](`/api${path}`)
          .set('authorization', `Bearer ${token}`)
          .set('x-workspace-id', workspaceId),
    };
  }
  return { workspaceId, actors, as: (r) => actors[r] };
}
