'use client';

/** Members + policy controls for /settings (owner/admin; the policy toggle is owner-only). */
import { ROLE_LABEL_TH, ROLES, type Role } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function SelfApprovalToggle({ initial, canEdit }: { initial: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const next = !value;
      await bff('/workspaces/current/settings', 'PATCH', { allowSelfApproval: next });
      setValue(next);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value}
          disabled={!canEdit || busy}
          onChange={() => void toggle()}
        />
        ผู้เขียนอนุมัติงานของตัวเองได้ (Self-approval)
      </label>
      <p className="text-xs text-muted">
        {canEdit
          ? 'เหมาะกับทีมเล็กที่เขียนและตรวจเป็นคนเดียวกัน — ทุกการเปลี่ยนถูกบันทึกในบันทึกระบบ'
          : 'เฉพาะเจ้าของ (Owner) เท่านั้นที่เปลี่ยนค่านี้ได้'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function AddMemberForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await bff('/workspaces/current/members', 'PUT', { email, role });
      setEmail('');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="space-y-1 text-sm">
        <span className="block text-xs text-muted">อีเมลผู้ใช้ที่มีบัญชีในระบบแล้ว</span>
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-64 rounded-md border border-line bg-surface px-3 py-1.5"
        />
      </label>
      <label className="space-y-1 text-sm">
        <span className="block text-xs text-muted">บทบาท</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="rounded-md border border-line bg-surface px-3 py-1.5"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL_TH[r]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={busy || !email}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
      >
        {busy ? 'กำลังเพิ่ม…' : 'เพิ่ม/อัปเดตสมาชิก'}
      </button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

export function RevokeButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!window.confirm(`เพิกถอนการเข้าถึงของ ${email} ทันที? (เซสชันทั้งหมดจะถูกยกเลิก)`)) return;
    setBusy(true);
    setError(null);
    try {
      await bff(`/workspaces/current/members/${userId}?allSessions=true`, 'DELETE');
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void revoke()}
        className="rounded-md px-2 py-1 text-xs text-danger ring-1 ring-danger disabled:opacity-50"
      >
        {busy ? 'กำลังเพิกถอน…' : 'เพิกถอน'}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
