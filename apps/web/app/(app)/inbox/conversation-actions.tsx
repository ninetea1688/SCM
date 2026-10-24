'use client';

/** INBOX-02 desk controls: reply box, claim/close buttons. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function ConversationActions({
  id,
  status,
}: {
  id: string;
  status: 'open' | 'claimed' | 'closed';
}) {
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

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(async () => {
            await bff(`/inbox/conversations/${id}/reply`, 'POST', { text: text.trim() });
            setText('');
          });
        }}
      >
        <input
          aria-label="ข้อความตอบกลับ"
          placeholder="พิมพ์ข้อความตอบผู้ใช้…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          ส่ง
        </button>
      </form>
      <div className="flex gap-2">
        {status !== 'claimed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                bff(`/inbox/conversations/${id}/status`, 'POST', { status: 'claimed' }),
              )
            }
            className="rounded-md px-3 py-1 text-xs ring-1 ring-line disabled:opacity-50"
          >
            รับเรื่อง
          </button>
        )}
        {status !== 'closed' && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => bff(`/inbox/conversations/${id}/status`, 'POST', { status: 'closed' }))
            }
            className="rounded-md px-3 py-1 text-xs ring-1 ring-line disabled:opacity-50"
          >
            ปิดการสนทนา
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
