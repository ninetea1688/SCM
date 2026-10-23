'use client';

/** Dev/CI helper: create accounts backed by the fake publisher (API refuses in live mode). */
import { PLATFORM_LABEL_TH, PLATFORMS, type Platform } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function SandboxForm() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('facebook');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      await bff('/accounts/sandbox', 'POST', {
        platform,
        name: `ทดสอบ ${PLATFORM_LABEL_TH[platform]}`,
      });
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-dashed border-line p-4">
      <h2 className="font-medium">บัญชีทดสอบ (โหมด sandbox)</h2>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">แพลตฟอร์ม</legend>
        {PLATFORMS.map((p) => (
          <label
            key={p}
            className="cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ring-line has-[:checked]:bg-ink has-[:checked]:text-surface"
          >
            <input
              type="radio"
              name="sandbox-platform"
              value={p}
              checked={platform === p}
              onChange={() => setPlatform(p)}
              className="sr-only"
            />
            {PLATFORM_LABEL_TH[p]}
          </label>
        ))}
        <button
          type="button"
          onClick={create}
          className="rounded-md bg-brand px-3 py-1.5 text-sm text-brand-ink"
        >
          เพิ่มบัญชีทดสอบ
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
