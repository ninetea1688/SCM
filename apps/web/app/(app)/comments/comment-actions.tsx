'use client';

/** Comment desk actions: reply inline (public) and hide (MOD-01/03 lite). */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function CommentActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (status !== 'open') return null;

  return (
    <div className="space-y-1.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(async () => {
            await bff(`/comments/${id}/reply`, 'POST', { text: text.trim() });
            setText('');
          });
        }}
      >
        <input
          aria-label="ข้อความตอบคอมเมนต์"
          placeholder="ตอบใต้คอมเมนต์…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          ตอบ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('ซ่อนคอมเมนต์นี้?')) {
              void run(() => bff(`/comments/${id}/hide`, 'POST', {}));
            }
          }}
          className="rounded-md px-3 py-1.5 text-sm text-danger ring-1 ring-danger disabled:opacity-50"
        >
          ซ่อน
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
