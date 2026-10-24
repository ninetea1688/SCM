'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

const field = 'w-full rounded-md border border-line bg-surface px-3 py-1.5 text-sm';

interface Moderation {
  forbiddenWords?: string[];
  borderlineWords?: string[];
  watchAccounts?: string[];
}

export function ModerationEditor({ initial }: { initial: Moderation }) {
  const router = useRouter();
  const canEdit = true; // rendered only for owner/admin; the API re-checks
  const [form, setForm] = useState({
    forbiddenWords: (initial.forbiddenWords ?? []).join(', '),
    borderlineWords: (initial.borderlineWords ?? []).join(', '),
    watchAccounts: (initial.watchAccounts ?? []).join(', '),
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const split = (v: string) =>
        v
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean);
      await bff('/workspaces/current/settings', 'PATCH', {
        moderation: {
          forbiddenWords: split(form.forbiddenWords),
          borderlineWords: split(form.borderlineWords),
          watchAccounts: split(form.watchAccounts),
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
        <span className="text-xs text-muted">คำต้องห้าม (ซ่อนอัตโนมัติ) — คั่นด้วยจุลภาค</span>
        <textarea
          rows={2}
          disabled={!canEdit || busy}
          value={form.forbiddenWords}
          onChange={(e) => setForm({ ...form, forbiddenWords: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">คำก้ำกึ่ง (เข้าคิวให้คนตัดสิน — MOD-03)</span>
        <textarea
          rows={2}
          disabled={!canEdit || busy}
          value={form.borderlineWords}
          onChange={(e) => setForm({ ...form, borderlineWords: e.target.value })}
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted">บัญชีที่ต้องเฝ้าระวัง (คอมเมนต์เข้าคิวตรวจ)</span>
        <input
          disabled={!canEdit || busy}
          value={form.watchAccounts}
          onChange={(e) => setForm({ ...form, watchAccounts: e.target.value })}
          className={field}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
      >
        {busy ? 'กำลังบันทึก…' : saved ? 'บันทึกแล้ว ✓' : 'บันทึกการตั้งค่า'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

interface Pref {
  type: string;
  channel: string;
  enabled: boolean;
}

const TYPE_TH: Record<string, string> = {
  publish_failed: 'โพสต์ล้มเหลว',
  account_disconnected: 'บัญชีหลุดการเชื่อมต่อ',
  approval_requested: 'งานรออนุมัติ',
  token_expiring: 'โทเคนใกล้หมดอายุ',
  system_alert: 'ความผิดปกติของระบบ',
};

const CHANNEL_TH: Record<string, string> = {
  in_app: 'ในระบบ',
  email: 'อีเมล',
};

export function NotificationPrefsEditor() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bff<Pref[]>('/notifications/prefs')
      .then(setPrefs)
      .catch((e) => setError(describeError(e)));
  }, []);

  async function toggle(pref: Pref) {
    setBusy(true);
    setError(null);
    try {
      await bff('/notifications/prefs', 'PUT', {
        prefs: [{ type: pref.type, channel: pref.channel, enabled: !pref.enabled }],
      });
      setPrefs((ps) =>
        ps.map((p) =>
          p.type === pref.type && p.channel === pref.channel ? { ...p, enabled: !p.enabled } : p,
        ),
      );
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (prefs.length === 0) return <p className="text-sm text-muted">กำลังโหลด…</p>;

  const types = [...new Set(prefs.map((p) => p.type))];
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-muted">
          <tr>
            <th className="py-2">ประเภท</th>
            <th>ในระบบ</th>
            <th>อีเมล</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type} className="border-b border-line last:border-0">
              <td className="py-2">{TYPE_TH[type] ?? type}</td>
              {['in_app', 'email'].map((channel) => {
                const p = prefs.find((x) => x.type === type && x.channel === channel)!;
                return (
                  <td key={channel}>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        disabled={busy}
                        onChange={() => void toggle(p)}
                      />
                      {CHANNEL_TH[channel]}
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
