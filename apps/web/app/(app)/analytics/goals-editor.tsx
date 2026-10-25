'use client';

/** ANA-06: KPI goal editor (owner/admin) for the analytics dashboard. */
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface Goal {
  metric: string;
  platform: string;
  target: number;
}

const METRICS = [
  { value: 'reach', label: 'ผู้เข้าถึงรวม' },
  { value: 'engagement_rate', label: 'อัตรามีส่วนร่วม (%)' },
  { value: 'posts', label: 'จำนวนโพสต์' },
  { value: 'conversations', label: 'จำนวนบทสนทนา' },
];

const field = 'rounded-md border border-line bg-surface px-2 py-1 text-sm';

export function GoalsEditor({ role = 'viewer' }: { role?: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bff<Goal[]>('/analytics/goals')
      .then(setGoals)
      .catch((e) => setError(describeError(e)));
  }, []);

  const canEdit = role === 'owner' || role === 'admin';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await bff<Goal[]>('/analytics/goals', 'PUT', { goals });
      setGoals(updated);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  function update(i: number, patch: Partial<Goal>) {
    setGoals((gs) => gs.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1">ตัวชี้วัด</th>
            <th>ช่องทาง</th>
            <th>เป้าหมาย</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((m) => {
            const existing = goals.find((g) => g.metric === m.value && g.platform === 'all');
            const idx = goals.findIndex((g) => g === existing);
            const target = existing?.target ?? 0;
            return (
              <tr key={m.value} className="border-b border-line last:border-0">
                <td className="py-1.5">{m.label}</td>
                <td className="text-xs text-muted">ทุกช่องทาง</td>
                <td>
                  {canEdit ? (
                    <input
                      type="number"
                      min={0}
                      aria-label={`เป้าหมาย${m.label}`}
                      value={existing ? target : ''}
                      placeholder="—"
                      onChange={(e) => {
                        const v = e.target.value === '' ? 0 : Number(e.target.value);
                        if (existing) update(idx, { target: v });
                        else
                          setGoals((gs) => [
                            ...gs,
                            { metric: m.value, platform: 'all', target: v },
                          ]);
                      }}
                      className={`${field} w-28 text-right`}
                    />
                  ) : (
                    <span className="text-right">{target.toLocaleString('th-TH')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50"
        >
          {busy ? 'กำลังบันทึก…' : 'บันทึกเป้าหมาย'}
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
