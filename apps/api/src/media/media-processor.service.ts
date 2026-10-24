/**
 * MEDIA-03/04: after upload, verify the file, read its real dimensions/duration and produce WebP
 * renditions (thumb for grids, preview for the editor). Runs in the worker via the `media` queue.
 * Security and lifecycle rules: ADR-0008.
 *
 * - Uploaded bytes are untrusted. The decoder (sharp / ffprobe) must recognise the format the
 *   client declared; ffmpeg may only read the local file (no network/other protocols).
 * - Verified bytes are copied to a final key that no presigned PUT can reach, with a
 *   copy-if-ETag-matches, so what was checked is exactly what gets published (no TOCTOU).
 * - MEDIA-04 (ADR-0009): a platform-ready copy is written next to the original — JPEG for images
 *   (HEIC via libheif), H.264/AAC MP4 for video (remux when already compliant) — with metadata
 *   such as GPS stripped. Publishing and validate() use that copy.
 * - Content problems → `failed` with a Thai reason, no retry. Infrastructure problems throw so
 *   BullMQ retries; the final attempt marks `failed` so nothing sits in `processing` forever.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Db, mediaAssets, withTenant } from '@scm/db';
import {
  CROP_RATIOS,
  cropBox,
  cropKey,
  formatMatches,
  isHeif,
  mediaType,
  PUBLISH_MIME,
  planVideo,
  posterTimeSec,
  publishKey,
  renditionKey,
  type Size,
  type VideoFacts,
  type VideoPlan,
} from '@scm/domain';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { type AppConfig, CONFIG } from '../config';
import { ObjectTooLargeError, StorageService } from './storage.service';

const run = promisify(execFile);

// One decode at a time per process and no cache: bounded memory on hostile input.
sharp.concurrency(1);
sharp.cache(false);

export interface MediaJobData {
  mediaAssetId: string;
  workspaceId: string;
}

export type ProcessResult = 'ready' | 'failed' | 'skipped';

/** A problem with the file itself — retrying will not help. */
class ContentError extends Error {}

interface Probe {
  width: number;
  height: number;
  durationSec?: number;
  /** Image file or extracted poster frame to render renditions from. */
  frame: string;
  video?: VideoFacts;
}

interface Published {
  publishKey: string;
  publishMimeType: string;
  publishSizeBytes: number;
  publishWidth: number;
  publishHeight: number;
  plan: VideoPlan | 'jpeg';
}

type Asset = typeof mediaAssets.$inferSelect;

/** Final, immutable location of a verified upload: `ws/<ws>/uploads/x.jpg` → `ws/<ws>/media/x.jpg`. */
export function finalKey(uploadKey: string): string {
  return uploadKey.replace('/uploads/', '/media/');
}

@Injectable()
export class MediaProcessor {
  private readonly log = new Logger(MediaProcessor.name);

  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async process(data: MediaJobData, opts: { finalAttempt?: boolean } = {}): Promise<ProcessResult> {
    const [asset] = await withTenant(this.db, { workspaceId: data.workspaceId }, (tx) =>
      tx.select().from(mediaAssets).where(eq(mediaAssets.id, data.mediaAssetId)),
    );
    if (asset?.status !== 'processing') return 'skipped';

    const dir = await mkdtemp(path.join(tmpdir(), 'scm-media-'));
    // Long transcodes must not look stuck to MediaSweeper (ADR-0008/0009).
    const heartbeat = setInterval(
      () =>
        void withTenant(this.db, { workspaceId: data.workspaceId }, (tx) =>
          tx
            .update(mediaAssets)
            .set({ processingStartedAt: new Date() })
            .where(eq(mediaAssets.id, data.mediaAssetId)),
        ).catch(() => undefined),
      this.cfg.MEDIA_HEARTBEAT_SEC * 1000,
    );
    try {
      const file = path.join(dir, 'original');
      const etag = await this.storage.download(asset.storageKey, file, this.cfg.MEDIA_MAX_BYTES);
      const type = mediaType(asset.mimeType);
      if (!type) throw new ContentError('ชนิดไฟล์นี้ไม่รองรับ');

      let patch: Partial<typeof mediaAssets.$inferInsert> = {};
      let detail: Record<string, unknown> = {};
      const key = finalKey(asset.storageKey);
      if (type.kind === 'document') {
        // Documents: verify it really is a PDF. Previews of documents are not in MEDIA-03 scope.
        await this.verifyPdf(file);
      } else {
        const probe =
          type.kind === 'image'
            ? await this.probeImage(asset, file, dir)
            : await this.probeVideo(asset, dir, file);
        const { plan, ...published } =
          type.kind === 'image'
            ? await this.publishImage(key, dir, probe.frame)
            : await this.publishVideo(key, dir, file, probe.video!);
        detail = { publish: plan };
        patch = {
          width: probe.width,
          height: probe.height,
          durationSec: probe.durationSec ?? null,
          ...(await this.renditions(
            key,
            probe.frame,
            { width: probe.width, height: probe.height },
            type.kind,
          )),
          ...published,
        };
      }

      // Only the exact bytes we validated move to the immutable key (ADR-0008, TOCTOU).
      try {
        await this.storage.copyIfMatch(asset.storageKey, key, etag, asset.mimeType);
      } catch (e) {
        if ((e as { name?: string }).name === 'PreconditionFailed') {
          throw new ContentError('ไฟล์ถูกเปลี่ยนระหว่างตรวจสอบ กรุณาอัปโหลดใหม่');
        }
        throw e;
      }
      await this.storage.delete(asset.storageKey).catch(() => undefined);
      return await this.finish(data, { ...patch, status: 'ready', storageKey: key }, detail);
    } catch (e) {
      if (e instanceof ContentError) {
        await this.storage.delete(asset.storageKey).catch(() => undefined);
        return this.finish(data, { status: 'failed', processingError: e.message });
      }
      if (e instanceof ObjectTooLargeError) {
        await this.storage.delete(asset.storageKey).catch(() => undefined);
        return this.finish(data, {
          status: 'failed',
          processingError: 'ไฟล์มีขนาดใหญ่เกินกว่าที่ระบบรองรับ',
        });
      }
      this.log.error(
        { mediaAssetId: data.mediaAssetId, err: (e as Error).name },
        'media processing infrastructure error',
      );
      if (opts.finalAttempt) {
        return this.finish(data, {
          status: 'failed',
          processingError: 'ระบบประมวลผลไฟล์ไม่สำเร็จ กรุณาอัปโหลดใหม่อีกครั้ง',
        });
      }
      throw e;
    } finally {
      clearInterval(heartbeat);
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * MEDIA-04: JPEG every platform accepts — EXIF rotation baked in, transparency flattened onto
   * white, all metadata (GPS, camera, author) dropped, downscaled only beyond the cap.
   */
  private async publishImage(key: string, dir: string, frame: string): Promise<Published> {
    const out = path.join(dir, 'publish.jpg');
    const max = this.cfg.MEDIA_PUBLISH_IMAGE_MAX_PX;
    const info = await sharp(frame, {
      limitInputPixels: this.cfg.MEDIA_MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: this.cfg.MEDIA_PUBLISH_JPEG_QUALITY, mozjpeg: true })
      .toFile(out)
      .catch(() => {
        throw new ContentError('แปลงรูปภาพเป็น JPEG ไม่สำเร็จ ไฟล์อาจเสียหาย');
      });
    const target = publishKey(key, 'image');
    const size = await this.storage.putFile(target, out, PUBLISH_MIME.image);
    return {
      publishKey: target,
      publishMimeType: PUBLISH_MIME.image,
      publishSizeBytes: size,
      publishWidth: info.width,
      publishHeight: info.height,
      plan: 'jpeg',
    };
  }

  /**
   * MEDIA-04: H.264/AAC MP4 with faststart and no metadata. Compliant files are remuxed (seconds);
   * others are transcoded (minutes) and scaled so the long side fits the cap.
   */
  private async publishVideo(
    key: string,
    dir: string,
    file: string,
    facts: VideoFacts,
  ): Promise<Published> {
    const max = this.cfg.MEDIA_PUBLISH_VIDEO_MAX_PX;
    const plan = planVideo(facts, max);
    const out = path.join(dir, 'publish.mp4');
    const common = ['-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', file];
    const maps = ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1'];
    const codec =
      plan === 'remux'
        ? ['-c', 'copy']
        : [
            '-vf',
            // Fit the long side within `max` (never upscale), keep even dimensions for yuv420p.
            `scale=w='if(gte(iw,ih),min(${max},iw),-2)':h='if(gte(iw,ih),-2,min(${max},ih))'`,
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-profile:v',
            'high',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-ac',
            '2',
          ];
    try {
      await run(
        this.cfg.FFMPEG_PATH,
        [...common, ...maps, ...codec, '-movflags', '+faststart', '-f', 'mp4', '-y', out],
        { timeout: this.cfg.MEDIA_TRANSCODE_TIMEOUT_SEC * 1000, maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
      throw new ContentError('แปลงวิดีโอเป็น MP4 ไม่สำเร็จ ไฟล์อาจเสียหายหรือยาวเกินกำหนด');
    }
    const dims = await this.videoSize(out);
    const target = publishKey(key, 'video');
    const size = await this.storage.putFile(target, out, PUBLISH_MIME.video);
    return {
      publishKey: target,
      publishMimeType: PUBLISH_MIME.video,
      publishSizeBytes: size,
      publishWidth: dims.width,
      publishHeight: dims.height,
      plan,
    };
  }

  private async videoSize(file: string): Promise<{ width: number; height: number }> {
    const { stdout } = await run(
      this.cfg.FFPROBE_PATH,
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'json',
        file,
      ],
      { timeout: this.cfg.MEDIA_PROCESS_TIMEOUT_SEC * 1000 },
    );
    const st = (JSON.parse(stdout) as { streams?: { width?: number; height?: number }[] })
      .streams?.[0];
    return { width: st?.width ?? 0, height: st?.height ?? 0 };
  }

  /** HEIC/HEIF → PNG with libheif (handles iPhone tile grids). The decode itself is the check. */
  private async decodeHeif(file: string, dir: string): Promise<string> {
    const out = path.join(dir, 'decoded.png');
    try {
      await run(this.cfg.HEIF_DEC_PATH, [file, out], {
        timeout: this.cfg.MEDIA_PROCESS_TIMEOUT_SEC * 1000,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e; // heif-dec missing: infra
      throw new ContentError('ไฟล์ HEIC เสียหายหรืออ่านไม่ได้');
    }
    return out;
  }

  /** Decode once, write both renditions and — MEDIA-05 — the per-platform aspect-ratio crops. */
  private async renditions(key: string, frame: string, original: Size, _kind: 'image' | 'video') {
    const base = sharp(frame, {
      limitInputPixels: this.cfg.MEDIA_MAX_INPUT_PIXELS,
      failOn: 'error',
      sequentialRead: true,
    }).rotate();
    const out: {
      thumbnailKey: string;
      previewKey: string;
      crops: Record<string, string> | null;
    } = {
      thumbnailKey: renditionKey(key, 'thumb'),
      previewKey: renditionKey(key, 'preview'),
      crops: null,
    };
    for (const [k, px] of [
      [out.thumbnailKey, this.cfg.MEDIA_THUMB_PX],
      [out.previewKey, this.cfg.MEDIA_PREVIEW_PX],
    ] as const) {
      const webp = await base
        .clone()
        .resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: this.cfg.MEDIA_WEBP_QUALITY })
        .toBuffer()
        .catch(() => {
          throw new ContentError('สร้างภาพตัวอย่างไม่สำเร็จ ไฟล์อาจเสียหาย');
        });
      await this.storage.put(k, webp, 'image/webp');
    }
    // MEDIA-05: cover-crop each ratio from the same frame (video uses its poster).
    const crops: Record<string, string> = {};
    for (const ratio of CROP_RATIOS) {
      const box = cropBox(original, ratio, this.cfg.MEDIA_PREVIEW_PX);
      const webp = await base
        .clone()
        .resize({ ...box, fit: 'cover' })
        .webp({ quality: this.cfg.MEDIA_WEBP_QUALITY })
        .toBuffer()
        .catch(() => {
          throw new ContentError('ตัดภาพตามสัดส่วนไม่สำเร็จ ไฟล์อาจเสียหาย');
        });
      const k = cropKey(key, ratio);
      await this.storage.put(k, webp, 'image/webp');
      crops[ratio] = k;
    }
    out.crops = crops;
    return out;
  }

  private async probeImage(asset: Asset, file: string, dir: string): Promise<Probe> {
    const heif = isHeif(asset.mimeType);
    const source = heif ? await this.decodeHeif(file, dir) : file;
    let meta: sharp.Metadata;
    try {
      // Header only (no pixel decode), so the size check below can give the specific reason.
      meta = await sharp(source, { limitInputPixels: false }).metadata();
    } catch {
      throw new ContentError('ไฟล์เสียหายหรือไม่ใช่รูปภาพที่ระบบรองรับ');
    }
    if (!heif && !formatMatches(asset.mimeType, meta.format)) {
      throw new ContentError('เนื้อไฟล์ไม่ตรงกับชนิดไฟล์ที่ระบุ');
    }
    if (!meta.width || !meta.height) throw new ContentError('อ่านขนาดรูปภาพไม่ได้');
    if (meta.width * meta.height > this.cfg.MEDIA_MAX_INPUT_PIXELS) {
      throw new ContentError('รูปภาพมีความละเอียดสูงเกินกว่าที่ระบบรองรับ');
    }
    // EXIF orientations 5–8 are rotated 90°: report the size people actually see.
    const swap = (meta.orientation ?? 1) >= 5;
    return {
      width: swap ? meta.height : meta.width,
      height: swap ? meta.width : meta.height,
      frame: source,
    };
  }

  private async probeVideo(asset: Asset, dir: string, file: string): Promise<Probe> {
    const timeout = this.cfg.MEDIA_PROCESS_TIMEOUT_SEC * 1000;
    // Hostile-input hardening (ADR-0008): local file only, bounded probing, no stdin.
    const safe = ['-v', 'error', '-protocol_whitelist', 'file'];
    const bounded = ['-probesize', '50M', '-analyzeduration', '30M'];
    let info: { streams?: VideoStream[]; format?: { duration?: string; format_name?: string } };
    try {
      const { stdout } = await run(
        this.cfg.FFPROBE_PATH,
        [...safe, ...bounded, '-print_format', 'json', '-show_streams', '-show_format', file],
        { timeout, maxBuffer: 10 * 1024 * 1024 },
      );
      info = JSON.parse(stdout);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e; // ffprobe missing: infra, retry
      throw new ContentError('ไฟล์วิดีโอเสียหายหรือเป็นรูปแบบที่ระบบอ่านไม่ได้');
    }
    if (!formatMatches(asset.mimeType, info.format?.format_name)) {
      throw new ContentError('เนื้อไฟล์ไม่ตรงกับชนิดไฟล์วิดีโอที่ระบุ');
    }
    const v = info.streams?.find((s) => s.codec_type === 'video');
    if (!v?.width || !v?.height) throw new ContentError('ไม่พบภาพในไฟล์วิดีโอ');
    const max = this.cfg.MEDIA_MAX_VIDEO_DIMENSION;
    if (v.width > max || v.height > max) {
      throw new ContentError('วิดีโอมีความละเอียดสูงเกินกว่าที่ระบบรองรับ');
    }
    const durationSec = Number(info.format?.duration ?? v.duration) || undefined;
    const audio = info.streams?.find((s) => s.codec_type === 'audio');
    const rotated = Math.abs(rotationOf(v)) % 180 === 90;

    const frame = path.join(dir, 'poster.png');
    try {
      await run(
        this.cfg.FFMPEG_PATH,
        [
          '-nostdin', // ffmpeg only; ffprobe never reads stdin
          ...safe,
          ...bounded,
          '-ss',
          String(posterTimeSec(durationSec)),
          '-i',
          file,
          '-map',
          '0:v:0',
          '-an',
          '-sn',
          '-dn',
          '-threads',
          '1',
          '-frames:v',
          '1',
          '-y',
          frame,
        ],
        { timeout },
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
      throw new ContentError('ดึงภาพตัวอย่างจากวิดีโอไม่สำเร็จ');
    }
    return {
      width: rotated ? v.height : v.width,
      height: rotated ? v.width : v.height,
      durationSec,
      video: {
        formatName: info.format?.format_name,
        videoCodec: v.codec_name,
        pixelFormat: v.pix_fmt,
        audioCodec: audio?.codec_name,
        width: v.width,
        height: v.height,
      },
      frame,
    };
  }

  private async verifyPdf(file: string): Promise<void> {
    const fh = await open(file, 'r');
    try {
      const head = Buffer.alloc(5);
      await fh.read(head, 0, 5, 0);
      if (head.toString('latin1') !== '%PDF-') throw new ContentError('ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้อง');
    } finally {
      await fh.close();
    }
  }

  private async finish(
    data: MediaJobData,
    patch: Partial<typeof mediaAssets.$inferInsert> & { status: 'ready' | 'failed' },
    detail: Record<string, unknown> = {},
  ): Promise<ProcessResult> {
    await withTenant(this.db, { workspaceId: data.workspaceId }, async (tx) => {
      await tx
        .update(mediaAssets)
        .set({ ...patch, processedAt: new Date() })
        .where(eq(mediaAssets.id, data.mediaAssetId));
      await this.audit.record(
        tx,
        {
          workspaceId: data.workspaceId,
          actorUserId: null,
          action: patch.status === 'ready' ? 'media.processed' : 'media.processing_failed',
          targetType: 'media_asset',
          targetId: data.mediaAssetId,
          after: { status: patch.status, error: patch.processingError, ...detail },
        },
        { audit: false },
      );
    });
    return patch.status;
  }
}

interface VideoStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}

function rotationOf(s: VideoStream): number {
  const side = s.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation;
  return side ?? Number(s.tags?.rotate ?? 0);
}
