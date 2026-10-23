---
paths:
  - "packages/domain/**"
---
# packages/domain rules

- Pure TypeScript: no I/O, no Date.now()/Math.random() without an injectable parameter, no framework
  imports. Anything here must be unit-testable in milliseconds.
- This package is the single source of truth for business rules. If API or web needs a rule, it
  imports it from here — never re-implements it.
- User-facing messages are Thai (`messageTh`) and must be readable to non-technical staff (POST-04 AC).
- Changing the variant state machine or RBAC matrix changes PRD behaviour: add/adjust a test that
  names the PRD AC, and record the change in an ADR.
- Platform numbers go in `PLATFORM_LIMITS` / `DAILY_PUBLISH_LIMITS` with `source` + `verifiedAt`.
- Imports use `.js` suffixes (NodeNext). Rebuild (`pnpm build:packages`) before API/web see changes.
