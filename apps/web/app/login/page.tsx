'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { describeError } from '@/lib/client';

const HIGHLIGHTS = [
  'วางแผน สร้าง และอนุมัติคอนเทนต์ในที่เดียว',
  'ตั้งเวลาโพสต์หลายช่องทางพร้อมกัน',
  'คลังสื่อกลางพร้อมแปลงไฟล์ให้พร้อมโพสต์',
];

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
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — น้ำเงิน สปสช. with a เขียว accent */}
      <section className="relative hidden flex-col justify-between bg-brand-hero p-10 text-white lg:flex">
        <div className="flex items-center gap-4">
          {/* biome-ignore lint/performance/noImgElement: static asset */}
          <img src="/nhso-icon.png" alt="ตราสัญลักษณ์ สปสช." className="size-16" />
          <div>
            <h1 className="text-2xl font-semibold">SCM ศูนย์บริหารคอนเทนต์</h1>
            <p className="mt-1 text-sm text-white/70">สำนักงานหลักประกันสุขภาพแห่งชาติ (สปสช.)</p>
          </div>
        </div>

        <div className="max-w-md space-y-4">
          <h2 className="text-3xl leading-snug font-semibold">
            บริหารคอนเทนต์ทุกช่องทาง
            <span className="mt-1 block text-brand-2">ขององค์กรในที่เดียว</span>
          </h2>
          <ul className="space-y-2.5 text-sm text-white/80">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full bg-brand-2/25 text-brand-2"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5">
                    <path
                      d="m5 13 4 4L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/50">Facebook · Instagram · TikTok · YouTube · LINE OA</p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* อัตลักษณ์องค์กร (master logo, white background) */}
          {/* biome-ignore lint/performance/noImgElement: static asset */}
          <img
            src="/nhso-master.jpg"
            alt="อัตลักษณ์สำนักงานหลักประกันสุขภาพแห่งชาติ"
            className="mx-auto mb-8 h-16 w-auto object-contain"
          />
          <form
            onSubmit={onSubmit}
            className="space-y-4 rounded-2xl border border-line bg-surface p-8 shadow-sm"
          >
            <div>
              <h2 className="text-lg font-semibold">เข้าสู่ระบบ</h2>
              <p className="mt-1 text-sm text-muted">ใช้บัญชีองค์กรของคุณ</p>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">อีเมล</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 focus:border-brand"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">รหัสผ่าน</span>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 focus:border-brand"
              />
            </label>
            {needsTotp && (
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">รหัสยืนยัน 6 หลัก</span>
                <input
                  name="totp"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 tracking-[0.4em] focus:border-brand"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand px-5 py-2.5 font-medium text-brand-ink shadow-sm transition-colors hover:bg-brand-deep disabled:opacity-60"
            >
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
          <p className="mt-6 text-center text-xs text-muted lg:hidden">
            ระบบบริหารคอนเทนต์ สำนักงานหลักประกันสุขภาพแห่งชาติ (สปสช.)
          </p>
        </div>
      </section>
    </main>
  );
}
