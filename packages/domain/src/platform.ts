export const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'line'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL_TH: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  line: 'LINE OA',
};

/** Phase in which each platform's publisher ships (PRD PUB-02). */
export const PLATFORM_PHASE: Record<Platform, 'P1' | 'P2'> = {
  facebook: 'P1',
  instagram: 'P1',
  line: 'P1',
  tiktok: 'P2',
  youtube: 'P2',
};

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as readonly string[]).includes(value);
}
