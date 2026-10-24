'use client';

/**
 * CONN-01/02 live connection forms: the Meta OAuth button (full consent-dialog round
 * trip) and the LINE channel-token form. Sandbox accounts are a separate dev helper.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

export function LineForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const r = await bff<{ webhookUrl: string }>('/accounts/line', 'POST', {
        channelAccessToken: token,
        channelSecret: secret,
      });
      setToken('');
      setSecret('');
      setWebhookUrl(r.webhookUrl);
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
        void connect();
      }}
    >
      <input
        required
        type="password"
        aria-label="Channel Access Token ของ LINE OA"
        placeholder="Channel Access Token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
      />
      <input
        required
        type="password"
        aria-label="Channel Secret ของ LINE OA"
        placeholder="Channel Secret"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy || !token || !secret}
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-50"
      >
        {busy ? 'กำลังเชื่อมต่อ…' : 'เชื่อมต่อ LINE OA'}
      </button>
      {webhookUrl && (
        <p className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok" role="status">
          เชื่อมต่อสำเร็จ — นำ URL นี้ไปตั้งค่า Webhook ใน LINE Developers Console:
          <code className="mt-1 block break-all text-xs text-ink">{webhookUrl}</code>
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
