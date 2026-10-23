# Architecture Decision Records

One file per decision that changes how the system is built or amends the PRD.
Format: Context → Decision → Consequences. Status: Proposed | Accepted | Superseded by ADR-XXXX.
Never edit an Accepted ADR's decision — write a new one that supersedes it.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-stack-and-deploy.md) | TypeScript modular monolith, Docker Compose deploy | Accepted (owner delegated the choice, 2026-10-23) |
| [0002](0002-approval-and-validate-in-p1.md) | Move minimal approval + validate() into P1 | Proposed — needs PRD owner sign-off |
| [0003](0003-variant-state-machine.md) | Variant state machine amendments; approval bound to version | Proposed — needs PRD owner sign-off |
| [0004](0004-unknown-outcome-reconcile.md) | `unknown` publish outcome + reconcile before retry | Accepted |
| [0005](0005-rbac-clarifications.md) | RBAC: supervisor = Approver, Topic Owner = grant, System Admin = flag | Proposed — needs PRD owner sign-off |
| [0006](0006-tenant-isolation-rls.md) | Tenant isolation with Postgres Row-Level Security | Accepted |
| [0007](0007-audit-vs-event-log.md) | Audit log vs Event log | Accepted |
