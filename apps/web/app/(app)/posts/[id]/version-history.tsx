'use client';

/** POST-06: version history + caption diff between any two versions. */
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface VersionRow {
  version: number;
  snapshot: { caption?: string; mediaIds?: string[] };
  editedBy: string;
  createdAt: string;
}

const thTime = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Word-level diff for one flat text — good enough for captions. */
function wordDiff(
  a: string,
  b: string,
): { pos: number; word: string; kind: 'same' | 'old' | 'new' }[] {
  const as = a.split(/(\s+)/);
  const bs = b.split(/(\s+)/);
  // LCS table (captions are short; O(n·m) is fine)
  const dp: number[][] = Array.from({ length: as.length + 1 }, () =>
    new Array<number>(bs.length + 1).fill(0),
  );
  for (let i = as.length - 1; i >= 0; i--) {
    for (let j = bs.length - 1; j >= 0; j--) {
      dp[i]![j] =
        as[i] === bs[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: { pos: number; word: string; kind: 'same' | 'old' | 'new' }[] = [];
  let i = 0;
  let j = 0;
  let pos = 0;
  while (i < as.length && j < bs.length) {
    if (as[i] === bs[j]) {
      out.push({ pos: pos++, word: as[i]!, kind: 'same' });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ pos: pos++, word: as[i]!, kind: 'old' });
      i++;
    } else {
      out.push({ pos: pos++, word: bs[j]!, kind: 'new' });
      j++;
    }
  }
  while (i < as.length) out.push({ pos: pos++, word: as[i++]!, kind: 'old' });
  while (j < bs.length) out.push({ pos: pos++, word: bs[j++]!, kind: 'new' });
  return out;
}

export function VersionHistory({ variantId }: { variantId: string }) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);

  useEffect(() => {
    bff<VersionRow[]>(`/variants/${variantId}/versions`)
      .then((r) => {
        setRows(r);
        if (r.length >= 2) {
          setLeft(r[r.length - 1]!.version);
          setRight(r[0]!.version);
        }
      })
      .catch((e) => setError(describeError(e)));
  }, [variantId]);

  if (error)
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  if (!rows) return <p className="text-xs text-muted">กำลังโหลด…</p>;
  if (rows.length === 0) return <p className="text-xs text-muted">ยังไม่มีประวัติเวอร์ชัน</p>;

  const byVersion = new Map(rows.map((r) => [r.version, r]));
  const leftRow = left !== null ? byVersion.get(left) : undefined;
  const rightRow = right !== null ? byVersion.get(right) : undefined;
  const showDiff = leftRow && rightRow && left !== right;

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.version} className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`diff-a-${variantId}`}
                aria-label={`เวอร์ชันเก่า ${r.version}`}
                checked={left === r.version}
                onChange={() => setLeft(r.version)}
              />
              v{r.version}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`diff-b-${variantId}`}
                aria-label={`เวอร์ชันใหม่ ${r.version}`}
                checked={right === r.version}
                onChange={() => setRight(r.version)}
              />
              {r.editedBy}
            </label>
            <span className="text-muted">{thTime.format(new Date(r.createdAt))}</span>
            <span className="line-clamp-1 flex-1 text-muted">
              {(r.snapshot.caption ?? '').slice(0, 60)}
            </span>
          </li>
        ))}
      </ul>
      {showDiff && leftRow && rightRow && (
        <div className="rounded-md bg-line/50 p-2 text-xs leading-relaxed">
          <p className="mb-1 text-muted">
            เทียบ v{leftRow.version} → v{rightRow.version}
          </p>
          <p>
            {wordDiff(leftRow.snapshot.caption ?? '', rightRow.snapshot.caption ?? '').map((w) => (
              <span
                key={w.pos}
                className={
                  w.kind === 'old'
                    ? 'bg-danger/15 text-danger line-through'
                    : w.kind === 'new'
                      ? 'bg-ok/15 text-ok font-medium'
                      : ''
                }
              >
                {w.word}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
