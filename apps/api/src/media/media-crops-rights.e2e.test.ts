/**
 * MEDIA-05 (multi-ratio crops) and MEDIA-07 (usage rights) end to end.
 * Needs `pnpm dev:infra` and ffmpeg. Crops are cover-cropped from the same verified
 * frame, never upscaled; lapsed rights block attaching, an expiry within 7 days warns.
 */
import type { INestApplication } from '@nestjs/common';
import { auditLogs, createDb, createPool, mediaAssets } from '@scm/db';
import { CROP_RATIOS, cropBox, RIGHTS_WARN_DAYS } from '@scm/domain';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';
import { mediaHelpers, solidImage } from '../test/media-helpers';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
let fbAccount: string;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'p2media');
  const fb = await w
    .as('admin')
    .http('post', '/accounts/sandbox')
    .send({ platform: 'facebook', name: 'เพจสิทธิ์' })
    .expect(201);
  fbAccount = fb.body.id;
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const { upload } = mediaHelpers(
  () => app,
  () => w,
);
const day = 24 * 3600_000;

describe('MEDIA-05 aspect-ratio crops', () => {
  it('every ratio is generated from one verified frame, cover-cropped and never upscaled', async () => {
    const a = await upload(await solidImage(3000, 1500), 'image/png', 'wide.png');
    const view = await w.as('editor').http('get', `/media/${a.id}`).expect(200);
    expect(Object.keys(view.body.crops ?? {}).sort()).toEqual([...CROP_RATIOS].sort());
    for (const ratio of CROP_RATIOS) {
      const box = cropBox({ width: 3000, height: 1500 }, ratio, 1280);
      const meta = await sharp(
        Buffer.from(await (await fetch(view.body.crops[ratio])).arrayBuffer()),
      ).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', box.width, box.height]);
    }
  });

  it('a small image is cropped without upscaling', async () => {
    const a = await upload(await solidImage(200, 200), 'image/png', 'tiny.png');
    const view = await w.as('editor').http('get', `/media/${a.id}`).expect(200);
    const box = cropBox({ width: 200, height: 200 }, '16:9', 1280);
    expect(box).toEqual({ width: 200, height: 113 }); // 200×(200·16/9) — never wider than 200
    const meta = await sharp(
      Buffer.from(await (await fetch(view.body.crops['16:9']!)).arrayBuffer()),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([box.width, box.height]);
  });
});

describe('MEDIA-07 usage rights', () => {
  it('records rights at upload and lets owners edit them (audited)', async () => {
    const a = await upload(await solidImage(400, 400), 'image/png', 'rights.png');
    const [_row] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, a.id));
    await ownerDb
      .update(mediaAssets)
      .set({
        source: 'หอจดหมายเหตุ สปสช.',
        license: 'CC-BY-4.0',
        rightsExpireAt: new Date(Date.now() + 90 * day),
      })
      .where(eq(mediaAssets.id, a.id));

    const res = await w
      .as('editor')
      .http('patch', `/media/${a.id}/rights`)
      .send({ consentOnFile: true, license: 'CC-BY-SA-4.0' })
      .expect(200);
    expect(res.body.consentOnFile).toBe(true);
    expect(res.body.license).toBe('CC-BY-SA-4.0');
    expect(res.body.source).toBe('หอจดหมายเหตุ สปสช.');

    const [entry] = await ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, w.workspaceId), eq(auditLogs.action, 'media.rights')));
    expect(entry!.before).toMatchObject({ license: 'CC-BY-4.0', consentOnFile: false });
    expect(entry!.after).toMatchObject({ license: 'CC-BY-SA-4.0', consentOnFile: true });
  });

  it('attaching media with lapsed rights is refused; an expiry within the warn window shows a Thai warning', async () => {
    const a = await upload(await solidImage(400, 400), 'image/png', 'expiring.png');
    const attach = () =>
      w
        .as('editor')
        .http('post', '/posts')
        .send({
          title: 'สิทธิ์',
          variants: [{ socialAccountId: fbAccount, caption: 'ตรวจสิทธิ์', mediaIds: [a.id] }],
        });

    await ownerDb
      .update(mediaAssets)
      .set({ rightsExpireAt: new Date(Date.now() - day) })
      .where(eq(mediaAssets.id, a.id));
    const refused = await attach();
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('media_rights_expired');

    await ownerDb
      .update(mediaAssets)
      .set({ rightsExpireAt: new Date(Date.now() + (RIGHTS_WARN_DAYS - 1) * day) })
      .where(eq(mediaAssets.id, a.id));
    const created = await attach().expect(201);
    const variantId = created.body.variants[0].id as string;
    const view = await w.as('editor').http('get', `/posts/${created.body.id}`).expect(200);
    expect(
      view.body.variants[0].issues.some(
        (i: { code: string; severity: string }) =>
          i.code === 'media_rights_expiring' && i.severity === 'warning',
      ),
    ).toBe(true);

    // Rights lapse after attaching → the next submit is blocked with the same reason.
    await ownerDb
      .update(mediaAssets)
      .set({ rightsExpireAt: new Date(Date.now() - day) })
      .where(eq(mediaAssets.id, a.id));
    const submit = await w.as('editor').http('post', `/variants/${variantId}/submit`);
    expect(submit.status).toBe(400);
    expect(
      submit.body.issues.some((i: { code: string }) => i.code === 'media_rights_expired'),
    ).toBe(true);
  });
});
