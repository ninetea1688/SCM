/**
 * OPS-03/04 + NOTI-01 ACs: /metrics + /status respond unauthenticated, and a
 * permanent publish failure sends email through Mailpit (dev SMTP) to the
 * responsible people. Needs `pnpm dev:infra` (Mailpit on :8025, SMTP :1025).
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, publishJobs } from '@scm/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PublishRunner } from '../publishing/publish-runner.service';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';

let app: INestApplication;
let w: World;
let fbAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  process.env.SMTP_URL = 'smtp://localhost:1025'; // Mailpit
  app = await bootApp();
  w = await createWorld(app, 'ops');
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจ ops' });
  fbAccount = fb.body.id;
});

afterAll(async () => {
  delete process.env.SMTP_URL;
  await ownerPool.end();
  await app.close();
});

const inTwoMinutes = () => new Date(Date.now() + 2 * 60_000).toISOString();

async function scheduledVariant(caption: string): Promise<string> {
  const created = await w
    .as('editor')
    .http('post', '/posts')
    .send({ title: 'ops', variants: [{ socialAccountId: fbAccount, caption }] })
    .expect(201);
  const id = created.body.variants[0].id as string;
  await w.as('editor').http('post', `/variants/${id}/submit`).expect(200);
  await w.as('approver').http('post', `/variants/${id}/approve`).send({}).expect(200);
  await w
    .as('approver')
    .http('post', `/variants/${id}/schedule`)
    .send({ scheduledAt: inTwoMinutes() })
    .expect(200);
  return id;
}

describe('OPS-03 /metrics', () => {
  it('exposes Prometheus output without a session', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toContain('scm_publish_attempts_total');
    expect(res.text).toContain('process_cpu_seconds_total'); // default collectors on
  });
});

describe('OPS-04 /status', () => {
  it('reports component health for the status page', async () => {
    const res = await request(app.getHttpServer()).get('/status').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.components).toEqual({ db: 'ok', storage: 'ok', queue: 'ok' });
  });
});

describe('NOTI-01 email channel (Mailpit)', () => {
  it('a permanent publish failure emails the author and approvers', async () => {
    const id = await scheduledVariant('พังส่งเมล [[fail:permanent]]');
    const [job] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.variantId, id));
    const result = await app
      .get(PublishRunner)
      .run({ publishJobId: job!.id, workspaceId: w.workspaceId });
    expect(result).toEqual({ status: 'failed' });

    // The email flush happens after commit; poll Mailpit briefly.
    const subject = 'โพสต์ไป facebook ไม่สำเร็จ';
    let found = false;
    for (let i = 0; i < 10 && !found; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch('http://localhost:8025/api/v1/messages?limit=20');
      const j = (await res.json()) as {
        messages: { Subject: string; To: { Address: string }[] }[];
      };
      found = j.messages.some(
        (m) => m.Subject === subject && m.To.some((t) => t.Address.endsWith('@test.local')),
      );
    }
    expect(found).toBe(true);
  });
});
