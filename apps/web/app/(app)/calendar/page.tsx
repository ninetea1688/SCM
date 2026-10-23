/**
 * CAL-01/02/03 (P1): month view in Asia/Bangkok with Buddhist-Era labels, platform colours,
 * status badges and an unscheduled backlog. Drag-and-drop rescheduling is next (STATUS.md).
 */
import type { Platform, VariantStatus } from '@scm/domain';
import Link from 'next/link';
import { PlatformDot, StatusBadge } from '@/components/badges';
import { load } from '@/lib/load';

interface CalItem {
  id: string;
  postId: string;
  title: string;
  platform: Platform;
  status: VariantStatus;
  scheduledAt: string;
}
interface BacklogItem {
  id: string;
  postId: string;
  title: string;
  platform: Platform;
  status: VariantStatus;
}

const BKK_OFFSET_MS = 7 * 3600_000; // Asia/Bangkok has no DST.
const WEEKDAYS = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  month: 'long',
  year: 'numeric',
});
const dayLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
});
const timeLabel = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function parseMonth(m: string | undefined): { y: number; mo: number } {
  const match = m?.match(/^(\d{4})-(\d{2})$/);
  if (match) return { y: Number(match[1]), mo: Number(match[2]) };
  const now = new Date(Date.now() + BKK_OFFSET_MS);
  return { y: now.getUTCFullYear(), mo: now.getUTCMonth() + 1 };
}

const bkkMidnight = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d) - BKK_OFFSET_MS);
/** Stable keys for the empty cells that pad the first and last week. */
const padKeys = (side: string, n: number) => Array.from({ length: n }, (_, i) => `${side}-${i}`);
const fmt = (y: number, mo: number) => `${y}-${String(mo).padStart(2, '0')}`;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const { y, mo } = parseMonth(m);
  const from = bkkMidnight(y, mo, 1);
  const to = bkkMidnight(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1, 1);
  const here = `/calendar?m=${fmt(y, mo)}`;

  const [items, backlog] = await Promise.all([
    load<CalItem[]>(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}`, here),
    load<BacklogItem[]>('/backlog', here),
  ]);

  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const byDay = new Map<number, CalItem[]>();
  for (const it of items) {
    const local = new Date(new Date(it.scheduledAt).getTime() + BKK_OFFSET_MS);
    const d = local.getUTCDate();
    byDay.set(d, [...(byDay.get(d) ?? []), it]);
  }
  const prev = mo === 1 ? fmt(y - 1, 12) : fmt(y, mo - 1);
  const next = mo === 12 ? fmt(y + 1, 1) : fmt(y, mo + 1);
  const todayLocal = new Date(Date.now() + BKK_OFFSET_MS);
  const isThisMonth = todayLocal.getUTCFullYear() === y && todayLocal.getUTCMonth() + 1 === mo;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section aria-labelledby="cal-title">
        <div className="mb-4 flex items-center gap-3">
          <h1 id="cal-title" className="text-xl font-semibold">
            {monthLabel.format(new Date(Date.UTC(y, mo - 1, 15)))}
            <span className="ml-2 text-sm font-normal text-muted">({y})</span>
          </h1>
          <div className="ml-auto flex gap-1 whitespace-nowrap text-sm">
            <Link
              href={`/calendar?m=${prev}`}
              className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
            >
              ก่อนหน้า
            </Link>
            <Link
              href="/calendar"
              className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
            >
              เดือนนี้
            </Link>
            <Link
              href={`/calendar?m=${next}`}
              className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
            >
              ถัดไป
            </Link>
          </div>
        </div>
        <ol className="space-y-2 md:hidden" aria-label="รายการโพสต์ของเดือน">
          {[...byDay.entries()]
            .sort(([a], [b]) => a - b)
            .map(([d, dayItems]) => (
              <li key={d} className="rounded-xl border border-line bg-surface p-3">
                <p className="mb-2 text-sm font-medium">
                  {dayLabel.format(new Date(Date.UTC(y, mo - 1, d, 5)))}
                </p>
                <ul className="space-y-2">
                  {dayItems.map((it) => (
                    <li key={it.id}>
                      <Link
                        href={`/posts/${it.postId}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <PlatformDot platform={it.platform} />
                        <span className="text-muted">
                          {timeLabel.format(new Date(it.scheduledAt))}
                        </span>
                        <span className="line-clamp-1 flex-1">{it.title}</span>
                        <StatusBadge status={it.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          {byDay.size === 0 && <li className="text-sm text-muted">ยังไม่มีโพสต์ที่ตั้งเวลาในเดือนนี้</li>}
        </ol>
        <div className="hidden grid-cols-7 overflow-hidden rounded-xl border border-line bg-line text-sm [gap:1px] md:grid">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="bg-surface px-2 py-1.5 text-center text-xs font-medium text-muted"
            >
              {w}
            </div>
          ))}
          {padKeys('lead', firstWeekday).map((k) => (
            <div key={k} className="min-h-28 bg-bg" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const isToday = isThisMonth && todayLocal.getUTCDate() === d;
            const dayItems = byDay.get(d) ?? [];
            return (
              <div key={d} className="min-h-28 space-y-1 bg-surface p-1.5">
                <div
                  className={`text-xs ${isToday ? 'inline-grid size-6 place-items-center rounded-full bg-brand text-brand-ink' : 'text-muted'}`}
                >
                  {d}
                </div>
                {dayItems.map((it) => (
                  <Link
                    key={it.id}
                    href={`/posts/${it.postId}`}
                    className="block rounded-md border border-line px-1.5 py-1 hover:border-brand"
                  >
                    <span className="flex items-center gap-1.5">
                      <PlatformDot platform={it.platform} />
                      <span className="text-xs text-muted">
                        {timeLabel.format(new Date(it.scheduledAt))}
                      </span>
                    </span>
                    <span className="line-clamp-1 text-xs">{it.title}</span>
                    <StatusBadge status={it.status} />
                  </Link>
                ))}
              </div>
            );
          })}
          {padKeys('tail', (7 - ((firstWeekday + daysInMonth) % 7)) % 7).map((k) => (
            <div key={k} className="min-h-28 bg-bg" />
          ))}
        </div>
      </section>

      <aside aria-labelledby="backlog-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="backlog-title" className="font-semibold">
            งานที่ยังไม่ได้ตั้งเวลา
          </h2>
          <Link
            href="/posts/new"
            className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-ink shadow-sm transition-colors hover:bg-brand-deep"
          >
            สร้างโพสต์
          </Link>
        </div>
        {backlog.length === 0 && <p className="text-sm text-muted">ไม่มีงานค้าง</p>}
        <ul className="space-y-2">
          {backlog.map((b) => (
            <li key={b.id}>
              <Link
                href={`/posts/${b.postId}`}
                className="block rounded-lg border border-line bg-surface p-3 hover:border-brand"
              >
                <span className="flex items-center gap-2">
                  <PlatformDot platform={b.platform} />
                  <span className="line-clamp-1 text-sm font-medium">{b.title}</span>
                </span>
                <span className="mt-1.5 block">
                  <StatusBadge status={b.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
