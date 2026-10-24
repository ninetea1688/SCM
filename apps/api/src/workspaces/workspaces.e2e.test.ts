/**
 * Workspace settings — PRD §0 (configurable defaults) and the role table ("แอดมินจัดการ
 * ผู้ใช้ สิทธิ์ และการตั้งค่า"). The policy toggle is owner-only (workspace.policy);
 * reading settings is open to every member.
 */
import type { INestApplication } from '@nestjs/common';
import { auditLogs, createDb, createPool } from '@scm/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'settings');
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

describe('workspace settings (PRD §0)', () => {
  it('every member can read the workspace; only the owner writes the policy toggle', async () => {
    const read = await w.as('viewer').http('get', '/workspaces/current').expect(200);
    expect(read.body.settings.allowSelfApproval).toBeUndefined();

    await w
      .as('admin')
      .http('patch', '/workspaces/current/settings')
      .send({ allowSelfApproval: true })
      .expect(403); // workspace.policy is owner-only
    await w
      .as('editor')
      .http('patch', '/workspaces/current/settings')
      .send({ allowSelfApproval: true })
      .expect(403);

    const res = await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({ allowSelfApproval: true })
      .expect(200);
    expect(res.body).toEqual({ allowSelfApproval: true });

    const after = await w.as('viewer').http('get', '/workspaces/current').expect(200);
    expect(after.body.settings).toEqual({ allowSelfApproval: true });

    const [entry] = await ownerDb
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.workspaceId, w.workspaceId), eq(auditLogs.action, 'workspace.settings')),
      );
    expect(entry!.before).toEqual({});
    expect(entry!.after).toEqual({ allowSelfApproval: true });
  });

  it('stores the brand kit (BRAND-01/02) and it shows in /workspaces/current', async () => {
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({
        brand: {
          signature: 'สข้อมูลจาก สปสช. www.nhso.go.th',
          defaultHashtags: ['สปสช', 'สุขภาพถ้วนหน้า'],
          tone: 'เป็นทางการ อบอุ่น เข้าใจง่าย',
          voiceNotes: 'ไม่ใช้คำสัญญามากเกินไป',
          examplePosts: ['ประกาศตรวจสุขภาพฟรีประจำปี'],
        },
      })
      .expect(200);
    const cur = await w.as('viewer').http('get', '/workspaces/current').expect(200);
    expect(cur.body.settings.brand).toMatchObject({
      signature: 'สข้อมูลจาก สปสช. www.nhso.go.th',
      tone: 'เป็นทางการ อบอุ่น เข้าใจง่าย',
    });
    expect(cur.body.settings.brand.defaultHashtags).toEqual(['สปสช', 'สุขภาพถ้วนหน้า']);
  });

  it('rejects unknown setting keys', async () => {
    await w
      .as('owner')
      .http('patch', '/workspaces/current/settings')
      .send({ allowSelfApproval: true, rogue: 1 })
      .expect(400);
  });
});
