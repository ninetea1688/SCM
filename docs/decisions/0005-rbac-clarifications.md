# ADR-0005 — RBAC clarifications

**Context.** PRD §3.2 references "หัวหน้า" (supervisor) which is not a role; Topic Owner and
System Admin are listed in §3.1 but not in the permission matrix.

**Decision.** Encoded in `packages/domain/src/rbac.ts`:
- "หัวหน้า" for sensitive replies (INBOX-09) = Approver or above in that workspace.
- Topic Owner = additive grant scoped to a topic (P4), not a role.
- System Admin = platform-level flag `users.is_system_admin`, outside any workspace; it does not
  grant access to tenant content.
- Owner/Admin must have 2FA verified in the current session before any workspace action (AUTH-04).

**Consequences.** PRD §3 needs the clarification. Workspace-level supervisor role can be added later.
