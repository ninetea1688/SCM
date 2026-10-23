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
  'image/heic': { kind: 'image', ext: 'heic', verify: ['heif'] },
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
