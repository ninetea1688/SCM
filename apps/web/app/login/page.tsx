'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describeError } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch('/session/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: f.get('email'),
        password: f.get('password'),
        ...(f.get('totp') ? { totp: f.get('totp') } : {}),
      }),
    });
    setBusy(false);
    if (res.ok) return router.push('/calendar');
    const body = await res.json().catch(() => ({}));
    if (body.code === 'mfa_required') setNeedsTotp(true);
    setError(describeError(body));
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">เข้าสู่ระบบ SCM</h1>
          <p className="mt-1 text-sm text-muted">ศูนย์บริหารคอนเทนต์และการสื่อสารออนไลน์</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">อีเมล</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">รหัสผ่าน</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
          />
        </label>
        {needsTotp && (
          <label className="block space-y-1">
            <span className="text-sm font-medium">รหัสยืนยันตัวตน 6 หลัก</span>
            <input
              name="totp"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 tracking-widest"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand px-4 py-2 font-medium text-brand-ink disabled:opacity-60"
        >
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}
