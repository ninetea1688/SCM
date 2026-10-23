/**
 * MEDIA-04: automatic conversion to platform-ready files (ADR-0009).
 * Needs `pnpm dev:infra`, ffmpeg (with libx265 for the HEVC fixture) and heif-dec on PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, events, publishJobs } from '@scm/db';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeAdapter } from '../publishing/adapters/fake.adapter';
import { AdapterRegistry } from '../publishing/adapters/registry';
import { PublishRunner } from '../publishing/publish-runner.service';
import { bootApp, createWorld, OWNER_URL, type World } from '../test/harness';
import { mediaHelpers } from '../test/media-helpers';
import { StorageService } from './storage.service';

let app: INestApplication;
let w: World;
const tmp = mkdtempSync(path.join(tmpdir(), 'scm-convert-test-'));
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);
const { upload } = mediaHelpers(
  () => app,
  () => w,
);
const HEIC = path.join(__dirname, '../test/fixtures/tiled-1600x1200.heic');

beforeAll(async () => {
  app = await bootApp();
  await app.get(StorageService).ensureBucket();
  w = await createWorld(app, 'convert');
});

afterAll(async () => {
  rmSync(tmp, { recursive: true, force: true });
  await ownerPool.end();
  await app.close();
});

const download = async (url: string | null) => Buffer.from(await (await fetch(url!)).arrayBuffer());

function ffprobe(buf: Buffer) {
  const f = path.join(tmp, `probe-${Math.random()}.mp4`);
  writeFileSync(f, buf);
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    f,
  ]);
  return JSON.parse(String(out)) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
    format: { tags?: Record<string, string> };
  };
}

function ffmpeg(name: string, args: string[]): Buffer {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', ...args, '-y', out]);
  return readFileSync(out);
}

async function publishPlan(assetId: string) {
  const [row] = await ownerDb
    .select()
    .from(events)
    .where(and(eq(events.objectId, assetId), eq(events.action, 'media.processed')));
  return (row?.payload as { publish?: string })?.publish;
}

describe('MEDIA-04 conversion', () => {
  it('MEDIA-04: HEIC (iPhone tile grid) becomes a full-size JPEG; the original is kept', async () => {
    const a = await upload(readFileSync(HEIC), 'image/heic', 'IMG_0001.HEIC');
    expect(a.status).toBe('ready');
    expect([a.width, a.height]).toEqual([1600, 1200]); // whole grid, not one 512px tile
    expect(a.storageKey).toMatch(/\.heic$/);
    expect(a.publishMimeType).toBe('image/jpeg');

    const jpeg = await sharp(await download(a.publishUrl)).metadata();
    expect([jpeg.format, jpeg.width, jpeg.height]).toEqual(['jpeg', 1600, 1200]);
    expect((await sharp(await download(a.thumbnailUrl)).metadata()).width).toBe(320);
  });

  it('MEDIA-04: GPS and camera metadata are stripped from the publishable JPEG', async () => {
    const withGps = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#888' },
    })
      .withExif({
        IFD0: { Make: 'PhoneCo', Artist: 'เจ้าหน้าที่' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 44/1 0/1' },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const a = await upload(withGps, 'image/jpeg', 'gps.jpg');
    const meta = await sharp(await download(a.publishUrl)).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('MEDIA-04: transparent PNG is flattened onto white', async () => {
    const clear = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const a = await upload(clear, 'image/png', 'logo.png');
    const { channels } = await sharp(await download(a.publishUrl)).stats();
    expect(channels.slice(0, 3).every((c) => c.mean > 250)).toBe(true);
  });

  it('MEDIA-04: HEVC .mov with AAC is transcoded to H.264/AAC MP4, faststart, no metadata', async () => {
    const mov = ffmpeg('hevc.mov', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx265',
      '-tag:v',
      'hvc1',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-metadata',
      'location=+13.7563+100.5018/',
      '-shortest',
    ]);
    const a = await upload(mov, 'video/quicktime', 'clip.mov');
    expect(a.status).toBe('ready');
    expect(a.publishMimeType).toBe('video/mp4');
    expect(await publishPlan(a.id)).toBe('transcode');

    const mp4 = await download(a.publishUrl);
    const info = ffprobe(mp4);
    expect(info.streams.find((s) => s.codec_type === 'video')?.codec_name).toBe('h264');
    expect(info.streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac');
    expect(info.format.tags?.location).toBeUndefined();
    expect(mp4.indexOf('moov')).toBeLessThan(mp4.indexOf('mdat')); // faststart
  });

  it('MEDIA-04: an already-compliant H.264 MP4 is only remuxed, not re-encoded', async () => {
    const mp4 = ffmpeg('ok.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=480x854:rate=25:duration=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
    ]);
    const a = await upload(mp4, 'video/mp4', 'ok.mp4');
    expect(await publishPlan(a.id)).toBe('remux');
    const info = ffprobe(await download(a.publishUrl));
    expect(info.streams[0]).toMatchObject({ codec_name: 'h264', width: 480, height: 854 });
  });

  it('MEDIA-04: video larger than the cap is scaled so the long side fits (default 1920)', async () => {
    const big = ffmpeg('big.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1200x2400:rate=10:duration=1',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
    ]);
    const a = await upload(big, 'video/mp4', 'big.mp4');
    expect(await publishPlan(a.id)).toBe('transcode');
    expect([a.publishWidth, a.publishHeight]).toEqual([960, 1920]);
    expect([a.width, a.height]).toEqual([1200, 2400]); // original facts unchanged
  });
});

describe('MEDIA-04 publishing uses the converted file', () => {
  it('MEDIA-04: a HEIC photo passes Instagram validate() and reaches the platform as JPEG', async () => {
    const asset = await upload(readFileSync(HEIC), 'image/heic', 'ig.heic');
    const ig = await w
      .as('admin')
      .http('post', '/accounts/sandbox')
      .send({ platform: 'instagram', name: 'ig' });
    const post = await w
      .as('editor')
      .http('post', '/posts')
      .send({
        title: 'heic',
        variants: [{ socialAccountId: ig.body.id, caption: 'ภาพจากมือถือ', mediaIds: [asset.id] }],
      })
      .expect(201);
    const id = post.body.variants[0].id;
    expect(post.body.variants[0].issues).toEqual([]); // IG accepts only JPEG: proves the copy is used

    await w.as('editor').http('post', `/variants/${id}/submit`).expect(200);
    await w.as('approver').http('post', `/variants/${id}/approve`).send({}).expect(200);
    await w
      .as('approver')
      .http('post', `/variants/${id}/schedule`)
      .send({ scheduledAt: new Date(Date.now() + 120_000).toISOString() })
      .expect(200);
    const [job] = await ownerDb.select().from(publishJobs).where(eq(publishJobs.variantId, id));
    expect(
      await app.get(PublishRunner).run({ publishJobId: job!.id, workspaceId: w.workspaceId }),
    ).toEqual({
      status: 'succeeded',
    });

    const sent = (app.get(AdapterRegistry).get('instagram') as FakeAdapter).posts.get(
      job!.idempotencyKey,
    );
    expect(sent?.media).toHaveLength(1);
    expect(sent?.media[0]?.mimeType).toBe('image/jpeg');
    expect(sent?.media[0]?.url).toContain('.publish.jpg');
  });
});
