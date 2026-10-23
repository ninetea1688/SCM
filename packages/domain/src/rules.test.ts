import { describe, expect, it } from 'vitest';
import { checkQuota, lineMessageCost } from './quota.js';
import { can, canOnAccount, ownerChangeAllowed } from './rbac.js';
import { REDACTED, redact } from './redact.js';
import { formatThaiDate, formatThaiDateTime } from './thai-date.js';
import { blockingIssues, type MediaFacts, validateVariant } from './validation.js';

const img: MediaFacts = { kind: 'image', mimeType: 'image/jpeg', sizeBytes: 1000 };
const vid: MediaFacts = { kind: 'video', mimeType: 'video/mp4', sizeBytes: 1000, durationSec: 30 };

describe('validateVariant (POST-04)', () => {
  it('blocks mixing photo and video on Facebook with a Thai reason', () => {
    const issues = validateVariant({ platform: 'facebook', caption: 'hi' }, [img, vid]);
    const mixed = issues.find((i) => i.code === 'mixed_media');
    expect(mixed?.severity).toBe('error');
    expect(mixed?.messageTh).toMatch(/ผสมรูปกับวิดีโอ/);
  });

  it('requires media on Instagram and limits hashtags', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    const codes = validateVariant({ platform: 'instagram', caption: tags }, []).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['media_required', 'too_many_hashtags']));
  });

  it('requires a YouTube title without angle brackets', () => {
    const codes = (title: string) =>
      validateVariant({ platform: 'youtube', caption: '', options: { ytTitle: title } }, [vid]).map(
        (i) => i.code,
      );
    expect(codes('')).toContain('title_required');
    expect(codes('a<b')).toContain('title_invalid_chars');
    expect(codes('ข่าวดี')).toEqual([]);
  });

  it('passes a valid LINE text message', () => {
    expect(blockingIssues(validateVariant({ platform: 'line', caption: 'สวัสดี' }, []))).toEqual([]);
  });
});

describe('rbac (§3.2)', () => {
  it('matches the PRD matrix for key permissions', () => {
    expect(can('editor', 'post.approve')).toBe(false);
    expect(can('approver', 'post.approve')).toBe(true);
    expect(can('agent', 'inbox.reply_sensitive')).toBe(false);
    expect(can('agent', 'inbox.draft_sensitive')).toBe(true);
    expect(can('viewer', 'post.edit')).toBe(false);
    expect(can('admin', 'audit.view')).toBe(true);
    expect(can('approver', 'audit.view')).toBe(false);
  });

  it('AUTH-03: account scope restricts access', () => {
    expect(canOnAccount('agent', 'inbox.reply', { socialAccountIds: ['line1'] }, 'fb1')).toBe(
      false,
    );
    expect(canOnAccount('agent', 'inbox.reply', {}, 'fb1')).toBe(true);
  });

  it('AUTH-06: cannot drop below two owners', () => {
    expect(ownerChangeAllowed(2, -1)).toBe(false);
    expect(ownerChangeAllowed(3, -1)).toBe(true);
    expect(ownerChangeAllowed(1, +1)).toBe(true);
  });
});

describe('redact (PUB-07)', () => {
  it('removes tokens from keys, query strings and bearer headers', () => {
    const out = redact({
      access_token: 'abc',
      url: 'https://graph.facebook.com/me?fields=id&access_token=SECRET123',
      headers: { Authorization: 'Bearer xyz' },
      nested: [{ note: 'Bearer zzz.yyy' }],
      message: 'ok',
    });
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/abc|SECRET123|xyz|zzz/);
    expect(s).toContain(REDACTED);
    expect(s).toContain('"message":"ok"');
  });
});

describe('quota (PUB-05/08)', () => {
  it('warns at 80% and flags exceeded', () => {
    expect(checkQuota(70, 10, 100).level).toBe('warning');
    expect(checkQuota(95, 10, 100).level).toBe('exceeded');
    expect(checkQuota(10, 10, 100).level).toBe('ok');
  });
  it('LINE counts per recipient per message object; reply is free', () => {
    expect(lineMessageCost(10_000, 3, 'broadcast')).toBe(30_000);
    expect(lineMessageCost(1, 5, 'reply')).toBe(0);
  });
});

describe('thai-date (CAL-03)', () => {
  it('formats in Buddhist Era, Asia/Bangkok', () => {
    const d = new Date('2026-10-22T18:30:00Z'); // 01:30 on 23 Oct in Bangkok
    expect(formatThaiDate(d)).toContain('2569');
    expect(formatThaiDate(d)).toContain('23');
    expect(formatThaiDateTime(d)).toMatch(/\(2026\) 01:30 น\.$/);
  });
});
