/** POST-06: version history records every edit and the diff viewer works across them. */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool } from '@scm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let variantId: string;
const ownerPool = createPool(OWNER_URL, 1);
const _ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'vers');
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจเวอร์ชัน' })
    .expect(201);
  const created = await w
    .as('editor')
    .http('post', '/posts')
    .send({
      title: 'ประวัติเวอร์ชัน',
      variants: [{ socialAccountId: fb.body.id, caption: 'ร่างแรก' }],
    })
    .expect(201);
  variantId = created.body.variants[0].id as string;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

describe('POST-06 version history', () => {
  it('each edit is recorded with editor and snapshot; list is newest first', async () => {
    await w
      .as('editor')
      .http('patch', `/variants/${variantId}`)
      .send({ caption: 'ร่างสอง แก้ข้อความ' })
      .expect(200);
    await w
      .as('editor')
      .http('patch', `/variants/${variantId}`)
      .send({ caption: 'ร่างสาม แก้อีก' })
      .expect(200);

    const list = await w.as('viewer').http('get', `/variants/${variantId}/versions`).expect(200);
    expect(list.body.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(list.body[0]!.snapshot.caption).toBe('ร่างสาม แก้อีก');
    expect(list.body[2]!.snapshot.caption).toBe('ร่างแรก');
    expect(list.body[0]!.editedBy).toBe('editor');
  });

  it('another workspace cannot read the history (AUTH-01)', async () => {
    const other = await createWorld(app, 'vers-b');
    await other.as('owner').http('get', `/variants/${variantId}/versions`).expect(404);
  });
});

describe('POST-05 content taxonomy', () => {
  it('sets labels, returns them with the post, and is workspace-isolated', async () => {
    // createWorld 'vers' post exists from the earlier describe? No — create our own.
    const fb = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'facebook', name: 'เพจ taxonomy' })
      .expect(201);
    const created = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'ป้ายคอนเทนต์',
        variants: [{ socialAccountId: fb.body.id, caption: 'ป้าย' }],
      })
      .expect(201);
    const postId = created.body.id as string;

    await w
      .as('editor')
      .http('put', `/posts/${postId}/taxonomy`)
      .send({
        pillar: 'สุขภาพเชิงป้องกัน',
        audience: 'ผู้สูงอายุ',
        aiUsed: true,
      })
      .expect(200);

    const post = await w.as('viewer').http('get', `/posts/${postId}`).expect(200);
    expect(post.body.taxonomy).toEqual({
      pillar: 'สุขภาพเชิงป้องกัน',
      audience: 'ผู้สูงอายุ',
      aiUsed: true,
    });

    const other = await createWorld(app, 'vers-tax');
    await other.as('owner').http('put', `/posts/${postId}/taxonomy`).send({}).expect(404);

    await w.as('editor').http('put', `/posts/${postId}/taxonomy`).send({ rogue: 1 }).expect(400);
  });
});
