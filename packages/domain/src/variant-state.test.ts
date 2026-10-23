import { describe, expect, it } from 'vitest';
import { allowedEvents, transitionVariant, VARIANT_STATUSES } from './variant-state.js';

describe('transitionVariant', () => {
  it('follows the happy path idea → published', () => {
    const steps = [
      ['idea', 'develop', 'draft'],
      ['draft', 'submit', 'in_review'],
      ['in_review', 'approve', 'approved'],
      ['approved', 'schedule', 'scheduled'],
      ['scheduled', 'start', 'publishing'],
      ['publishing', 'succeed', 'published'],
    ] as const;
    for (const [from, event, to] of steps) {
      const r = transitionVariant(from, event, { actorUserId: 'a', authorUserId: 'b' });
      expect(r.ok && r.value.to).toBe(to);
    }
  });

  it('POST-04 AC: a variant failing validate() cannot be submitted', () => {
    const r = transitionVariant('draft', 'submit', { blockingIssueCount: 2 });
    expect(r).toEqual({ ok: false, error: { code: 'validation_failed', count: 2 } });
  });

  it('POST AC: editing approved content returns to in_review and invalidates approval', () => {
    for (const from of ['approved', 'scheduled', 'paused'] as const) {
      const r = transitionVariant(from, 'edit_content');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.to).toBe('in_review');
        expect(r.value.approvalInvalidated).toBe(true);
      }
    }
  });

  it('cancels the pending job when a scheduled variant is edited, unscheduled or cancelled', () => {
    for (const event of ['edit_content', 'unschedule', 'cancel'] as const) {
      const r = transitionVariant('scheduled', event);
      expect(r.ok && r.value.cancelPendingJob).toBe(true);
    }
  });

  it('APPR-01: author cannot approve own content unless policy allows (audited)', () => {
    expect(
      transitionVariant('in_review', 'approve', { actorUserId: 'u1', authorUserId: 'u1' }),
    ).toEqual({ ok: false, error: { code: 'self_approval_forbidden' } });

    const r = transitionVariant('in_review', 'approve', {
      actorUserId: 'u1',
      authorUserId: 'u1',
      selfApprovalAllowed: true,
    });
    expect(r.ok && r.value.policyExceptionUsed).toBe(true);
  });

  it('there is no path into scheduled that skips approval', () => {
    const into = VARIANT_STATUSES.filter((s) => {
      const r = transitionVariant(s, 'schedule', { approvedVersionIsCurrent: true });
      return r.ok;
    });
    expect(into.sort()).toEqual(['approved', 'failed']);
    expect(transitionVariant('failed', 'schedule', { approvedVersionIsCurrent: false })).toEqual({
      ok: false,
      error: { code: 'approval_stale' },
    });
  });

  it('PUB-10: Kill Switch blocks start, schedule and resume', () => {
    for (const [from, event] of [
      ['scheduled', 'start'],
      ['approved', 'schedule'],
      ['paused', 'resume'],
    ] as const) {
      expect(transitionVariant(from, event, { killSwitchActive: true })).toEqual({
        ok: false,
        error: { code: 'kill_switch_active' },
      });
    }
  });

  it('published and cancelled are terminal', () => {
    expect(allowedEvents('published')).toEqual([]);
    expect(allowedEvents('cancelled')).toEqual([]);
  });

  it('rejects unknown transitions with a typed error', () => {
    expect(transitionVariant('draft', 'approve')).toEqual({
      ok: false,
      error: { code: 'invalid_transition', from: 'draft', event: 'approve' },
    });
  });
});
