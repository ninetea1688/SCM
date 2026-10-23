/**
 * MEDIA-02: filter bar — free-text search, folder, tag, orientation and duration.
 * Plain GET form so it works without JS; facets come from GET /media/facets.
 */
import Link from 'next/link';

export interface Facets {
  folders: string[];
  tags: { tag: string; count: number }[];
}

const ASPECTS = [
  { value: '', label: 'ทุกสัดส่วน' },
  { value: 'landscape', label: 'แนวนอน' },
  { value: 'portrait', label: 'แนวตั้ง' },
  { value: 'square', label: 'จัตุรัส' },
] as const;

const DURATIONS = [
  { value: '', label: 'ทุกความยาว' },
  { value: '0-15', label: 'สั้นกว่า 15 วิ' },
  { value: '15-60', label: '15 วิ – 1 นาที' },
  { value: '60-300', label: '1 – 5 นาที' },
  { value: '300-', label: 'ยาวกว่า 5 นาที' },
] as const;

export interface FilterState {
  q: string;
  kind: string;
  folder: string;
  tag: string;
  aspect: string;
  dur: string;
}

export function FilterBar({ state, facets }: { state: FilterState; facets: Facets }) {
  const select =
    'rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:border-brand';
  const hasFilter = state.q || state.kind || state.folder || state.tag || state.aspect || state.dur;

  return (
    <form method="get" action="/media" aria-label="ค้นหาและกรองคลังสื่อ" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={state.q}
          placeholder="ค้นหาชื่อไฟล์…"
          aria-label="ค้นหาชื่อไฟล์"
          className={`${select} min-w-48 flex-1`}
        />
        <select name="folder" defaultValue={state.folder} aria-label="โฟลเดอร์" className={select}>
          <option value="">ทุกโฟลเดอร์</option>
          {facets.folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select name="aspect" defaultValue={state.aspect} aria-label="สัดส่วนภาพ" className={select}>
          {ASPECTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <select name="dur" defaultValue={state.dur} aria-label="ความยาววิดีโอ" className={select}>
          {DURATIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {/* keep the kind tab when submitting */}
        <input type="hidden" name="kind" value={state.kind} />
        <button
          type="submit"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink shadow-sm transition-colors hover:bg-brand-deep"
        >
          ค้นหา
        </button>
        {hasFilter ? (
          <Link
            href={state.kind ? `/media?kind=${state.kind}` : '/media'}
            className="px-2 py-2 text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            ล้างตัวกรอง
          </Link>
        ) : null}
      </div>
      {facets.tags.length > 0 && (
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="กรองด้วยแท็ก">
          <span className="text-xs text-muted">แท็ก:</span>
          {facets.tags.slice(0, 12).map(({ tag, count }) => {
            const active = state.tag === tag;
            const params = new URLSearchParams();
            for (const [k, v] of Object.entries(state)) if (v && k !== 'tag') params.set(k, v);
            params.set('tag', tag);
            return (
              <Link
                key={tag}
                href={`/media?${params.toString()}`}
                title={active ? `กำลังกรองด้วยแท็ก ${tag}` : `กรองด้วยแท็ก ${tag}`}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-brand font-medium text-brand-ink'
                    : 'bg-line/60 text-muted hover:bg-line hover:text-ink'
                }`}
              >
                {tag} <span className="opacity-60">{count}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </form>
  );
}
