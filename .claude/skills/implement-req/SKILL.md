---
name: implement-req
description: Implement one or more SCM PRD requirements end to end (e.g. "/implement-req CONN-05", "ทำ MEDIA-03"). Use whenever work starts on a requirement ID from prd/prd.md — reads the PRD row and AC, writes AC-named tests first, implements, updates docs/STATUS.md and verifies.
argument-hint: <REQ-ID> [REQ-ID…]
---

# Implement a PRD requirement

Requirement(s): $ARGUMENTS

## 1. Load the spec (do not skip)
- The UserPromptSubmit hook injects the PRD rows + AC for IDs in the prompt. If missing, run
  `grep -n "| <ID> " prd/prd.md` and read the module's `AC:` block below its table.
- Read the row in `docs/STATUS.md` and any ADR that amends this area (`docs/decisions/`).
- Check the phase. If the ID belongs to a later phase than `docs/STATUS.md` "Current phase", say so
  and confirm before building.
- List what the PRD leaves ambiguous. Decide with the most conservative reading; if the choice
  changes PRD behaviour, write an ADR (Proposed) instead of silently picking.

## 2. Plan in 5–10 lines
Which layers change: `packages/domain` (rules) → `packages/db` (schema + RLS, use `/new-migration`)
→ `apps/api` (module/service/controller, audit, afterCommit) → `apps/web` (Thai UI, `/thai-ux`).
Name the tests you will write. Prefer extending existing modules over new abstractions.

## 3. Tests first
- Domain rules: unit tests in `packages/domain/src/*.test.ts`.
- ACs: e2e in `apps/api/src/**.e2e.test.ts` using `createWorld()` against dev infra; test names
  start with the AC id/wording, e.g. `'CONN AC: token expiring within 7 days shows warning'`.
- Run them and watch them fail for the right reason.

## 4. Implement
Follow CLAUDE.md non-negotiables. Every state change audited; tenant data inside `withTenant`;
side effects after commit; limits/configurable values not hard-coded; Thai user-facing text.

## 5. Verify and record
- `pnpm dev:infra` (if not running) → `pnpm verify` must be green. Paste the summary line.
- UI touched → start the app and look at the page at desktop and 390px width.
- Update the requirement row in `docs/STATUS.md` (status + evidence test name) and "Next up".
- For risky areas (publishing, auth, tenancy, webhooks, AI) ask the `prd-guardian` and
  `security-reviewer` agents to review the diff before declaring done.

## 6. Report
What changed (files), which ACs are now proven by which tests, what is still open, any ADR created.
