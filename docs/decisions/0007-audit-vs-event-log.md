# ADR-0007 — Audit log vs Event log

**Context.** PRD has both ANA-03 (Event Log of every action) and OPS-01 (immutable Audit Log)
without saying how they relate.

**Decision.** One call, `AuditService.record(tx, …)`, writes both in the caller's transaction:
- `audit_logs`: compliance trail with before/after, append-only for every role (trigger + revoked grants).
- `events`: analytics stream (actor, action, object, payload) feeding P3 analytics; may be
  aggregated or archived.
Both pass through `redact()` so secrets never land in either.

**Consequences.** High-volume, low-value actions may call `record(..., { audit: false })` to write
only the event.
