import {
  PLATFORM_LABEL_TH,
  type Platform,
  VARIANT_STATUS_LABEL_TH,
  type VariantStatus,
} from '@scm/domain';

const PLATFORM_CLASS: Record<Platform, string> = {
  facebook: 'bg-facebook',
  instagram: 'bg-instagram',
  tiktok: 'bg-tiktok',
  youtube: 'bg-youtube',
  line: 'bg-line-oa',
};

export function PlatformDot({ platform }: { platform: Platform }) {
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${PLATFORM_CLASS[platform]}`}
      title={PLATFORM_LABEL_TH[platform]}
    />
  );
}

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <PlatformDot platform={platform} />
      {PLATFORM_LABEL_TH[platform]}
    </span>
  );
}

const STATUS_CLASS: Partial<Record<VariantStatus, string>> = {
  in_review: 'bg-warn/10 text-warn',
  approved: 'bg-ok/10 text-ok',
  scheduled: 'bg-brand/10 text-brand',
  published: 'bg-ok/15 text-ok',
  failed: 'bg-danger/10 text-danger',
  rejected: 'bg-danger/10 text-danger',
  paused: 'bg-warn/15 text-warn',
};

export function StatusBadge({ status }: { status: VariantStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status] ?? 'bg-line text-muted'}`}
    >
      {VARIANT_STATUS_LABEL_TH[status]}
    </span>
  );
}
