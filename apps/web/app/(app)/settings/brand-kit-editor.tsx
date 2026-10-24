'use client';

/** BRAND-01/02: workspace brand kit (signature, hashtags) and voice (tone, notes, examples). */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export interface BrandKit {
  signature?: string;
  defaultHashtags?: string[];
  tone?: string;
  voiceNotes?: string;
  examplePosts?: string[];
}

const field = 'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm';

export function BrandKitEditor({ initial }: { initial: BrandKit }) {
  const router = useRouter();
  const [form, setForm] = useState({
    signature: initial.signature ?? '',
    hashtags: (initial.defaultHashtags ?? []).join(', '),
    tone: initial.tone ?? '',
    voiceNotes: initial.voiceNotes ?? '',
    examplePosts: (initial.examplePosts ?? []).join('\n---\n'),
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await bff('/workspaces/current/settings', 'PATCH', {
        brand: {
          signature: form.signature,
          defaultHashtags: form.hashtags
            .split(',')
            .map((h) => h.trim().replace(/^#/, ''))
            .filter(Boolean),
          tone: form.tone,
          voiceNotes: form.voiceNotes,
          examplePosts: form.examplePosts
            .split('\n---\n')
            .map((p) => p.trim())
            .filter(Boolean),
        },
      });
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
      <label className="block space-y-1">
        <span className="text-xs text-muted">ลายเซ็นท้ายโพสต์ (BRAND-01)</span>
        <textarea
          rows={2}
          value={form.signature}
          onChange={(e) => setForm({ ...form, signature: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">แฮชแท็กประจำ (คั่นด้วยจุลภาค ไม่ต้องมี #)</span>
        <input
          value={form.hashtags}
          onChange={(e) => setForm({ ...form, hashtags: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">โทนเสียง (BRAND-02)</span>
        <input
          placeholder="เช่น เป็นทางการ อบอุ่น เข้าใจง่าย"
          value={form.tone}
          onChange={(e) => setForm({ ...form, tone: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">ข้อควรระวังด้านถ้อยคำ</span>
        <textarea
          rows={2}
          value={form.voiceNotes}
          onChange={(e) => setForm({ ...form, voiceNotes: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">
          ตัวอย่างโพสต์ที่ดี (คั่นด้วยบรรทัด --- ) — เป็นบริบทของ AI เมื่อเปิดใช้
        </span>
        <textarea
          rows={3}
          value={form.examplePosts}
          onChange={(e) => setForm({ ...form, examplePosts: e.target.value })}
          className={field}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว ✓' : 'บันทึก Brand Kit'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
