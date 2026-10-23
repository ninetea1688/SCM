'use client';

/** Workflow actions per status (APPR-01/02, PUB-01). The server re-checks every rule. */
import { allowedEvents, formatThaiDateTime } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlatformBadge, StatusBadge } from '@/components/badges';
import { bff, describeError } from '@/lib/client';
import type { VariantView } from './page';

type Action =
  | 'submit'
  | 'approve'
  | 'request-changes'
  | 'reject'
  | 'reopen'
  | 'schedule'
  | 'unschedule'
  | 'cancel'
  | 'revise'
  | 'develop';

const LABEL: Record<Action, string> = {
  develop: 'เริ่มเขียน',
  submit: 'ส่งตรวจ',
  approve: 'อนุมัติ',
  'request-changes': 'ส่งกลับแก้ไข',
  reject: 'ปฏิเสธ',
  reopen: 'เปิดแก้ใหม่',
  schedule: 'ตั้งเวลาโพสต์',
  unschedule: 'ยกเลิกเวลา',
  cancel: 'ยกเลิกโพสต์',
  revise: 'แก้ไขใหม่',
};

const EVENT_TO_ACTION: Record<string, Action> = {
  develop: 'develop',
  submit: 'submit',
  approve: 'approve',
  request_changes: 'request-changes',
  reject: 'reject',
  reopen: 'reopen',
  schedule: 'schedule',
  unschedule: 'unschedule',
  cancel: 'cancel',
  revise: 'revise',
};

function defaultSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function VariantCard({ variant: v }: { variant: VariantView }) {
  const router = useRouter();
  const [caption, setCaption] = useState(v.caption);
  const [when, setWhen] = useState(defaultSlot);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const actions = allowedEvents(v.status)
    .map((e) => EVENT_TO_ACTION[e])
    .filter((a): a is Action => !!a);
  const dirty = caption !== v.caption;
  const editable = !['publishing', 'retrying', 'published', 'cancelled'].includes(v.status);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const act = (a: Action) =>
    run(() =>
      bff(
        `/variants/${v.id}/${a}`,
        'POST',
        a === 'schedule'
          ? { scheduledAt: new Date(when).toISOString() }
          : a === 'request-changes' || a === 'reject' || a === 'approve'
            ? { comment: comment || undefined }
            : undefined,
      ),
    );

  return (
    <article className="space-y-3 rounded-xl border border-line bg-surface p-5">
      <header className="flex flex-wrap items-center gap-3">
        <PlatformBadge platform={v.platform} />
        <StatusBadge status={v.status} />
        <span className="text-xs text-muted">เวอร์ชัน {v.version}</span>
        {v.scheduledAt && (
          <span className="ml-auto text-sm">{formatThaiDateTime(new Date(v.scheduledAt))}</span>
        )}
      </header>

      <textarea
        rows={5}
        aria-label="ข้อความ"
        value={caption}
        disabled={!editable || busy}
        onChange={(e) => setCaption(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 disabled:opacity-70"
      />
      {dirty && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => bff(`/variants/${v.id}`, 'PATCH', { caption }))}
            className="rounded-md bg-ink px-3 py-1.5 text-surface"
          >
            บันทึกการแก้ไข
          </button>
          {v.approvedVersion !== null && <span className="text-warn">การแก้ไขจะทำให้ต้องอนุมัติใหม่</span>}
        </div>
      )}

      {v.issues.length > 0 && (
        <ul
          className="space-y-1 rounded-lg bg-danger/5 p-3 text-sm text-danger"
          aria-label="ปัญหาที่ต้องแก้"
        >
          {v.issues.map((i) => (
            <li key={i.code}>{i.messageTh}</li>
          ))}
        </ul>
      )}

      {v.permalink && (
        <a
          href={v.permalink}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-brand underline"
        >
          ดูโพสต์บนแพลตฟอร์ม
        </a>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          {v.status === 'in_review' && (
            <input
              placeholder="ความเห็น (จำเป็นเมื่อส่งกลับหรือปฏิเสธ)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="min-w-64 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
            />
          )}
          {actions.includes('schedule') && (
            <input
              type="datetime-local"
              aria-label="วันเวลาที่จะโพสต์"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
            />
          )}
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy || dirty}
              onClick={() => act(a)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                a === 'approve' || a === 'schedule' || a === 'submit'
                  ? 'bg-brand text-brand-ink'
                  : a === 'reject' || a === 'cancel'
                    ? 'text-danger ring-1 ring-danger'
                    : 'ring-1 ring-line'
              }`}
            >
              {LABEL[a]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </article>
  );
}
