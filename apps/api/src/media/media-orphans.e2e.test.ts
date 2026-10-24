/**
 * MEDIA-08 (ADR-0008, PDPA retention): bytes of failed assets and abandoned uploads are
 * deleted by the worker's orphan sweeper; ready assets are never touched. The sweeper is
 * a worker-only provider, so it is constructed directly (same pattern as MediaSweeper).
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, mediaAssets } from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_DB } from '../common/db-tokens';
import { CONFIG } from '../config';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';
import { mediaHelpers, solidImage } from '../test/media-helpers';
import { MediaOrphanSweeper } from './media-orphan-sweeper.service';
import { StorageService } from './storage.service';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  await app.get(StorageService).ensureBucket();
  w = await createWorld(app, 'orphan');
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

const sweeper = () =>
  new MediaOrphanSweeper(app.get(SYSTEM_DB), app.get(CONFIG), app.get(StorageService));
const storage = () => app.get(StorageService);
const { upload } = mediaHelpers(
  () => app,
  () => w,
);
const image = solidImage;

const age = async (assetId: string, ms: number) => {
  await ownerDb
    .update(mediaAssets)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(mediaAssets.id, assetId));
};

describe('MediaOrphanSweeper (MEDIA-08)', () => {
  it('deletes an abandoned upload (object + row) but keeps a fresh one', async () => {
    // A true abandoned upload: started (row in `uploading`), bytes PUT, never completed.
    const start = async (name: string) => {
      const s = await w
        .as('editor')
        .http('post', '/media/uploads')
        .send({ fileName: name, mimeType: 'image/png', sizeBytes: 1000 })
        .expect(201);
      const body = await solidImage(400, 300);
      const put = await fetch(s.body.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body,
      });
      expect(put.ok).toBe(true);
      return s.body.asset as { id: string; storageKey: string };
    };
    const stale = await start('stale.png');
    await age(stale.id, 2 * 3600_000); // presign TTL (15 min) long past
    const fresh = await start('fresh.png');

    const r = await sweeper().sweep();
    expect(r.uploadsDeleted).toBeGreaterThanOrEqual(1);

    const [gone] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, stale.id));
    expect(gone).toBeUndefined();
    expect(await storage().head(stale.storageKey)).toBeNull();

    const [kept] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, fresh.id));
    expect(kept).toBeDefined();
    expect(await storage().head(fresh.storageKey)).not.toBeNull();
  });

  it('strips the bytes of a failed asset, keeps the row, and never repeats', async () => {
    const a = await upload(await image(800, 600), 'image/png', 'doomed.png');
    expect(a.status).toBe('ready');
    await ownerDb
      .update(mediaAssets)
      .set({ status: 'failed', processingError: 'จำลองความล้มเหลว' })
      .where(eq(mediaAssets.id, a.id));

    await sweeper().sweep();
    expect(await storage().head(a.storageKey)).toBeNull();
    expect(await storage().head(a.thumbnailKey!)).toBeNull();
    expect(await storage().head(a.previewKey!)).toBeNull();

    const [row] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, a.id));
    expect(row!.status).toBe('failed');
    expect(row!.processingError).toBe('จำลองความล้มเหลว'); // audit trail stays
    expect(row!.orphanCleanedAt).not.toBeNull();

    const again = await sweeper().sweep();
    expect(again.failedCleaned).toBe(0);
  });

  it('never touches ready assets', async () => {
    const a = await upload(await image(500, 500), 'image/png', 'keeper.png');
    await sweeper().sweep();
    expect(await storage().head(a.storageKey)).not.toBeNull();
    expect(await storage().head(a.thumbnailKey!)).not.toBeNull();
    const [row] = await ownerDb.select().from(mediaAssets).where(eq(mediaAssets.id, a.id));
    expect(row!.orphanCleanedAt).toBeNull();
  });
});
