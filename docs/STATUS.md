# Delivery status — traceability matrix

**Current phase: P1 MVP (walking skeleton done).** Last updated 2026-10-23 (PUB-02 Instagram).
Legend: ✅ done + tested · 🟡 partial · ⬜ not started · ⏸ blocked (reason).
Evidence = the test that proves the AC. Update this file in the same change that moves a row
(the `/implement-req` skill does it). The SessionStart hook prints the "Next up" list.

## Next up (P1, in order)

1. Staging stack on Docker Compose (same `docker-compose.prod.yml`, separate host/env)

## P1 requirements

| ID | Status | Evidence / note |
| --- | --- | --- |
| AUTH-01 Multi-workspace isolation | ✅ | `packages/db/src/rls.test.ts`, e2e "tenant isolation" |
| AUTH-02 Multi-membership | ✅ | `withUser` + `GET /workspaces` |
| AUTH-03 RBAC workspace + per-account scope | ✅ | `rules.test.ts` rbac, `TenantGuard`, `PostsService.account()` |
| AUTH-04 2FA owner/admin | 🟡 | smoke test; `TenantGuard` `mfa_required_for_role`. Enforcement config-gated (`AUTH_ENFORCE_MFA`: on in production, off in dev/test until SSO/Azure AD — SEC-02); `auth-mfa.e2e.test.ts` proves the gate |
| AUTH-06 ≥2 owners | ✅ | e2e "membership" |
| AUTH-07 Instant revoke + connected-accounts report | ✅ | e2e "membership" |
| CONN-01 Meta OAuth (pages + IG) | 🟡 | `POST /accounts/meta` written, untested against Meta (needs App) |
| CONN-02 LINE connect + webhook | 🟡 | verifies token live; untested without a channel |
| CONN-04 Encrypted tokens | ✅ | `TokenCipher` AES-256-GCM, key rotation by id |
| CONN-05 Auto refresh + pre-slot health check | ✅ | `account-health.test.ts` + `account-maintenance.e2e.test.ts`: hourly sweep (system role), Meta token re-exchange hook, pre-slot probe in the prepare wake-up; expired tokens disconnect + alert |
| CONN-06 Health dashboard | ✅ | `/accounts` table: status, expiry, last error + live quota column (`GET /accounts/:id/quota`) + reconnect button (sandbox re-upsert; live jumps to connect panel) |
| CONN-07 Disconnect alert + reconnect | 🟡 | publish fails loudly with `account_disconnected`; proactive alert done (`account_disconnected` in-app + team LINE); reconnect button in UI pending |
| MEDIA-01 Presigned direct upload | ✅ | `media.e2e.test.ts` (real SeaweedFS PUT); `/media` uploader. Fixed SDK checksum bug that broke browser PUTs |
| MEDIA-02 Folders/tags/search | ✅ | API + UI: name search, folder, tag chips (with counts), orientation, duration window; `GET /media/facets` (`media-filters.e2e.test.ts`) |
| MEDIA-03 Thumbnails + preview | ✅ | `media.e2e.test.ts` (15 tests): image/video/EXIF renditions, no upscale, poster frame content, audit event, queue hand-off + re-queue, final-attempt failure, sweeper; safety per ADR-0008 (allowlist, format match, size match, pixel cap, disguised playlist, immutable key). Video preview = poster still; documents: no preview yet |
| MEDIA-04 FFmpeg/Sharp conversion | ✅ | `media-convert.e2e.test.ts` (7 tests, mutation-checked): HEIC tile grid → full JPEG, GPS/EXIF stripped, PNG flattened, HEVC .mov → H.264/AAC faststart, compliant MP4 remuxed only, oversize scaled to 1920, IG publish receives the JPEG. ADR-0009 |
| MEDIA-06 Short-lived signed URLs | ✅ | `StorageService.presignGet` (TTL from config), public endpoint split; originals signed as attachment only |
| POST-01 Post → variants | ✅ | e2e, composer UI |
| POST-02 Per-platform options | 🟡 | schema + validation; UI only for YouTube title |
| POST-04 validate() (moved to P1, ADR-0002) | ✅ | `rules.test.ts`, e2e "POST-04 AC" |
| APPR-01/02 single-level approval (ADR-0002) | ✅ | e2e "approval workflow" |
| CAL-01 Calendar views | ✅ | month/week/day/list + mobile agenda; drag-and-drop → atomic `POST /variants/:id/reschedule` (e2e "reschedule (CAL-01)": new job armed, old wake-up cancelled, lead-time + kill-switch guards) |
| CAL-02 Filters + colours | 🟡 | API filters + colours; UI filters pending |
| CAL-03 BE/CE, Asia/Bangkok | ✅ | `thai-date.ts` + `thai-holidays.ts` (fixed dates, weekend observation, annual table 2569 sourced from the cabinet resolution — re-verify yearly); shown in month/week/list views |
| CAL-05 Quota warning | ✅ | enforced at schedule (409); day cells show a "ใกล้โควตา n/limit" chip at ≥80% of `DAILY_PUBLISH_LIMITS` |
| PUB-01 Own scheduler | ✅ | BullMQ delayed job; smoke: fired 0.14 s after slot |
| PUB-02 Adapters FB/IG/LINE | 🟡 | FB + IG + LINE live adapters, unit-tested with mocked HTTP (`adapters.test.ts`); IG: containers → `media_publish`, carousel, `prepare()` pre-stage (e2e), `reconcile`, live `content_publishing_limit`. Untested against real platform APIs (Meta App pending) |
| PUB-03 Retry + backoff | ✅ | `publish-job.test.ts`, e2e "PUB-03" |
| PUB-04 No duplicates | ✅ | ADR-0004; e2e "network lost … never a duplicate" |
| PUB-05 Quota counting | 🟡 | daily cap check; per-platform live quota (`getQuota`) not persisted yet |
| PUB-06 external id + permalink | ✅ | e2e |
| PUB-07 Publish log, redacted | ✅ | `publish_attempts`, `redact()` tests, adapter trace test |
| PUB-08 LINE recipients/quota preview | 🟡 | `LineAdapter.followerCount/getQuota`; endpoint + UI pending |
| PUB-10 Kill Switch (pulled into P1) | ✅ | e2e "Kill Switch" |
| NOTI-01 In-app + team LINE + email | ✅ | publish_failed/account_disconnected alert in-app + team LINE + email via SMTP (Mailpit in dev, `ops.e2e.test.ts`) |
| NOTI-02 Types (P1 subset) | 🟡 | publish_failed done |
| OPS-01 Immutable audit log | ✅ | rls.test "append-only" |
| OPS-02/03/04 Observability | 🟡 | pino logs, `/health`; OPS-03 ✅ Prometheus `/metrics` (publish outcomes per platform, queue depth); OPS-04 🟡 public `/status` page done, LINE threshold alert pending; OPS-02 🟡 Sentry SDK wired behind `SENTRY_DSN` (untested — needs DSN) |
| OPS-07 Platform changelog process | 🟡 | `platform-researcher` agent + `/verify-platform-limits` skill |
| ANA-03 Event log | ✅ | ADR-0007 |
| INT-04 Meta data-deletion callback | ✅ | callback verified + recorded; worker job deletes matching inbound events and closes the request (`pdpa.e2e.test.ts`) |
| SEC-01/03 | ✅ | crypto, webhook signature tests |
| PDPA-01/02/03 | 🟡 | PDPA-02 ✅ self-service data-subject requests: file/list/export JSON (ขอดู), owner queue + audited handling; erase removes the user's copies (`pdpa.e2e.test.ts`). PDPA-01/03 documents remain owner actions |
| Staging + deploy | 🟡 | Docker Compose only (no hosted CI, owner decision 2026-10-23); `pnpm verify` before every deploy; staging host pending |

## Known follow-ups

- MEDIA-08: delete orphaned uploads/renditions of failed or abandoned assets (PDPA retention)
- Prod hardening for the worker: size-limited temp volume, no egress to internal hosts (ADR-0008)

## Phase 0 blockers (owner actions, outside code)

- ⏸ Meta App + App Review (`pages_manage_posts`, `instagram_content_publish`), Business Verification
- ⏸ TikTok + YouTube audits (submit now; they gate P2)
- ⏸ Domain + HTTPS, privacy policy URL, RoPA, retention periods
- ⏸ PRD amendments in ADR-0002/0003/0005 need owner sign-off
