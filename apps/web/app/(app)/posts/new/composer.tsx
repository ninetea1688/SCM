'use client';

/** POST-01: one source post split into per-account variants, each editable separately. */
import type { Platform } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlatformBadge } from '@/components/badges';
import { bff, describeError } from '@/lib/client';

export interface AccountOption {
  id: string;
  name: string;
  platform: Platform;
}

export function Composer({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selected, setSelected] = useState<Record<string, { caption: string; custom: boolean }>>(
    {},
  );
  const [ytTitle, setYtTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = { caption: '', custom: false };
      return next;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const post = await bff<{ id: string }>('/posts', 'POST', {
        title,
        body,
        variants: Object.entries(selected).map(([socialAccountId, v]) => {
          const acc = accounts.find((a) => a.id === socialAccountId);
          return {
            socialAccountId,
            caption: v.custom ? v.caption : body,
            ...(acc?.platform === 'youtube' ? { options: { ytTitle } } : {}),
          };
        }),
      });
      router.push(`/posts/${post.id}`);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface p-6 text-sm">
        ยังไม่มีบัญชีโซเชียลที่เชื่อมต่อ ไปที่หน้า{' '}
        <a className="underline" href="/accounts">
          บัญชีโซเชียล
        </a>{' '}
        ก่อน
      </p>
    );
  }

  const chosen = Object.keys(selected);
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">หัวข้อ (ใช้ภายใน)</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">ข้อความต้นฉบับ</span>
        <textarea
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2"
        />
        <span className="text-xs text-muted">{body.length.toLocaleString('th-TH')} ตัวอักษร</span>
      </label>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">โพสต์ไปที่</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {accounts.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface p-3 has-[:checked]:border-brand"
            >
              <input type="checkbox" checked={!!selected[a.id]} onChange={() => toggle(a.id)} />
              <span>
                <PlatformBadge platform={a.platform} />
                <span className="block text-sm text-muted">{a.name}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {chosen.map((id) => {
        const acc = accounts.find((a) => a.id === id)!;
        const v = selected[id]!;
        return (
          <section key={id} className="space-y-2 rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <PlatformBadge platform={acc.platform} />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.custom}
                  onChange={(e) =>
                    setSelected((s) => ({
                      ...s,
                      [id]: { caption: v.caption || body, custom: e.target.checked },
                    }))
                  }
                />
                แก้ข้อความเฉพาะช่องทางนี้
              </label>
            </div>
            {v.custom && (
              <textarea
                rows={4}
                aria-label={`ข้อความสำหรับ ${acc.name}`}
                value={v.caption}
                onChange={(e) =>
                  setSelected((s) => ({ ...s, [id]: { ...v, caption: e.target.value } }))
                }
                className="w-full rounded-lg border border-line bg-surface px-3 py-2"
              />
            )}
            {acc.platform === 'youtube' && (
              <input
                placeholder="ชื่อวิดีโอ YouTube"
                value={ytTitle}
                onChange={(e) => setYtTitle(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2"
              />
            )}
          </section>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || chosen.length === 0 || !title}
        className="rounded-lg bg-brand px-5 py-2 font-medium text-brand-ink disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : 'บันทึกเป็นร่าง'}
      </button>
    </form>
  );
}
