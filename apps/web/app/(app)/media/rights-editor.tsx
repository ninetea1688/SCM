'use client';

/** MEDIA-07: per-asset usage-rights editor (source, licence, expiry, consent on file). */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

const field = 'w-full rounded-md border border-line bg-surface px-2 py-1 text-sm';

export function RightsEditor({
  id,
  source,
  license,
  rightsExpireAt,
  consentOnFile,
}: {
  id: string;
  source: string | null;
  license: string | null;
  rightsExpireAt: string | null;
  consentOnFile: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    source: source ?? '',
    license: license ?? '',
    rightsExpireAt: rightsExpireAt ? rightsExpireAt.slice(0, 10) : '',
    consentOnFile,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await bff(`/media/${id}/rights`, 'PATCH', {
        source: form.source || null,
        license: form.license || null,
        rightsExpireAt: form.rightsExpireAt
          ? new Date(`${form.rightsExpireAt}T00:00:00Z`).toISOString()
          : null,
        consentOnFile: form.consentOnFile,
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
      className="mt-1.5 space-y-1.5 rounded-md border border-line bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        aria-label="แหล่งที่มา"
        placeholder="แหล่งที่มา"
        value={form.source}
        onChange={(e) => setForm({ ...form, source: e.target.value })}
        className={field}
      />
      <input
        aria-label="ใบอนุญาต"
        placeholder="ใบอนุญาต (เช่น CC-BY-4.0)"
        value={form.license}
        onChange={(e) => setForm({ ...form, license: e.target.value })}
        className={field}
      />
      <label className="flex items-center justify-between gap-2 text-xs text-muted">
        วันหมดสิทธิ์
        <input
          type="date"
          aria-label="วันหมดสิทธิ์"
          value={form.rightsExpireAt}
          onChange={(e) => setForm({ ...form, rightsExpireAt: e.target.value })}
          className={`${field} w-40`}
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.consentOnFile}
          onChange={(e) => setForm({ ...form, consentOnFile: e.target.checked })}
        />
        มีความยินยอมของบุคคลในภาพเป็นหลักฐาน
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-ink px-2 py-1 text-xs font-medium text-surface disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว ✓' : 'บันทึกข้อมูลสิทธิ์'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
