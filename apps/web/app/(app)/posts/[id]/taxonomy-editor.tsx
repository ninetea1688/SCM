'use client';

/** POST-05: content taxonomy labels — editor + chips (team-visible, audited). */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export interface Taxonomy {
  pillar?: string;
  topic?: string;
  audience?: string;
  format?: string;
  length?: string;
  hook?: string;
  cta?: string;
  aiUsed?: boolean;
  partnerShared?: boolean;
}

const FIELDS: { key: keyof Taxonomy; label: string }[] = [
  { key: 'pillar', label: 'Pillar' },
  { key: 'topic', label: 'หัวข้อ' },
  { key: 'audience', label: 'กลุ่มเป้าหมาย' },
  { key: 'format', label: 'รูปแบบ' },
  { key: 'length', label: 'ความยาว' },
  { key: 'hook', label: 'Hook' },
  { key: 'cta', label: 'CTA' },
];

const field = 'w-full rounded-md border border-line bg-surface px-2 py-1 text-sm';

export function TaxonomyChips({ t }: { t: Taxonomy }) {
  const chips = FIELDS.filter((f) => t[f.key]).map((f) => `${f.label}: ${t[f.key]}`);
  const flags = [t.aiUsed ? 'ใช้ AI' : null, t.partnerShared ? 'แชร์จากพันธมิตร' : null].filter(
    Boolean,
  );
  if (chips.length === 0 && flags.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1.5" title="ป้ายคอนเทนต์ (POST-05)">
      {[...chips, ...flags].map((c) => (
        <span key={c} className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">
          {c}
        </span>
      ))}
    </p>
  );
}

export function TaxonomyEditor({ postId, initial }: { postId: string; initial: Taxonomy }) {
  const router = useRouter();
  const [form, setForm] = useState({
    pillar: initial.pillar ?? '',
    topic: initial.topic ?? '',
    audience: initial.audience ?? '',
    format: initial.format ?? '',
    length: initial.length ?? '',
    hook: initial.hook ?? '',
    cta: initial.cta ?? '',
    aiUsed: initial.aiUsed ?? false,
    partnerShared: initial.partnerShared ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [
          k,
          typeof v === 'string' && v === '' ? undefined : v,
        ]),
      );
      await bff(`/posts/${postId}/taxonomy`, 'PUT', payload);
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block space-y-0.5">
            <span className="text-xs text-muted">{f.label}</span>
            <input
              value={form[f.key] as string}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              className={field}
            />
          </label>
        ))}
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.aiUsed}
            onChange={(e) => setForm({ ...form, aiUsed: e.target.checked })}
          />
          ใช้ AI ช่วย (ป้ายตาม POST-05)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.partnerShared}
            onChange={(e) => setForm({ ...form, partnerShared: e.target.checked })}
          />
          แชร์จากพันธมิตร
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว ✓' : 'บันทึกป้ายคอนเทนต์'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
