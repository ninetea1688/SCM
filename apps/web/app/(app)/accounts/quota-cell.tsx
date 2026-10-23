'use client';

import { useRouter } from 'next/navigation';
/**
 * CONN-06/07: per-row live quota (fetched lazily so the table renders instantly)
 * and a Reconnect button for disconnected accounts — sandbox accounts re-upsert
 * in one click; live accounts jump to the connect panel below.
 */
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface Quota {
  kind: string;
  used: number;
  limit: number;
}

const QUOTA_KIND_TH: Record<string, string> = {
  ig_posts_24h: 'โพสต์ 24 ชม.',
  line_messages_month: 'ข้อความ/เดือน',
};

export function QuotaCell({ id, disabled }: { id: string; disabled: boolean }) {
  const [quota, setQuota] = useState<Quota[] | null>(null);

  useEffect(() => {
    let alive = true;
    if (disabled) return;
    bff<Quota[]>(`/accounts/${id}/quota`)
      .then((q) => alive && setQuota(q))
      .catch(() => alive && setQuota([]));
    return () => {
      alive = false;
    };
  }, [id, disabled]);

  if (disabled) return <span className="text-muted">—</span>;
  if (!quota) return <span className="text-muted">กำลังโหลด…</span>;
  if (quota.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="space-y-0.5">
      {quota.map((q) => {
        const ratio = q.limit > 0 ? q.used / q.limit : 0;
        const cls = ratio >= 0.9 ? 'text-danger' : ratio >= 0.8 ? 'text-warn' : 'text-ok';
        return (
          <span key={q.kind} className={`block whitespace-nowrap font-medium ${cls}`}>
            {q.used}/{q.limit} {QUOTA_KIND_TH[q.kind] ?? q.kind}
          </span>
        );
      })}
    </span>
  );
}

export function ReconnectButton({
  platform,
  name,
  sandbox,
}: {
  platform: string;
  name: string;
  sandbox: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reconnect() {
    setError(null);
    setBusy(true);
    try {
      if (sandbox) {
        // Sandbox accounts re-upsert to active in one call (dev/fake mode only).
        await bff('/accounts/sandbox', 'POST', { platform, name });
        router.refresh();
      } else {
        // Live accounts need the owner to run the platform connect flow again.
        document.querySelector('#connect')?.scrollIntoView({ behavior: 'smooth' });
      }
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
        onClick={reconnect}
        disabled={busy}
        className="rounded-full border border-brand px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand hover:text-brand-ink disabled:opacity-60"
      >
        เชื่อมต่อใหม่
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
