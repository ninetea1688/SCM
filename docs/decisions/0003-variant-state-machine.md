# ADR-0003 — Variant state machine amendments

**Context.** PRD §7.1 diagram and §6.5 AC disagree (edit after approval → Draft vs → "รอตรวจ"),
and the diagram lacks reject, cancel, unschedule and manual reschedule. Approval is modelled on
POST in the ERD but status lives on VARIANT, so an approval cannot prove *what* was approved.

**Decision.** Implemented in `packages/domain/src/variant-state.ts` (single source of truth):
- edit after approval → `in_review` (AC wins); approval is invalidated and pending jobs cancelled
- added `rejected` (→ `reopen` → draft), `cancelled` (from any pre-publish state),
  `unschedule` (scheduled|paused → approved), `failed → scheduled` only if content unchanged
- Kill Switch blocks `start`, `schedule`, `resume`; release = switch off, then resume one/all
- approvals reference `(variant_id, version)`; every edit bumps `version` and snapshots it
- author ≠ approver unless the workspace policy `allowSelfApproval` is on (audited)

**Consequences.** PRD §7.1 and §8.1 need updating to match. Self-approval rule mirrors KB-04.
