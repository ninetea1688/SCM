/**
 * Media renditions — PRD MEDIA-03 (thumbnail + preview). Sizes are defaults; workspaces/env may
 * override them (PRD §0). Renditions never upscale the original.
 */

export type RenditionName = 'thumb' | 'preview';

/** Longest-side pixel size per rendition. */
export const DEFAULT_RENDITIONS: Record<RenditionName, number> = {
  thumb: 320,
  preview: 1280,
};

export interface Size {
  width: number;
  height: number;
}

export type MediaKindAll = 'image' | 'video' | 'document';

interface MediaType {
  kind: MediaKindAll;
  ext: string;
  /** What the decoder must report for the file to be accepted (ADR-0008: never trust the client). */
  verify: readonly string[];
}

/**
 * Accepted upload types (allowlist). SVG/HTML/XML are refused: they can carry script and would
 * render as active content. HEIC is accepted for upload; conversion is MEDIA-04.
 */
export const MEDIA_TYPES: Record<string, MediaType> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', verify: ['jpeg'] },
  'image/png': { kind: 'image', ext: 'png', verify: ['png'] },
  'image/webp': { kind: 'image', ext: 'webp', verify: ['webp'] },
  // HEIC/HEIF are decoded with libheif (heif-dec): sharp's prebuilt libvips has no HEVC decoder.
  'image/heic': { kind: 'image', ext: 'heic', verify: ['heif'] },
  'image/heif': { kind: 'image', ext: 'heif', verify: ['heif'] },
  'video/mp4': { kind: 'video', ext: 'mp4', verify: ['mov,mp4,m4a,3gp,3g2,mj2'] },
  'video/quicktime': { kind: 'video', ext: 'mov', verify: ['mov,mp4,m4a,3gp,3g2,mj2'] },
  'video/webm': { kind: 'video', ext: 'webm', verify: ['matroska,webm'] },
  'application/pdf': { kind: 'document', ext: 'pdf', verify: ['pdf'] },
};

export const ACCEPTED_MIME_TYPES = Object.keys(MEDIA_TYPES);

export function mediaType(mimeType: string): MediaType | undefined {
  return MEDIA_TYPES[mimeType.toLowerCase()];
}

/** Does the format the decoder detected match the declared MIME type? */
export function formatMatches(mimeType: string, detected: string | undefined): boolean {
  const t = mediaType(mimeType);
  return !!t && !!detected && t.verify.includes(detected);
}

/** Second at which to grab a video poster frame: ~1 s in, or the middle of very short clips. */
export function posterTimeSec(durationSec: number | undefined): number {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.min(1, durationSec / 2);
}

/** Aspect ratio label used for filtering (MEDIA-02) and platform checks, e.g. "9:16". */
export function aspectLabel({ width, height }: Size): string {
  if (!width || !height) return 'unknown';
  const r = width / height;
  const known: [string, number][] = [
    ['1:1', 1],
    ['4:5', 0.8],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1.91:1', 1.91],
  ];
  const hit = known.find(([, v]) => Math.abs(r - v) / v < 0.02);
  return hit ? hit[0] : `${Math.round(r * 100) / 100}:1`;
}

/** Storage key for a rendition, derived from the original so it is easy to clean up together. */
export function renditionKey(storageKey: string, name: RenditionName): string {
  return `${storageKey}.${name}.webp`;
}

// ── MEDIA-04: publishable renditions (ADR-0009) ─────────────────────────────────────────────

/** Every platform we publish to accepts these; originals are kept untouched for the archive. */
export const PUBLISH_MIME: Record<'image' | 'video', string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
};

export function isHeif(mimeType: string): boolean {
  return mediaType(mimeType)?.verify.includes('heif') ?? false;
}

export interface VideoFacts {
  formatName?: string;
  videoCodec?: string;
  pixelFormat?: string;
  /** Undefined when the file has no audio stream. */
  audioCodec?: string;
  width: number;
  height: number;
}

export type VideoPlan = 'remux' | 'transcode';

/**
 * Re-encoding costs minutes of CPU and some quality; only do it when a platform would reject the
 * file. H.264 / yuv420p video with AAC (or no) audio in an MP4/MOV container only needs remuxing
 * (+faststart, metadata stripped) — unless it exceeds the size cap and must be scaled down.
 */
export function planVideo(f: VideoFacts, maxLongSide: number): VideoPlan {
  const container = f.formatName?.split(',').includes('mp4') ?? false;
  const video = f.videoCodec === 'h264' && f.pixelFormat === 'yuv420p';
  const audio = f.audioCodec === undefined || f.audioCodec === 'aac';
  const fits = Math.max(f.width, f.height) <= maxLongSide;
  return container && video && audio && fits ? 'remux' : 'transcode';
}

/** Storage key for the publishable copy, next to the verified original. */
export function publishKey(storageKey: string, kind: 'image' | 'video'): string {
  return `${storageKey}.publish.${kind === 'image' ? 'jpg' : 'mp4'}`;
}
