/**
 * MEDIA-03 (thumbnail + preview) and the upload-safety rules of ADR-0008, end to end.
 * Needs `pnpm dev:infra` (Postgres, Redis, SeaweedFS) and ffmpeg on PATH. The processor is called
 * directly instead of waiting for the BullMQ worker; the queue hand-off is asserted separately.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, events, mediaAssets } from '@scm/db';
import { renditionKey } from '@scm/domain';
import type { Queue } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_DB } from '../common/core.module';
import { CONFIG } from '../config';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';
import { MediaProcessor } from './media-processor.service';
import { MEDIA_QUEUE, MediaQueue } from './media-queue';
import { MAX_REQUEUES, MediaSweeper } from './media-sweeper.service';
import { StorageService } from './storage.service';

const MAX_PIXELS = 20_000_000;
process.env.MEDIA_MAX_INPUT_PIXELS = String(MAX_PIXELS);

let app: INestApplication;
let w: World;
const tmp = mkdtempSync(path.join(tmpdir(), 'scm-media-test-'));
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  await app.get(StorageService).ensureBucket();
  w = await createWorld(app, 'media');
});

afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  await ownerPool.end();
  await app.close();
});

interface Asset {
  id: string;
  status: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  thumbnailKey: string | null;
  previewKey: string | null;
  processingError: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  originalUrl: string | null;
}

const processor = () => app.get(MediaProcessor);
const storage = () => app.get(StorageService);
/** The sweeper runs in the worker process; build one here without its timer. */
const sweeper = () => new MediaSweeper(app.get(SYSTEM_DB), app.get(CONFIG), app.get(MediaQueue));
const queue = () => app.get<Queue>(getQueueToken(MEDIA_QUEUE));
const get = async (id: string) =>
  (await w.as('editor').http('get', `/media/${id}`).expect(200)).body as Asset;

/** Browser steps: presign → PUT bytes → complete. Returns the asset and its upload URL. */
async function uploadOnly(
  body: Buffer,
  mimeType: string,
  fileName: string,
  declared = body.length,
) {
  const start = await w
    .as('editor')
    .http('post', '/media/uploads')
    .send({ fileName, mimeType, sizeBytes: declared })
    .expect(201);
  const put = await fetch(start.body.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body,
  });
  expect(put.ok).toBe(true);
  const done = await w
    .as('editor')
    .http('post', `/media/${start.body.asset.id}/complete`)
    .expect(201);
  return { asset: done.body as Asset, uploadUrl: start.body.uploadUrl as string };
}

/** Upload, then run what the worker would run. */
async function upload(body: Buffer, mimeType: string, fileName: string): Promise<Asset> {
  const { asset } = await uploadOnly(body, mimeType, fileName);
  expect(asset.status).toBe('processing');
  await processor().process({ mediaAssetId: asset.id, workspaceId: w.workspaceId });
  return get(asset.id);
}

const image = (width: number, height: number, format: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#0b6e4f' } })
    .toFormat(format)
    .toBuffer();

const fetchMeta = async (url: string | null) =>
  sharp(Buffer.from(await (await fetch(url!)).arrayBuffer())).metadata();

describe('MEDIA-03 thumbnail and preview', () => {
  it('MEDIA-03: an uploaded image gets WebP thumb + preview and its real dimensions', async () => {
    const a = await upload(await image(3000, 1500), 'image/png', 'banner.png');

    expect(a.status).toBe('ready');
    expect([a.width, a.height]).toEqual([3000, 1500]);
    expect(a.thumbnailKey).toBe(renditionKey(a.storageKey, 'thumb'));
    expect(a.previewKey).toBe(renditionKey(a.storageKey, 'preview'));

    const thumb = await fetch(a.thumbnailUrl!);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    const t = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect([t.width, t.height]).toEqual([320, 160]);
    const p = await fetchMeta(a.previewUrl);
    expect([p.width, p.height]).toEqual([1280, 640]);
  });

  it('MEDIA-03: a video gets a poster frame from ~1 s in, plus duration and size', async () => {
    // 2 s clip: red for the first 0.5 s, then blue — the poster (at 1 s) must be blue.
    const file = path.join(tmp, 'clip.mp4');
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:size=720x1280:rate=25:duration=0.5',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:size=720x1280:rate=25:duration=1.5',
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1[v]',
      '-map',
      '[v]',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-y',
      file,
    ]);
    const a = await upload(readFileSync(file), 'video/mp4', 'clip.mp4');

    expect(a.status).toBe('ready');
    expect([a.width, a.height]).toEqual([720, 1280]);
    expect(a.durationSec).toBeCloseTo(2, 0);
    const buf = Buffer.from(await (await fetch(a.thumbnailUrl!)).arrayBuffer());
    const meta = await sharp(buf).metadata();
    expect([meta.width, meta.height]).toEqual([180, 320]);
    const { channels } = await sharp(buf).stats();
    expect(channels[2]!.mean).toBeGreaterThan(channels[0]!.mean); // blue, not red
  });

  it('MEDIA-03: EXIF-rotated photos report the size people see', async () => {
    const rotated = await sharp(await image(400, 200, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const a = await upload(rotated, 'image/jpeg', 'phone.jpg');
    expect([a.width, a.height]).toEqual([200, 400]);
    const t = await fetchMeta(a.thumbnailUrl);
    expect([t.width, t.height]).toEqual([160, 320]);
  });

  it('MEDIA-03: never upscales a small image', async () => {
    const a = await upload(await image(200, 100, 'jpeg'), 'image/jpeg', 'small.jpg');
    const t = await fetchMeta(a.thumbnailUrl);
    expect([t.width, t.height]).toEqual([200, 100]);
  });

  it('MEDIA-03: processing is audited (event log)', async () => {
    const a = await upload(await image(50, 50), 'image/png', 'tiny.png');
    const rows = await ownerDb
      .select()
      .from(events)
      .where(and(eq(events.objectId, a.id), eq(events.action, 'media.processed')));
    expect(rows).toHaveLength(1);
  });
});

describe('ADR-0008 upload safety', () => {
  it('a corrupt file is failed with a Thai reason and cannot be attached to a post', async () => {
    const a = await upload(Buffer.from('this is not a jpeg'), 'image/jpeg', 'broken.jpg');
    expect(a.status).toBe('failed');
    expect(a.processingError).toMatch(/ไฟล์/);
    expect(a.thumbnailKey).toBeNull();

    const acct = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'facebook', name: 'm' });
    const res = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'x',
        variants: [{ socialAccountId: acct.body.id, caption: 'x', mediaIds: [a.id] }],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('media_not_ready');
  });

  it('content that does not match the declared type is refused (PNG declared as JPEG)', async () => {
    const a = await upload(await image(100, 100, 'png'), 'image/jpeg', 'liar.jpg');
    expect(a.status).toBe('failed');
    expect(a.processingError).toMatch(/ไม่ตรงกับชนิดไฟล์/);
  });

  it('a playlist disguised as MP4 is refused and never fetched', async () => {
    const hls = Buffer.from(
      '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://169.254.169.254/latest\n#EXT-X-ENDLIST\n',
    );
    const a = await upload(hls, 'video/mp4', 'evil.mp4');
    expect(a.status).toBe('failed');
  });

  it('SVG and other active content types cannot be uploaded at all', async () => {
    const res = await w
      .as('editor')
      .http('post', '/media/uploads')
      .send({ fileName: 'x.svg', mimeType: 'image/svg+xml', sizeBytes: 100 });
    expect(res.status).toBe(400);
  });

  it('bytes larger than declared are rejected at complete and deleted', async () => {
    const { asset } = await uploadOnly(await image(300, 300), 'image/png', 'big.png', 10);
    expect(asset.status).toBe('failed');
    expect(asset.processingError).toMatch(/ขนาดไฟล์/);
    expect(await storage().head(asset.storageKey)).toBeNull();
  });

  it('images above the pixel limit are refused (decompression bomb guard)', async () => {
    const side = Math.ceil(Math.sqrt(MAX_PIXELS)) + 10;
    const a = await upload(await image(side, side), 'image/png', 'bomb.png');
    expect(a.status).toBe('failed');
    expect(a.processingError).toMatch(/ความละเอียด/);
  });

  it('verified bytes move to an immutable key; re-using the upload URL cannot change them', async () => {
    const { asset, uploadUrl } = await uploadOnly(await image(64, 64), 'image/png', 'v.png');
    await processor().process({ mediaAssetId: asset.id, workspaceId: w.workspaceId });
    const ready = await get(asset.id);
    expect(ready.storageKey).toContain('/media/');
    expect(await storage().head(asset.storageKey)).toBeNull(); // upload object removed

    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('evil'),
    });
    const original = await fetch(ready.originalUrl!);
    expect(original.headers.get('content-disposition')).toMatch(/^attachment/);
    const meta = await sharp(Buffer.from(await original.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([64, 64]);
  });
});

describe('ADR-0008 processing lifecycle', () => {
  it('complete hands the asset to the queue, and completing again re-queues a lost job', async () => {
    const { asset } = await uploadOnly(await image(32, 32), 'image/png', 'q.png');
    const jobId = `media-${asset.id}-0`;
    expect((await queue().getJob(jobId))?.data).toEqual({
      mediaAssetId: asset.id,
      workspaceId: w.workspaceId,
    });

    await (await queue().getJob(jobId))!.remove(); // simulate Redis losing it
    const again = await w.as('editor').http('post', `/media/${asset.id}/complete`).expect(201);
    expect(again.body.status).toBe('processing');
    expect(await queue().getJob(jobId)).toBeTruthy();
  });

  it('storage errors retry; the final attempt marks the asset failed', async () => {
    const { asset } = await uploadOnly(await image(32, 32), 'image/png', 'gone.png');
    await storage().delete(asset.storageKey); // infrastructure-style failure on download
    const data = { mediaAssetId: asset.id, workspaceId: w.workspaceId };
    await expect(processor().process(data)).rejects.toThrow();
    expect((await get(asset.id)).status).toBe('processing');
    expect(await processor().process(data, { finalAttempt: true })).toBe('failed');
    expect((await get(asset.id)).processingError).toMatch(/อัปโหลดใหม่/);
  });

  it('the sweeper re-queues stuck assets and eventually fails them', async () => {
    const { asset } = await uploadOnly(await image(32, 32), 'image/png', 'stuck.png');
    const backdate = (requeues: number) =>
      ownerDb
        .update(mediaAssets)
        .set({ processingStartedAt: sql`now() - interval '2 hours'`, processingRequeues: requeues })
        .where(eq(mediaAssets.id, asset.id));

    await backdate(0);
    const first = await sweeper().sweep();
    expect(first.requeued).toBeGreaterThanOrEqual(1);
    expect((await get(asset.id)).status).toBe('processing');

    await backdate(MAX_REQUEUES);
    await sweeper().sweep();
    const final = await get(asset.id);
    expect(final.status).toBe('failed');
    expect(final.processingError).toMatch(/นานเกินกำหนด/);
  });
});
