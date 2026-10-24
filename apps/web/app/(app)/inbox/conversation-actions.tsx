'use client';

/**
 * INBOX-02/05/06 desk controls: reply box with `/shortcut` saved replies, internal-note
 * toggle, and claim/close buttons. A note is stored on the thread but never sent.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface SavedReply {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

export function ConversationActions({
  id,
  status,
}: {
  id: string;
  status: 'open' | 'claimed' | 'closed';
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [asNote, setAsNote] = useState(false);
  const [saved, setSaved] = useState<SavedReply[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bff<SavedReply[]>('/saved-replies')
      .then(setSaved)
      .catch(() => {});
  }, []);

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

  /** INBOX-05: typing `/shortcut` (or picking from the list) expands the standard answer. */
  function applyShortcut(value: string) {
    const hit = /^\/([\w.-]+)$/.exec(value.trim());
    if (!hit) return false;
    const match = saved.find((s) => s.shortcut === hit[1]);
    if (!match) return false;
    setText(match.body);
    return true;
  }

  function submit() {
    if (!text.trim()) return;
    void run(async () => {
      if (asNote) {
        await bff(`/inbox/conversations/${id}/note`, 'POST', { text: text.trim() });
      } else {
        await bff(`/inbox/conversations/${id}/reply`, 'POST', { text: text.trim() });
      }
      setText('');
      setAsNote(false);
    });
  }

  return (
    <div className="space-y-2">
      {saved.length > 0 && !asNote && (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">คำตอบมาตรฐาน</legend>
          {saved.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setText(s.body)}
              title={s.body}
              className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-ink"
            >
              {s.shortcut ? `/${s.shortcut}` : s.title}
            </button>
          ))}
        </fieldset>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (applyShortcut(text)) return;
          submit();
        }}
      >
        <input
          aria-label={asNote ? 'โน้ตภายใน' : 'ข้อความตอบกลับ'}
          placeholder={
            asNote ? 'โน้ตภายใน (ลูกค้ามองไม่เห็น)…' : 'พิมพ์ข้อความตอบผู้ใช้ หรือ /shortcut สำหรับคำตอบมาตรฐาน…'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`min-w-0 flex-1 rounded-md border bg-surface px-3 py-2 text-sm ${asNote ? 'border-warn' : 'border-line'}`}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            asNote ? 'bg-warn text-ink' : 'bg-brand text-brand-ink'
          }`}
        >
          {asNote ? 'บันทึกโน้ต' : 'ส่ง'}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={asNote} onChange={(e) => setAsNote(e.target.checked)} />
          เป็นโน้ตภายใน (INBOX-06)
        </label>
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
        <a href="/saved-replies" className="ml-auto text-xs text-brand underline">
          จัดการคำตอบมาตรฐาน
        </a>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
