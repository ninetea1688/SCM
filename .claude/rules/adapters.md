---
paths:
  - "apps/api/src/publishing/**"
---
# Publishing / adapter rules (PRD §5, §9.2, ADR-0004)

- An adapter implements `PublisherAdapter` from `@scm/domain`: validate, publish, reconcile,
  getQuota, optional prepare. Use the `/new-adapter` skill for a new platform.
- Classify every response: auth/permission → `permanent`; throttling/transient → `retryable`
  (honour Retry-After); network failure or 5xx **on a write** → `unknown`.
- `reconcile()` must really look the post up on the platform; return `null` only when proven absent.
- Tokens go in headers, never query strings. Traces pass through `redact()`.
- All HTTP via `httpCall()` (timeout + trace). Inject `fetchFn` so unit tests mock HTTP.
- Before changing an endpoint, field or limit, verify with official docs (`platform-researcher`).
- `PublishRunner` holds no DB transaction across a platform call (claim → call → record).
