'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function TotpSetup() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    try {
      const r = await bff<{ secret: string }>('/auth/2fa/setup', 'POST');
      setSecret(r.secret);
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function confirm() {
    try {
      // Enabling rotates the session to an MFA-verified one; sign in again to pick it up.
      await bff('/auth/2fa/enable', 'POST', { code });
      await fetch('/session/logout', { method: 'POST' });
      router.push('/login');
    } catch (e) {
      setError(describeError(e));
    }
  }

  if (!secret) {
    return (
      <button
        type="button"
        onClick={begin}
        className="rounded-lg bg-brand px-4 py-2 text-brand-ink"
      >
        เริ่มตั้งค่า
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">เพิ่มบัญชีในแอปด้วยรหัสนี้ แล้วกรอกรหัส 6 หลักที่แอปแสดง</p>
      <code className="block rounded-md bg-bg p-3 text-center tracking-widest">{secret}</code>
      <input
        inputMode="numeric"
        pattern="[0-9]{6}"
        aria-label="รหัส 6 หลัก"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 tracking-widest"
      />
      <button
        type="button"
        onClick={confirm}
        className="rounded-lg bg-brand px-4 py-2 text-brand-ink"
      >
        ยืนยัน
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
