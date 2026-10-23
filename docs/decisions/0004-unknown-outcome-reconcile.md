# ADR-0004 — `unknown` publish outcome and reconcile-before-retry

**Context.** PUB AC: "kill the network mid-publish, retry must not duplicate the post". An
idempotency key stored on our side cannot guarantee this: Graph API does not accept one, so a
request that timed out *after* the platform created the post would be posted twice on retry.

**Decision.**
- Adapters return one of `success | retryable | permanent | unknown`. Network errors and 5xx on a
  write are `unknown`.
- `unknown` is never retried blindly. The job goes to `outcome_unknown`, and the next wake-up calls
  `adapter.reconcile()` (e.g. FB: search `published_posts` since the attempt for the exact message).
  Found → success. Proven absent → publish again. Reconcile failing 5× → failed + notify.
- LINE supports `X-Line-Retry-Key`, so its reconcile returns "absent" and resend is safe.
- `PublisherAdapter` gains `reconcile()` and optional `prepare()` (pre-stage video/IG containers
  ahead of the slot so NFR-02 holds for media that needs processing).
- A worker crash mid-call leaves the job `running`; the sweeper turns it into `outcome_unknown`.

**Consequences.** Extends PRD §9.2 interface. Adapter authors must implement reconcile honestly.
