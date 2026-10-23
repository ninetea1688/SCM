/**
 * Post Variant lifecycle — PRD §7.1, amended by ADR-0003.
 *
 * Amendments vs. the PRD diagram:
 * - Editing content after approval returns to `in_review` (PRD §6.5 AC wins over the diagram).
 * - Added `rejected`, `cancelled`, unschedule (scheduled → approved) and manual
 *   reschedule after failure (failed → scheduled, only while the approved content is unchanged).
 */
import { err, ok, type Result } from './result.js';

export const VARIANT_STATUSES = [
  'idea',
  'draft',
  'in_review',
  'rejected',
  'approved',
  'scheduled',
  'paused',
  'publishing',
  'retrying',
  'published',
  'failed',
  'cancelled',
] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export type VariantEvent =
  | 'develop' // idea → draft
  | 'submit' // draft → in_review (requires passing validate())
  | 'request_changes' // in_review → draft
  | 'reject' // in_review → rejected
  | 'reopen' // rejected → draft
  | 'approve' // in_review → approved
  | 'edit_content' // after approval → in_review; in draft stays draft
  | 'schedule' // approved | failed → scheduled
  | 'unschedule' // scheduled | paused → approved
  | 'pause' // scheduled → paused (Kill Switch)
  | 'resume' // paused → scheduled
  | 'start' // scheduled | retrying → publishing
  | 'succeed' // publishing → published
  | 'fail_retryable' // publishing → retrying
  | 'fail_permanent' // publishing | retrying → failed
  | 'revise' // failed → draft
  | 'cancel'; // any pre-publish state → cancelled

export const VARIANT_STATUS_LABEL_TH: Record<VariantStatus, string> = {
  idea: 'ไอเดีย',
  draft: 'ร่าง',
  in_review: 'รอตรวจ',
  rejected: 'ถูกปฏิเสธ',
  approved: 'อนุมัติแล้ว',
  scheduled: 'ตั้งเวลาแล้ว',
  paused: 'พักไว้',
  publishing: 'กำลังโพสต์',
  retrying: 'กำลังลองใหม่',
  published: 'สำเร็จ',
  failed: 'ล้มเหลว',
  cancelled: 'ยกเลิก',
};

const CANCELLABLE: readonly VariantStatus[] = [
  'idea',
  'draft',
  'in_review',
  'rejected',
  'approved',
  'scheduled',
  'paused',
  'failed',
];

const TABLE: Record<VariantEvent, Partial<Record<VariantStatus, VariantStatus>>> = {
  develop: { idea: 'draft' },
  submit: { draft: 'in_review' },
  request_changes: { in_review: 'draft' },
  reject: { in_review: 'rejected' },
  reopen: { rejected: 'draft' },
  approve: { in_review: 'approved' },
  edit_content: {
    idea: 'idea',
    draft: 'draft',
    in_review: 'in_review',
    approved: 'in_review',
    scheduled: 'in_review',
    paused: 'in_review',
    failed: 'draft',
  },
  schedule: { approved: 'scheduled', failed: 'scheduled' },
  unschedule: { scheduled: 'approved', paused: 'approved' },
  pause: { scheduled: 'paused' },
  resume: { paused: 'scheduled' },
  start: { scheduled: 'publishing', retrying: 'publishing' },
  succeed: { publishing: 'published' },
  fail_retryable: { publishing: 'retrying' },
  fail_permanent: { publishing: 'failed', retrying: 'failed' },
  revise: { failed: 'draft' },
  cancel: Object.fromEntries(CANCELLABLE.map((s) => [s, 'cancelled'])),
};

export interface TransitionContext {
  /** Blocking validation issues for `submit` (PRD POST-04). */
  blockingIssueCount?: number;
  /** For `approve`: who approves and who authored the current version. */
  actorUserId?: string;
  authorUserId?: string;
  /** Owner policy allowing self-approval (PRD APPR-01 exception; must be audited). */
  selfApprovalAllowed?: boolean;
  /** For `schedule` from `failed`: content unchanged since approval. */
  approvedVersionIsCurrent?: boolean;
  /** Workspace Kill Switch active (PRD PUB-10): nothing may start or be newly scheduled. */
  killSwitchActive?: boolean;
}

export type TransitionError =
  | { code: 'invalid_transition'; from: VariantStatus; event: VariantEvent }
  | { code: 'validation_failed'; count: number }
  | { code: 'self_approval_forbidden' }
  | { code: 'approval_stale' }
  | { code: 'kill_switch_active' };

export interface TransitionOutcome {
  to: VariantStatus;
  /** True when this transition invalidates the previous approval (must re-approve). */
  approvalInvalidated: boolean;
  /** True when a queued PublishJob must be cancelled. */
  cancelPendingJob: boolean;
  /** True when an audited policy exception was used (e.g. self-approval). */
  policyExceptionUsed: boolean;
}

const POST_APPROVAL: readonly VariantStatus[] = ['approved', 'scheduled', 'paused'];

export function transitionVariant(
  from: VariantStatus,
  event: VariantEvent,
  ctx: TransitionContext = {},
): Result<TransitionOutcome, TransitionError> {
  const to = TABLE[event][from];
  if (!to) return err({ code: 'invalid_transition', from, event });

  let policyExceptionUsed = false;

  if (event === 'submit' && (ctx.blockingIssueCount ?? 0) > 0) {
    return err({ code: 'validation_failed', count: ctx.blockingIssueCount ?? 0 });
  }
  if (event === 'approve') {
    const same = ctx.actorUserId !== undefined && ctx.actorUserId === ctx.authorUserId;
    if (same && !ctx.selfApprovalAllowed) return err({ code: 'self_approval_forbidden' });
    policyExceptionUsed = same;
  }
  if (event === 'schedule' && from === 'failed' && !ctx.approvedVersionIsCurrent) {
    return err({ code: 'approval_stale' });
  }
  if ((event === 'start' || event === 'schedule' || event === 'resume') && ctx.killSwitchActive) {
    return err({ code: 'kill_switch_active' });
  }

  const approvalInvalidated = event === 'edit_content' && POST_APPROVAL.includes(from);
  const cancelPendingJob =
    (from === 'scheduled' || from === 'paused') &&
    (event === 'edit_content' || event === 'unschedule' || event === 'cancel');

  return ok({ to, approvalInvalidated, cancelPendingJob, policyExceptionUsed });
}

export function allowedEvents(from: VariantStatus): VariantEvent[] {
  return (Object.keys(TABLE) as VariantEvent[]).filter((e) => TABLE[e][from] !== undefined);
}

/** Statuses in which content is locked against silent edits (an edit re-triggers review). */
export function isApprovedState(status: VariantStatus): boolean {
  return POST_APPROVAL.includes(status);
}
