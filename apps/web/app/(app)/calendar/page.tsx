/**
 * CAL-01/02/03/05 (P1): month/week/day/list views, Bangkok time with พ.ศ. labels,
 * Thai government holidays, drag-and-drop rescheduling (board.tsx) and per-day
 * quota hints when a platform nears its 24h cap.
 */
import {
  DAILY_PUBLISH_LIMITS,
  DEFAULT_QUOTA_WARN_RATIO,
  type Platform,
  thaiHolidays,
  type VariantStatus,
} from '@scm/domain';
import Link from 'next/link';
import { PlatformDot, StatusBadge } from '@/components/badges';
import { load } from '@/lib/load';
import { Board, type BoardDay, type BoardItem } from './board';

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
type View = 'month' | 'week' | 'day' | 'list';
const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'เดือน' },
  { value: 'week', label: 'สัปดาห์' },
  { value: 'day', label: 'วัน' },
  { value: 'list', label: 'รายการ' },
];

const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  month: 'long',
  year: 'numeric',
});
const rangeLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dayLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const timeLabel = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const bkkDate = (utcMs: number) => new Date(utcMs + BKK_OFFSET_MS); // read with getUTC*
const bkkMidnight = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d) - BKK_OFFSET_MS);
const dayKeyOf = (iso: string) => {
  const d = bkkDate(new Date(iso).getTime());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return bkkDate(Date.UTC(y!, m! - 1, d!) + n * 86400_000)
    .toISOString()
    .slice(0, 10);
};

function parseAnchor(q: { view?: string; d?: string }): { view: View; d: string } {
  const view = (VIEWS.some((v) => v.value === q.view) ? q.view : 'month') as View;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.d ?? '') ? q.d! : new Date().toISOString().slice(0, 10);
  return { view, d };
}

/** CAL-05: warn chip when a day holds ≥ warnRatio of a platform's 24h cap. */
function quotaWarnFor(items: BoardItem[]): BoardDay['quotaWarn'] {
  const byPlatform = new Map<Platform, number>();
  for (const it of items) byPlatform.set(it.platform, (byPlatform.get(it.platform) ?? 0) + 1);
  for (const [platform, used] of byPlatform) {
    const limit = DAILY_PUBLISH_LIMITS[`${platform}:any`];
    if (limit && used >= limit * DEFAULT_QUOTA_WARN_RATIO) return { platform, used, limit };
  }
  return undefined;
}

function boardDays(keys: string[], byDay: Map<string, BoardItem[]>, todayKey: string): BoardDay[] {
  return keys.map((key) => {
    const [y, m, d] = key.split('-').map(Number);
    const holiday = thaiHolidays(y!).get(
      `${String(m!).padStart(2, '0')}-${String(d!).padStart(2, '0')}`,
    );
    const items = byDay.get(key) ?? [];
    return {
      key,
      dayNum: d!,
      isToday: key === todayKey,
      holidayName: holiday?.nameTh,
      isDayOff: holiday !== undefined && holiday.kind !== 'observance',
      items,
      quotaWarn: quotaWarnFor(items),
    };
  });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; d?: string }>;
}) {
  const q = await searchParams;
  const { view, d } = parseAnchor(q);

  // Visible range (BKK midnights, exclusive `to`).
  const [y, mo, dd] = d.split('-').map(Number);
  let from: Date;
  let to: Date;
  if (view === 'month') {
    from = bkkMidnight(y!, mo!, 1);
    to = mo === 12 ? bkkMidnight(y! + 1, 1, 1) : bkkMidnight(y!, mo! + 1, 1);
  } else if (view === 'week') {
    const monday = bkkDate(
      Date.UTC(y!, mo! - 1, dd!) -
        ((new Date(Date.UTC(y!, mo! - 1, dd!)).getUTCDay() + 6) % 7) * 86400_000,
    );
    from = new Date(monday.getTime() - BKK_OFFSET_MS);
    to = new Date(from.getTime() + 7 * 86400_000);
  } else if (view === 'day') {
    from = bkkMidnight(y!, mo!, dd!);
    to = new Date(from.getTime() + 86400_000);
  } else {
    from = bkkMidnight(y!, mo!, dd!);
    to = new Date(from.getTime() + 31 * 86400_000);
  }

  const here = `/calendar?view=${view}&d=${d}`;
  const [items, backlog] = await Promise.all([
    load<CalItem[]>(`/calendar?from=${from.toISOString()}&to=${to.toISOString()}`, here),
    load<BacklogItem[]>('/backlog', here),
  ]);

  const byDay = new Map<string, BoardItem[]>();
  for (const it of items) {
    const k = dayKeyOf(it.scheduledAt);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const todayKey = new Date().toISOString().slice(0, 10);

  // Grid keys for the board (month pads to whole weeks, Monday-first).
  let gridKeys: string[] = [];
  if (view === 'month') {
    const first = new Date(Date.UTC(y!, mo! - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y!, mo!, 0)).getUTCDate();
    const start = addDays(`${y}-${String(mo!).padStart(2, '0')}-01`, -lead);
    gridKeys = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) =>
      addDays(start, i),
    );
  } else if (view === 'week') {
    gridKeys = Array.from({ length: 7 }, (_, i) => addDays(from.toISOString().slice(0, 10), i));
  }

  // Step the anchor for prev/next per view.
  const step = view === 'month' ? 0 : view === 'week' ? 7 : 1;
  const monthStep = (n: number) => {
    const dt = new Date(Date.UTC(y!, mo! - 1 + n, 1));
    return `/calendar?view=month&d=${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
  };
  const shift = (n: number) => `/calendar?view=${view}&d=${addDays(d, n)}`;

  const title =
    view === 'month'
      ? monthLabel.format(new Date(Date.UTC(y!, mo! - 1, 15)))
      : view === 'week'
        ? `${rangeLabel.format(from)} – ${rangeLabel.format(new Date(to.getTime() - 86400_000))}`
        : view === 'day'
          ? dayLabel.format(from)
          : 'กำหนดการถัดไป 31 วัน';
  const christianYear = view === 'month' ? `(${y})` : '';

  const agenda = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      <section aria-labelledby="cal-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 id="cal-title" className="text-xl font-semibold">
            {title} <span className="text-sm font-normal text-muted">{christianYear}</span>
          </h1>
          <nav aria-label="เปลี่ยนช่วงเวลา" className="ml-auto flex gap-1 text-sm">
            {view !== 'list' && (
              <>
                <Link
                  href={view === 'month' ? monthStep(-1) : shift(-step)}
                  className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
                >
                  ก่อนหน้า
                </Link>
                <Link
                  href={`/calendar?view=${view}`}
                  className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
                >
                  วันนี้
                </Link>
                <Link
                  href={view === 'month' ? monthStep(1) : shift(step)}
                  className="rounded-full border border-line px-3.5 py-1.5 text-muted transition-colors hover:border-brand hover:text-brand"
                >
                  ถัดไป
                </Link>
              </>
            )}
          </nav>
        </div>
        <nav aria-label="มุมมอง" className="mb-4 flex gap-1 border-b border-line text-sm">
          {VIEWS.map((v) => (
            <Link
              key={v.value}
              href={`/calendar?view=${v.value}&d=${d}`}
              aria-current={view === v.value ? 'page' : undefined}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-ink"
            >
              {v.label}
            </Link>
          ))}
        </nav>

        {view === 'list' ? (
          <ol className="space-y-2">
            {agenda.map(([k, dayItems]) => {
              const [ly, lm, ld] = k.split('-').map(Number);
              const holiday = thaiHolidays(ly!).get(
                `${String(lm!).padStart(2, '0')}-${String(ld!).padStart(2, '0')}`,
              );
              return (
                <li key={k} className="rounded-xl border border-line bg-surface p-3">
                  <p className="mb-1 text-sm font-medium">
                    {dayLabel.format(bkkMidnight(ly!, lm!, ld!))}
                    {holiday && (
                      <span
                        className={
                          holiday.kind === 'observance'
                            ? 'ml-2 text-xs text-muted'
                            : 'ml-2 text-xs text-danger'
                        }
                      >
                        {holiday.nameTh}
                      </span>
                    )}
                  </p>
                  <ul className="space-y-1.5">
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
              );
            })}
            {agenda.length === 0 && <li className="text-sm text-muted">ยังไม่มีกำหนดการในช่วงนี้</li>}
          </ol>
        ) : view === 'day' ? (
          <ol className="space-y-2">
            {(byDay.get(d) ?? []).map((it) => (
              <li key={it.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
                <Link href={`/posts/${it.postId}`} className="flex items-center gap-2 text-sm">
                  <PlatformDot platform={it.platform} />
                  <span className="font-medium">{timeLabel.format(new Date(it.scheduledAt))}</span>
                  <span className="line-clamp-1 flex-1">{it.title}</span>
                  <StatusBadge status={it.status} />
                </Link>
              </li>
            ))}
            {(byDay.get(d) ?? []).length === 0 && (
              <li className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">
                ไม่มีโพสต์ในวันนี้
              </li>
            )}
          </ol>
        ) : (
          <>
            {/* Mobile agenda (NFR-07): the drag board is desktop-only. */}
            <ol className="space-y-2 md:hidden" aria-label="รายการโพสต์">
              {agenda.map(([k, dayItems]) => {
                const [ly, lm, ld] = k.split('-').map(Number);
                return (
                  <li key={k} className="rounded-xl border border-line bg-surface p-3">
                    <p className="mb-2 text-sm font-medium">
                      {dayLabel.format(bkkMidnight(ly!, lm!, ld!))}
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
                );
              })}
              {agenda.length === 0 && (
                <li className="text-sm text-muted">ยังไม่มีโพสต์ที่ตั้งเวลาในช่วงนี้</li>
              )}
            </ol>
            <div className="hidden md:block">
              <Board days={boardDays(gridKeys, byDay, todayKey)} week={view === 'week'} />
            </div>
          </>
        )}
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
                className="block rounded-lg border border-line bg-surface p-3 transition-colors hover:border-brand"
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
