---
paths:
  - "**/*.test.ts"
  - "apps/api/src/test/**"
---
# Test rules

- Name tests after the PRD AC or rule they prove, e.g. `'PUB AC: unknown outcome never duplicates'`.
- AC tests hit real Postgres/Redis via `createWorld()` (fresh workspace + one user per role, 2FA for
  owner/admin). Don't mock the database to prove isolation or workflow rules.
- Platform HTTP is mocked in adapter unit tests (`fetchFn`); end-to-end uses `PUBLISHER_MODE=fake`.
- Deterministic: inject randomness/time into domain functions instead of sleeping.
- A failing test is information: fix the code or state why the test is wrong — never delete or skip
  it to get green.
