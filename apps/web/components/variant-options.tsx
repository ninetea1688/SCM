'use client';

/**
 * POST-02: per-platform option controls, shared by the composer (new post) and
 * the variant card (edits). Validation lives in @scm/domain; this is just input.
 */
import type { Platform, VariantDraft } from '@scm/domain';

export type VariantOptions = NonNullable<VariantDraft['options']>;

const IG_FORMATS: { value: NonNullable<VariantOptions['igFormat']>; label: string }[] = [
  { value: 'feed', label: 'โพสต์ในฟีด' },
  { value: 'reel', label: 'รีล' },
  { value: 'story', label: 'สตอรี่' },
  { value: 'carousel', label: 'คารูเซล (ต้องมีสื่อ ≥ 2 ไฟล์)' },
];
const FB_FORMATS: { value: NonNullable<VariantOptions['fbFormat']>; label: string }[] = [
  { value: 'feed', label: 'โพสต์ในฟีด' },
  { value: 'reel', label: 'รีล' },
];
const LINE_MODES: { value: NonNullable<VariantOptions['lineMode']>; label: string }[] = [
  { value: 'broadcast', label: 'ส่งถึงผู้ติดตามทุกคน (Broadcast)' },
  { value: 'narrowcast', label: 'ส่งแบบเลือกกลุ่ม (Narrowcast)' },
];

const field = 'w-full rounded-lg border border-line bg-surface px-3 py-2 disabled:opacity-70';

export function VariantOptions({
  platform,
  options,
  onChange,
  disabled,
}: {
  platform: Platform;
  options: VariantOptions;
  onChange: (next: VariantOptions) => void;
  disabled?: boolean;
}) {
  if (platform === 'youtube') {
    return (
      <input
        aria-label="ชื่อวิดีโอ YouTube (จำเป็น)"
        placeholder="ชื่อวิดีโอ YouTube (จำเป็น)"
        maxLength={200}
        disabled={disabled}
        value={options.ytTitle ?? ''}
        onChange={(e) => onChange({ ...options, ytTitle: e.target.value || undefined })}
        className={field}
      />
    );
  }
  const select = (
    values: { value: string; label: string }[],
    key: 'igFormat' | 'fbFormat' | 'lineMode',
    label: string,
  ) => (
    <select
      aria-label={label}
      disabled={disabled}
      value={options[key] ?? ''}
      onChange={(e) =>
        onChange({ ...options, [key]: e.target.value || undefined } as VariantOptions)
      }
      className={field}
    >
      <option value="">{label} — ค่าเริ่มต้นของแพลตฟอร์ม</option>
      {values.map((v) => (
        <option key={v.value} value={v.value}>
          {v.label}
        </option>
      ))}
    </select>
  );
  if (platform === 'instagram') return select(IG_FORMATS, 'igFormat', 'รูปแบบโพสต์ Instagram');
  if (platform === 'facebook') return select(FB_FORMATS, 'fbFormat', 'รูปแบบโพสต์ Facebook');
  if (platform === 'line') return select(LINE_MODES, 'lineMode', 'โหมดส่งข้อความ LINE');
  return null;
}
