# ADR-0002 — Minimal approval and validate() in P1

**Context.** PRD puts PUB (publishing) in P1 but APPR (approval) and POST-04 (validate) in P2.
That lets P1 publish without approval — contradicting G2 ("100% of posts have an approver record")
and the APPR-01 AC — and lets invalid posts reach platforms (e.g. FB photo+video mix).

**Decision.** P1 ships single-level approval (submit/approve/request changes/reject with reason)
and `validate()` per platform. P2 still adds 2-level approval (APPR-06), backup approvers and
reminders (APPR-04), PWA approval (APPR-05), preview (POST-03), banned-words/Thai spell (POST-07).

**Consequences.** ~1 extra week in P1; removes the riskiest gap. Needs PRD owner sign-off → update PRD §15.
