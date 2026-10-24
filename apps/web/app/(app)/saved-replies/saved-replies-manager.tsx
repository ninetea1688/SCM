'use client';

/** INBOX-05 CRUD for standard answers. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface SavedReply {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

const field = 'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm';
const EMPTY = { title: '', body: '', shortcut: '' };

export function SavedRepliesManager({ initial }: { initial: SavedReply[] }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        shortcut: form.shortcut.trim() || undefined,
      };
      if (editingId) await bff(`/saved-replies/${editingId}`, 'PATCH', payload);
      else await bff('/saved-replies', 'POST', payload);
      setForm(EMPTY);
      setEditingId(null);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('ลบคำตอบมาตรฐานนี้?')) return;
    setBusy(true);
    try {
      await bff(`/saved-replies/${id}`, 'DELETE');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-xl border border-line bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 className="font-medium">{editingId ? 'แก้ไขคำตอบ' : 'เพิ่มคำตอบมาตรฐาน'}</h2>
        <div className="flex flex-wrap gap-2">
          <input
            required
            aria-label="ชื่อ"
            placeholder="ชื่อ (เช่น ทักทาย)"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={`${field} flex-1 min-w-48`}
          />
          <input
            aria-label="คำสั่งย่อ"
            placeholder="คำสั่งย่อ (เช่น hi) — ไม่ต้องมี /"
            value={form.shortcut}
            onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
            className={`${field} w-48`}
          />
        </div>
        <textarea
          required
          rows={3}
          aria-label="เนื้อความคำตอบ"
          placeholder="เนื้อความคำตอบ"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          className={field}
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !form.title || !form.body}
            className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
          >
            {busy ? 'กำลังบันทึก…' : editingId ? 'บันทึกการแก้ไข' : 'เพิ่ม'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(EMPTY);
              }}
              className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line"
            >
              ยกเลิก
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>

      <ul className="space-y-2">
        {initial.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.title}</span>
              {r.shortcut && (
                <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">
                  /{r.shortcut}
                </span>
              )}
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(r.id);
                    setForm({ title: r.title, body: r.body, shortcut: r.shortcut ?? '' });
                  }}
                  className="rounded-md px-2.5 py-1 text-xs ring-1 ring-line"
                >
                  แก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => void remove(r.id)}
                  className="rounded-md px-2.5 py-1 text-xs text-danger ring-1 ring-danger"
                >
                  ลบ
                </button>
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>
          </li>
        ))}
        {initial.length === 0 && (
          <li className="py-10 text-center text-sm text-muted">
            ยังไม่มีคำตอบมาตรฐาน — เพิ่มรายการแรกด้านบน
          </li>
        )}
      </ul>
    </div>
  );
}
