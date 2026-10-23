import { describe, expect, it } from 'vitest';
import { aspectLabel, formatMatches, mediaType, posterTimeSec, renditionKey } from './media.js';

describe('MEDIA-03 renditions', () => {
  it('ADR-0008: accepts only allowlisted types; SVG and HTML are refused', () => {
    expect(mediaType('image/jpeg')?.kind).toBe('image');
    expect(mediaType('video/quicktime')?.ext).toBe('mov');
    expect(mediaType('image/svg+xml')).toBeUndefined();
    expect(mediaType('application/xhtml+xml')).toBeUndefined();
  });

  it('ADR-0008: the detected format must match the declared type', () => {
    expect(formatMatches('image/png', 'png')).toBe(true);
    expect(formatMatches('image/png', 'jpeg')).toBe(false);
    expect(formatMatches('video/mp4', 'mov,mp4,m4a,3gp,3g2,mj2')).toBe(true);
    expect(formatMatches('video/mp4', 'hls')).toBe(false);
    expect(formatMatches('image/png', undefined)).toBe(false);
  });

  it('takes the poster frame ~1 s in, or mid-clip for very short videos', () => {
    expect(posterTimeSec(30)).toBe(1);
    expect(posterTimeSec(1)).toBe(0.5);
    expect(posterTimeSec(undefined)).toBe(0);
  });

  it('labels common platform aspect ratios', () => {
    expect(aspectLabel({ width: 1080, height: 1920 })).toBe('9:16');
    expect(aspectLabel({ width: 1080, height: 1350 })).toBe('4:5');
    expect(aspectLabel({ width: 1000, height: 1000 })).toBe('1:1');
    expect(aspectLabel({ width: 1000, height: 300 })).toBe('3.33:1');
  });

  it('derives rendition keys from the original key', () => {
    expect(renditionKey('ws/a/b.jpg', 'thumb')).toBe('ws/a/b.jpg.thumb.webp');
  });
});
