---
name: new-adapter
description: Add or change a social platform Publisher Adapter (Instagram, TikTok, YouTube, or a new endpoint for Facebook/LINE). Use for any work in apps/api/src/publishing/adapters or when a platform API changes.
argument-hint: <platform> [what to change]
---

# Publisher adapter: $ARGUMENTS

Contract: `PublisherAdapter` in `packages/domain/src/adapter.ts`. Rules: `.claude/rules/adapters.md`.
ADR-0004 explains why `reconcile()` exists.

1. **Verify the platform first.** Ask the `platform-researcher` agent for: endpoints + required
   scopes, media requirements, rate/publishing limits, async processing/status polling, error codes
   (auth vs transient), idempotency support, audit/app-review constraints. Every fact needs an
   official URL. Update `PLATFORM_LIMITS` (`source`, `verifiedAt`) in `packages/domain/src/validation.ts`.
2. **validate()** — extend `validateVariant` with platform rules + Thai messages; unit-test them.
3. **prepare()** if media needs processing (IG containers, YouTube upload, TikTok init): idempotent
   per job, store handle in `publish_jobs.prepared_handle`, respect expiry (IG container 24h).
4. **publish()** — all HTTP via `httpCall()` with injected `fetchFn`; token in header; classify:
   auth → permanent · throttling/transient → retryable (+Retry-After) · network/5xx on write → unknown.
5. **reconcile()** — really search the platform for the post created since `attemptStartedAt`
   (or rely on a platform idempotency key, like LINE's `X-Line-Retry-Key`). Never return null
   without evidence.
6. **getQuota()** — live quota where the API exposes it (IG `content_publishing_limit`, YouTube units).
7. Register in `AdapterRegistry` (live mode) and keep `FakeAdapter` behaviour aligned.
8. Tests (`adapters.test.ts` style): success, each error class, network error on write → unknown,
   reconcile found/absent, no token in URL or trace. Then `pnpm verify`.
9. Update `docs/STATUS.md` (PUB-02 row) and note any app-review/audit dependency there.
