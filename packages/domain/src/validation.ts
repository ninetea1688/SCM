/**
 * Pre-approval spec check — PRD POST-04 (moved to P1 by ADR-0002).
 *
 * Limits change often (PRD §0). Every number lives in PLATFORM_LIMITS with its source so
 * the `platform-researcher` agent can re-verify them; never inline a limit elsewhere.
 * Workspaces may override via config, which is why limits are a parameter.
 */
import type { Platform } from './platform.js';

export type MediaKind = 'image' | 'video';

export interface MediaFacts {
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface VariantDraft {
  platform: Platform;
  caption: string;
  /** Platform-specific options (PRD POST-02). */
  options?: {
    igFormat?: 'feed' | 'reel' | 'story' | 'carousel';
    fbFormat?: 'feed' | 'reel';
    ytTitle?: string;
    lineMode?: 'broadcast' | 'narrowcast';
  };
}

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  field: 'caption' | 'media' | 'options';
  /** Readable Thai explanation shown next to the field (PRD POST-04 AC). */
  messageTh: string;
}

export interface PlatformLimits {
  captionMax: number;
  hashtagMax?: number;
  mediaMin: number;
  mediaMax: number;
  allowMixedMedia: boolean;
  imageMimeTypes: readonly string[];
  videoMimeTypes: readonly string[];
  videoMaxSec?: number;
  videoMinSec?: number;
  titleMax?: number;
  source: string;
  verifiedAt: string;
}

export const PLATFORM_LIMITS: Record<Platform, PlatformLimits> = {
  facebook: {
    captionMax: 63_206,
    mediaMin: 0,
    mediaMax: 10,
    allowMixedMedia: false,
    imageMimeTypes: ['image/jpeg', 'image/png'],
    videoMimeTypes: ['video/mp4'],
    source: 'https://developers.facebook.com/documentation/pages-api/posts',
    verifiedAt: 'unverified',
  },
  instagram: {
    captionMax: 2_200,
    hashtagMax: 30,
    mediaMin: 1,
    mediaMax: 10,
    allowMixedMedia: true,
    imageMimeTypes: ['image/jpeg'],
    videoMimeTypes: ['video/mp4', 'video/quicktime'],
    videoMinSec: 3,
    videoMaxSec: 15 * 60,
    source: 'https://developers.facebook.com/docs/instagram-platform/content-publishing',
    verifiedAt: 'unverified',
  },
  tiktok: {
    captionMax: 2_200,
    mediaMin: 1,
    mediaMax: 35,
    allowMixedMedia: false,
    imageMimeTypes: ['image/jpeg', 'image/webp'],
    videoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    videoMinSec: 3,
    videoMaxSec: 10 * 60,
    source: 'https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post',
    verifiedAt: 'unverified',
  },
  youtube: {
    captionMax: 5_000,
    titleMax: 100,
    mediaMin: 1,
    mediaMax: 1,
    allowMixedMedia: false,
    imageMimeTypes: [],
    videoMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    source: 'https://developers.google.com/youtube/v3/docs/videos/insert',
    verifiedAt: 'unverified',
  },
  line: {
    captionMax: 5_000,
    mediaMin: 0,
    mediaMax: 4,
    allowMixedMedia: true,
    imageMimeTypes: ['image/jpeg', 'image/png'],
    videoMimeTypes: ['video/mp4'],
    source: 'https://developers.line.biz/en/reference/messaging-api/',
    verifiedAt: 'unverified',
  },
};

const HASHTAG = /#[^\s#]+/gu;

export function validateVariant(
  variant: VariantDraft,
  media: readonly MediaFacts[],
  limits: PlatformLimits = PLATFORM_LIMITS[variant.platform],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);
  const caption = variant.caption ?? '';

  if (caption.length > limits.captionMax) {
    add({
      code: 'caption_too_long',
      severity: 'error',
      field: 'caption',
      messageTh: `ข้อความยาว ${caption.length.toLocaleString('th-TH')} ตัวอักษร เกินที่แพลตฟอร์มรับได้ (${limits.captionMax.toLocaleString('th-TH')})`,
    });
  }
  if (limits.hashtagMax !== undefined) {
    const count = caption.match(HASHTAG)?.length ?? 0;
    if (count > limits.hashtagMax) {
      add({
        code: 'too_many_hashtags',
        severity: 'error',
        field: 'caption',
        messageTh: `ใช้แฮชแท็ก ${count} อัน เกินกำหนด ${limits.hashtagMax} อัน`,
      });
    }
  }
  if (caption.trim().length === 0 && media.length === 0) {
    add({
      code: 'empty',
      severity: 'error',
      field: 'caption',
      messageTh: 'ต้องมีข้อความหรือสื่ออย่างน้อยหนึ่งอย่าง',
    });
  }

  if (media.length < limits.mediaMin) {
    add({
      code: 'media_required',
      severity: 'error',
      field: 'media',
      messageTh: `แพลตฟอร์มนี้ต้องแนบสื่ออย่างน้อย ${limits.mediaMin} ไฟล์`,
    });
  }
  if (media.length > limits.mediaMax) {
    add({
      code: 'too_many_media',
      severity: 'error',
      field: 'media',
      messageTh: `แนบสื่อ ${media.length} ไฟล์ เกินกำหนด ${limits.mediaMax} ไฟล์`,
    });
  }

  const kinds = new Set(media.map((m) => m.kind));
  if (!limits.allowMixedMedia && kinds.size > 1) {
    add({
      code: 'mixed_media',
      severity: 'error',
      field: 'media',
      messageTh: 'โพสต์เดียวผสมรูปกับวิดีโอไม่ได้ ให้แยกเป็นคนละโพสต์',
    });
  }
  if (variant.platform === 'facebook' && media.filter((m) => m.kind === 'video').length > 1) {
    add({
      code: 'multiple_videos',
      severity: 'error',
      field: 'media',
      messageTh: 'Facebook โพสต์วิดีโอได้ครั้งละ 1 คลิป',
    });
  }

  media.forEach((m, idx) => {
    const n = idx + 1;
    const allowed = m.kind === 'image' ? limits.imageMimeTypes : limits.videoMimeTypes;
    if (!allowed.includes(m.mimeType)) {
      add({
        code: 'unsupported_type',
        severity: 'error',
        field: 'media',
        messageTh: `ไฟล์ที่ ${n} เป็นชนิด ${m.mimeType} ซึ่งแพลตฟอร์มไม่รองรับ (ระบบจะแปลงไฟล์ให้ได้หากเป็นชนิดที่รู้จัก)`,
      });
    }
    if (m.kind === 'video' && m.durationSec !== undefined) {
      if (limits.videoMaxSec !== undefined && m.durationSec > limits.videoMaxSec) {
        add({
          code: 'video_too_long',
          severity: 'error',
          field: 'media',
          messageTh: `วิดีโอไฟล์ที่ ${n} ยาว ${Math.round(m.durationSec)} วินาที เกินกำหนด ${limits.videoMaxSec} วินาที`,
        });
      }
      if (limits.videoMinSec !== undefined && m.durationSec < limits.videoMinSec) {
        add({
          code: 'video_too_short',
          severity: 'error',
          field: 'media',
          messageTh: `วิดีโอไฟล์ที่ ${n} สั้นกว่า ${limits.videoMinSec} วินาที`,
        });
      }
    }
  });

  if (variant.platform === 'youtube') {
    const title = variant.options?.ytTitle ?? '';
    if (title.trim().length === 0) {
      add({
        code: 'title_required',
        severity: 'error',
        field: 'options',
        messageTh: 'YouTube ต้องมีชื่อวิดีโอ',
      });
    } else if (limits.titleMax !== undefined && title.length > limits.titleMax) {
      add({
        code: 'title_too_long',
        severity: 'error',
        field: 'options',
        messageTh: `ชื่อวิดีโอยาวเกิน ${limits.titleMax} ตัวอักษร`,
      });
    }
    if (/[<>]/.test(title)) {
      add({
        code: 'title_invalid_chars',
        severity: 'error',
        field: 'options',
        messageTh: 'ชื่อวิดีโอ YouTube ห้ามมีเครื่องหมาย < หรือ >',
      });
    }
  }

  if (variant.platform === 'instagram' && variant.options?.igFormat === 'carousel') {
    if (media.length < 2) {
      add({
        code: 'carousel_too_small',
        severity: 'error',
        field: 'media',
        messageTh: 'Carousel ต้องมีสื่ออย่างน้อย 2 ไฟล์',
      });
    }
  }

  return issues;
}

export function blockingIssues(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((i) => i.severity === 'error');
}
