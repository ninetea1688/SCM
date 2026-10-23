/** Quota accounting in our own system — PRD PUB-05, CAL-05, PUB-08. */

export type QuotaLevel = 'ok' | 'warning' | 'exceeded';

export interface QuotaCheck {
  level: QuotaLevel;
  used: number;
  limit: number;
  remaining: number;
}

/** Default warn ratio; configurable per workspace (PRD §0: no hard-coded "ค่าเริ่มต้น"). */
export const DEFAULT_QUOTA_WARN_RATIO = 0.8;

export function checkQuota(
  used: number,
  requested: number,
  limit: number,
  warnRatio = DEFAULT_QUOTA_WARN_RATIO,
): QuotaCheck {
  const after = used + requested;
  const remaining = Math.max(0, limit - after);
  let level: QuotaLevel = 'ok';
  if (after > limit) level = 'exceeded';
  else if (after >= limit * warnRatio) level = 'warning';
  return { level, used: after, limit, remaining };
}

/**
 * LINE: every message object counts once per recipient (PRD §5.1); Reply does not count.
 * A broadcast with 3 bubbles to 10,000 followers costs 30,000.
 */
export function lineMessageCost(
  recipients: number,
  messageObjects: number,
  kind: 'reply' | 'push' | 'multicast' | 'broadcast' | 'narrowcast',
): number {
  if (kind === 'reply') return 0;
  return recipients * Math.max(1, messageObjects);
}

/**
 * Per-account publishing caps per rolling 24h that we enforce ourselves (PUB-05, CAL-05).
 * Values from PRD §5.1 — re-verify with official docs each phase (IG: read
 * `content_publishing_limit` at runtime; this is only the fallback). Workspace-configurable.
 */
export const DAILY_PUBLISH_LIMITS: Partial<Record<string, number>> = {
  'instagram:any': 50,
  'facebook:reel': 30,
};
