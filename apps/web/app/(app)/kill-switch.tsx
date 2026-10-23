'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { bff, describeError } from '@/lib/client';

/** PUB-10: one click to pause everything; release needs a second, explicit step. */
export function KillSwitchButton({ active }: { active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const msg = active
      ? 'ปิด Kill Switch แล้วปล่อยโพสต์ที่พักไว้ทั้งหมดต่อ?'
      : 'หยุดโพสต์ที่ตั้งเวลาไว้ทั้งหมดของ Workspace นี้ทันที?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await bff('/kill-switch', 'POST', { active: !active });
      if (active) await bff('/kill-switch/resume', 'POST', { variantIds: 'all' });
      router.refresh();
    } catch (e) {
      window.alert(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-surface text-danger ring-1 ring-danger' : 'bg-danger text-on-danger'
      } disabled:opacity-60`}
    >
      {active ? 'ปล่อยโพสต์ต่อ' : 'Kill Switch'}
    </button>
  );
}
