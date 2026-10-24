/**
 * MEDIA-02/03/05/07: media library. Thumbnails keep their true aspect ratio (9:16 reels next to
 * 16:9 banners) because ratio is what the team chooses media by. Filter bar: search, folder, tag,
 * orientation, duration. Cards show the aspect-ratio crops (MEDIA-05) and usage rights (MEDIA-07).
 */
import { aspectLabel, RIGHTS_WARN_DAYS } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';
import { type Facets, FilterBar, type FilterState } from './filter-bar';
import { RightsEditor } from './rights-editor';
import { AutoRefresh, Uploader } from './uploader';

interface Asset {
  id: string;
  kind: 'image' | 'video' | 'document';
  status: 'processing' | 'ready' | 'failed';
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: number;
  processingError: string | null;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  crops: Record<string, string> | null;
  source: string | null;
  license: string | null;
  rightsExpireAt: string | null;
  consentOnFile: boolean;
}

const KINDS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'image', label: 'รูปภาพ' },
  { value: 'video', label: 'วิดีโอ' },
  { value: 'document', label: 'เอกสาร' },
] as const;

function duration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const thDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function fileSize(bytes: number): string {
  const mb = bytes / 1024 ** 2;
  return mb >= 1
    ? `${mb.toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const state: FilterState = {
    q: one('q'),
    kind: KINDS.some((k) => k.value === one('kind')) ? one('kind') : '',
    folder: one('folder'),
    tag: one('tag'),
    aspect: ['square', 'portrait', 'landscape'].includes(one('aspect')) ? one('aspect') : '',
    dur: /^\d*-\d*$/.test(one('dur')) ? one('dur') : '',
  };
  const qs = new URLSearchParams(Object.entries(state).filter(([, v]) => v) as [string, string][]);
  const here = `/media${qs.toString() ? `?${qs.toString()}` : ''}`;

  const params = new URLSearchParams();
  if (state.kind) params.set('kind', state.kind);
  if (state.folder) params.set('folder', state.folder);
  if (state.tag) params.set('tag', state.tag);
  if (state.q) params.set('q', state.q);
  if (state.aspect) params.set('aspect', state.aspect);
  if (state.dur) {
    const [min, max] = state.dur.split('-');
    if (min) params.set('minDurationSec', min);
    if (max) params.set('maxDurationSec', max);
  }
  const query = params.toString();
  const [assets, facets] = await Promise.all([
    load<Asset[]>(`/media${query ? `?${query}` : ''}`, here),
    load<Facets>('/media/facets', here),
  ]);
  const processing = assets.some((a) => a.status === 'processing');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold">คลังสื่อ</h1>
          <p className="mt-1 text-sm text-muted">
            {assets.length.toLocaleString('th-TH')} ไฟล์ ระบบสร้างภาพตัวอย่างให้อัตโนมัติหลังอัปโหลด
          </p>
        </div>
        <div className="ml-auto">
          <Uploader />
        </div>
      </div>

      <nav aria-label="ชนิดไฟล์" className="flex gap-1 border-b border-line text-sm">
        {KINDS.map((k) => {
          const p = new URLSearchParams(
            Object.entries({ ...state, kind: k.value }).filter(([, v]) => v) as [string, string][],
          );
          return (
            <Link
              key={k.value}
              href={k.value ? `/media?${p.toString()}` : '/media'}
              aria-current={state.kind === k.value ? 'page' : undefined}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-ink"
            >
              {k.label}
            </Link>
          );
        })}
      </nav>

      <FilterBar state={state} facets={facets} />

      {processing && <AutoRefresh />}

      {assets.length === 0 ? (
        <p className="py-16 text-center text-muted">ยังไม่มีไฟล์ในคลังสื่อ อัปโหลดรูปหรือวิดีโอเพื่อใช้ในโพสต์</p>
      ) : (
        <ul className="columns-2 gap-4 sm:columns-3 lg:columns-5 [&>li]:mb-5 [&>li]:break-inside-avoid">
          {assets.map((a) => {
            const ratio = a.width && a.height ? `${a.width} / ${a.height}` : '1 / 1';
            const daysLeft = a.rightsExpireAt
              ? Math.ceil((new Date(a.rightsExpireAt).getTime() - Date.now()) / 86_400_000)
              : null;
            return (
              <li key={a.id}>
                <figure>
                  <div
                    className="relative overflow-hidden rounded-md bg-line"
                    style={{ aspectRatio: ratio }}
                  >
                    {a.status === 'ready' && a.thumbnailUrl && (
                      // biome-ignore lint/performance/noImgElement: signed URLs to our own storage; next/image would proxy them
                      <img
                        src={a.thumbnailUrl}
                        alt={a.originalName}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                    {a.status === 'ready' && !a.thumbnailUrl && (
                      <span className="grid size-full place-items-center text-sm text-muted">
                        เอกสาร
                      </span>
                    )}
                    {a.status === 'processing' && (
                      <span className="grid size-full place-items-center rounded-md border border-dashed border-muted p-3 text-center text-xs text-muted motion-safe:animate-pulse">
                        กำลังสร้างภาพตัวอย่าง
                      </span>
                    )}
                    {a.status === 'failed' && (
                      <span className="grid size-full place-items-center bg-danger/5 p-3 text-center text-xs text-danger">
                        {a.processingError ?? 'ประมวลผลไฟล์ไม่สำเร็จ'}
                      </span>
                    )}
                    {a.kind === 'video' && a.durationSec ? (
                      <span className="absolute right-1.5 bottom-1.5 rounded bg-ink/75 px-1.5 py-0.5 text-xs text-surface">
                        {duration(a.durationSec)}
                      </span>
                    ) : null}
                  </div>
                  <figcaption className="mt-1.5 space-y-0.5">
                    <span className="line-clamp-1 block text-sm" title={a.originalName}>
                      {a.originalName}
                    </span>
                    {a.width && a.height ? (
                      <span className="flex gap-2 text-xs text-muted">
                        <span className="font-medium text-ink">
                          {aspectLabel({ width: a.width, height: a.height })}
                        </span>
                        <span>
                          {a.width}×{a.height}
                        </span>
                        <span>{fileSize(a.sizeBytes)}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">{fileSize(a.sizeBytes)}</span>
                    )}
                    {daysLeft !== null && (
                      <span
                        className={`block text-xs ${daysLeft < 0 ? 'text-danger' : daysLeft <= RIGHTS_WARN_DAYS ? 'text-warn' : 'text-muted'}`}
                      >
                        {daysLeft < 0
                          ? '⚠ สิทธิ์การใช้หมดอายุแล้ว'
                          : `สิทธิ์การใช้ถึง ${thDate.format(new Date(a.rightsExpireAt!))}`}
                      </span>
                    )}
                    {a.source && (
                      <span className="block truncate text-xs text-muted">ที่มา: {a.source}</span>
                    )}
                  </figcaption>
                  {a.status === 'ready' && Object.keys(a.crops ?? {}).length > 0 && (
                    <span className="mt-1 flex gap-1" title="ภาพตัดตามสัดส่วน">
                      {Object.entries(a.crops!).map(([r, url]) => (
                        <span key={r} className="relative w-1/4 overflow-hidden rounded-sm bg-line">
                          {/* biome-ignore lint/performance/noImgElement: signed rendition URLs */}
                          <img
                            src={url}
                            alt={`สัดส่วน ${r}`}
                            loading="lazy"
                            className="h-10 w-full object-cover"
                          />
                          <span className="absolute bottom-0 right-0 rounded bg-ink/70 px-0.5 text-[9px] text-surface">
                            {r}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                  {a.status === 'ready' && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                        ข้อมูลสิทธิ์{a.consentOnFile ? ' (มีความยินยอม ✓)' : ''}
                      </summary>
                      <RightsEditor
                        id={a.id}
                        source={a.source}
                        license={a.license}
                        rightsExpireAt={a.rightsExpireAt}
                        consentOnFile={a.consentOnFile}
                      />
                    </details>
                  )}
                </figure>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
