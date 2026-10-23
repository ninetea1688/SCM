'use client';

/**
 * CAL-02: platform/status filter chips. Selection lives in the URL, so the
 * server renders already-filtered data and the filters survive a refresh.
 */
import {
  PLATFORM_LABEL_TH,
  PLATFORMS,
  type Platform,
  VARIANT_STATUS_LABEL_TH,
  type VariantStatus,
} from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/** Only statuses a variant can be in while it occupies a calendar slot. */
const CAL_STATUSES = [
  'scheduled',
  'paused',
  'publishing',
  'retrying',
  'published',
  'failed',
  'cancelled',
] as const satisfies readonly VariantStatus[];

const PLATFORM_DOT: Record<Platform, string> = {
  facebook: 'bg-facebook',
  instagram: 'bg-instagram',
  tiktok: 'bg-tiktok',
  youtube: 'bg-youtube',
  line: 'bg-line-oa',
};

const chip =
  'rounded-full border px-2.5 py-1 text-xs transition-colors aria-pressed:border-brand aria-pressed:bg-brand/10 aria-pressed:font-medium border-line text-muted hover:border-brand hover:text-ink';

export function Filters({
  platforms,
  statuses,
}: {
  platforms: Platform[];
  statuses: VariantStatus[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle(group: 'platforms' | 'statuses', value: string, active: string[]) {
    const next = active.includes(value) ? active.filter((v) => v !== value) : [...active, value];
    const params = new URLSearchParams(window.location.search);
    if (next.length) params.set(group, next.join(','));
    else params.delete(group);
    start(() => router.push(`/calendar?${params}`));
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${pending ? 'opacity-60' : ''}`}>
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="text-xs text-muted">แพลตฟอร์ม:</legend>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={platforms.includes(p)}
            onClick={() => toggle('platforms', p, platforms)}
            className={`flex items-center gap-1.5 ${chip}`}
          >
            <span className={`inline-block size-2 rounded-full ${PLATFORM_DOT[p]}`} />
            {PLATFORM_LABEL_TH[p]}
          </button>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="text-xs text-muted">สถานะ:</legend>
        {CAL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statuses.includes(s)}
            onClick={() => toggle('statuses', s, statuses)}
            className={chip}
          >
            {VARIANT_STATUS_LABEL_TH[s]}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
