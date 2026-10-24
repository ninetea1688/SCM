'use client';

/**
 * CAL-01: month/week board with drag-and-drop rescheduling, Thai holidays
 * (CAL-03) and per-platform quota hints (CAL-05). Dropping a chip on another
 * day keeps its Bangkok wall-clock time and calls POST /variants/:id/reschedule.
 */
import type { Platform, VariantStatus } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlatformDot, StatusBadge } from '@/components/badges';
import { bff, describeError } from '@/lib/client';

export interface BoardItem {
  id: string;
  postId: string;
  title: string;
  platform: Platform;
  status: VariantStatus;
  scheduledAt: string;
}

export interface BoardDay {
  /** 'YYYY-MM-DD' in Asia/Bangkok. */
  key: string;
  dayNum: number;
  isToday: boolean;
  holidayName?: string;
  isDayOff: boolean;
  /** CAL-06: the day falls in a mourning/significant range. */
  isMourning: boolean;
  items: BoardItem[];
  /** CAL-05: first platform at ≥80% of its daily cap on this day. */
  quotaWarn?: { platform: Platform; used: number; limit: number };
}

const BKK_OFFSET_MS = 7 * 3600_000;
const timeLabel = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/** Move an ISO instant to another Bangkok calendar day, keeping the time. */
function moveToDay(iso: string, dayKey: string): string {
  const bkk = new Date(new Date(iso).getTime() + BKK_OFFSET_MS);
  const [y, m, d] = dayKey.split('-').map(Number);
  const moved = new Date(
    Date.UTC(y!, m! - 1, d!, bkk.getUTCHours(), bkk.getUTCMinutes()) - BKK_OFFSET_MS,
  );
  return moved.toISOString();
}

export function Board({ days, week }: { days: BoardDay[]; week: boolean }) {
  const router = useRouter();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function drop(day: BoardDay) {
    setOverKey(null);
    const id = dragId;
    setDragId(null);
    if (!id || busy) return;
    const item = days.flatMap((d) => d.items).find((i) => i.id === id);
    if (!item) return;
    const next = moveToDay(item.scheduledAt, day.key);
    if (next === item.scheduledAt) return; // same day, nothing to do
    setBusy(true);
    setError(null);
    try {
      await bff(`/variants/${id}/reschedule`, 'POST', { scheduledAt: next });
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div
        className={`grid grid-cols-7 overflow-hidden rounded-xl border border-line bg-line text-sm [gap:1px] ${
          week ? '' : ''
        }`}
      >
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="bg-surface px-2 py-1.5 text-center text-xs font-medium text-muted"
          >
            {wd}
          </div>
        ))}
        {days.map((d) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only drop target; keyboard users reschedule on the post page.
          <div
            key={d.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverKey(d.key);
            }}
            onDragLeave={() => setOverKey((k) => (k === d.key ? null : k))}
            onDrop={() => void drop(d)}
            className={`relative min-h-24 space-y-1 p-1.5 transition-colors ${
              d.isDayOff ? 'bg-danger/5' : 'bg-surface'
            } ${overKey === d.key ? 'ring-2 ring-brand ring-inset' : ''} ${
              week ? 'min-h-[28rem]' : ''
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span
                className={`text-xs ${d.isToday ? 'inline-grid size-6 place-items-center rounded-full bg-brand text-brand-ink' : d.isDayOff ? 'text-danger' : 'text-muted'}`}
              >
                {d.dayNum}
              </span>
              {d.quotaWarn && (
                <span
                  title={`CAL-05: ${d.quotaWarn.used}/${d.quotaWarn.limit} โพสต์ในวันนี้`}
                  className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn"
                >
                  ใกล้โควตา {d.quotaWarn.used}/{d.quotaWarn.limit}
                </span>
              )}
            </div>
            {d.holidayName && (
              <p
                className={`line-clamp-1 text-[10px] ${d.isDayOff ? 'text-danger' : 'text-muted'}`}
                title={d.holidayName}
              >
                {d.holidayName}
              </p>
            )}
            {d.isMourning && (
              <span
                title="ช่วงไว้ทุกข์/เหตุการณ์สำคัญ (CAL-06) — โปรดพิจารณาความเหมาะสมของคอนเทนต์"
                className="absolute top-0.5 right-0.5 rounded bg-danger/15 px-1 text-[10px] text-danger"
              >
                ไว้ทุกข์
              </span>
            )}
            {d.items.length === 0 && !d.isDayOff && (
              <span
                title="CAL-04: ยังไม่มีคอนเทนต์ในวันนี้"
                className="mt-1 rounded border border-dashed border-line px-1 py-0.5 text-center text-[10px] text-muted/60"
              >
                ว่าง
              </span>
            )}
            {d.items.map((it) => (
              <a
                key={it.id}
                href={`/posts/${it.postId}`}
                draggable
                onDragStart={() => setDragId(it.id)}
                onDragEnd={() => setDragId(null)}
                className={`block cursor-grab rounded-md border border-line px-1.5 py-1 hover:border-brand active:cursor-grabbing ${
                  dragId === it.id ? 'opacity-40' : ''
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <PlatformDot platform={it.platform} />
                  <span className="text-xs text-muted">
                    {timeLabel.format(new Date(it.scheduledAt))}
                  </span>
                </span>
                <span className="line-clamp-1 text-xs">{it.title}</span>
                <StatusBadge status={it.status} />
              </a>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">ลากการ์ดไปวันอื่นเพื่อเลื่อนเวลาโพสต์ (เวลาในวันเดิมคงเดิม)</p>
    </div>
  );
}
