'use client';

/** APPR-03: internal discussion on the post — team-only, never published. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface Entry {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

const thTime = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function DiscussionSection({ postId, initial }: { postId: string; initial: Entry[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await bff(`/posts/${postId}/comments`, 'POST', { text: text.trim() });
      setText('');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="font-medium">ความเห็นภายในทีม (APPR-03)</h2>
      <p className="text-xs text-muted">สนทนาระหว่างผู้เขียนและผู้อนุมัติ — ไม่เผยแพร่ไปที่ใด</p>
      <ul className="space-y-1.5">
        {initial.map((c) => (
          <li key={c.id} className="rounded-lg bg-line/60 px-3 py-2 text-sm">
            <span className="font-medium">{c.author}</span>
            <span className="ml-2 text-xs text-muted">{thTime.format(new Date(c.createdAt))}</span>
            <p className="mt-0.5">{c.text}</p>
          </li>
        ))}
        {initial.length === 0 && <li className="text-xs text-muted">ยังไม่มีความเห็น</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void add();
        }}
      >
        <input
          aria-label="ความเห็นภายใน"
          placeholder="เพิ่มความเห็นภายใน…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
        >
          ส่ง
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
