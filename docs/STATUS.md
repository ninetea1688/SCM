# Delivery status — traceability matrix

**Current phase: P1 MVP (walking skeleton done).** Last updated 2026-10-23.
Legend: ✅ done + tested · 🟡 partial · ⬜ not started · ⏸ blocked (reason).
Evidence = the test that proves the AC. Update this file in the same change that moves a row
(the `/implement-req` skill does it). The SessionStart hook prints the "Next up" list.

## Next up (P1, in order)

1. MEDIA-03/04 thumbnails + FFmpeg/Sharp conversion worker
2. Instagram live adapter (containers, `content_publishing_limit`, `prepare()` pre-stage)
3. CONN-05/07 token refresh + pre-slot health check job + disconnect alerts
4. CAL-01 drag-and-drop reschedule, week/day/list views; CAL-03 Thai holidays; CAL-05 quota hints in UI
5. NOTI-01 email channel; OPS-02/03/04 Sentry + Prometheus metrics + status page
6. PDPA-02 data-subject requests; Meta deletion job processing (INT-04 currently records only)
7. CI pipeline green on GitHub (workflow exists), staging stack

## P1 requirements

| ID | Status | Evidence / note |
| --- | --- | --- |
| AUTH-01 Multi-workspace isolation | ✅ | `packages/db/src/rls.test.ts`, e2e "tenant isolation" |
| AUTH-02 Multi-membership | ✅ | `withUser` + `GET /workspaces` |
| AUTH-03 RBAC workspace + per-account scope | ✅ | `rules.test.ts` rbac, `TenantGuard`, `PostsService.account()` |
| AUTH-04 2FA owner/admin | ✅ | smoke test; `TenantGuard` `mfa_required_for_role` |
| AUTH-06 ≥2 owners | ✅ | e2e "membership" |
| AUTH-07 Instant revoke + connected-accounts report | ✅ | e2e "membership" |
| CONN-01 Meta OAuth (pages + IG) | 🟡 | `POST /accounts/meta` written, untested against Meta (needs App) |
| CONN-02 LINE connect + webhook | 🟡 | verifies token live; untested without a channel |
| CONN-04 Encrypted tokens | ✅ | `TokenCipher` AES-256-GCM, key rotation by id |
| CONN-05 Auto refresh + pre-slot health check | ⬜ | |
| CONN-06 Health dashboard | 🟡 | `/accounts` page; quota column pending |
| CONN-07 Disconnect alert + reconnect | 🟡 | publish fails loudly with `account_disconnected`; proactive alert pending |
| MEDIA-01 Presigned direct upload | ✅ | `MediaController`; UI uploader pending |
| MEDIA-02 Folders/tags/search | 🟡 | API filters; UI pending |
| MEDIA-03 Thumbnails | ⬜ | |
| MEDIA-04 FFmpeg/Sharp conversion | ⬜ | |
| MEDIA-06 Short-lived signed URLs | ✅ | `StorageService.presignGet`, public endpoint split |
| POST-01 Post → variants | ✅ | e2e, composer UI |
| POST-02 Per-platform options | 🟡 | schema + validation; UI only for YouTube title |
| POST-04 validate() (moved to P1, ADR-0002) | ✅ | `rules.test.ts`, e2e "POST-04 AC" |
| APPR-01/02 single-level approval (ADR-0002) | ✅ | e2e "approval workflow" |
| CAL-01 Calendar views | 🟡 | month + mobile agenda; drag-drop/week/day pending |
| CAL-02 Filters + colours | 🟡 | API filters + colours; UI filters pending |
| CAL-03 BE/CE, Asia/Bangkok | 🟡 | `thai-date.ts`; holidays pending |
| CAL-05 Quota warning | 🟡 | enforced at schedule (409); UI hint pending |
| PUB-01 Own scheduler | ✅ | BullMQ delayed job; smoke: fired 0.14 s after slot |
| PUB-02 Adapters FB/IG/LINE | 🟡 | FB + LINE live adapters (unit-tested with mocked HTTP); IG pending |
| PUB-03 Retry + backoff | ✅ | `publish-job.test.ts`, e2e "PUB-03" |
| PUB-04 No duplicates | ✅ | ADR-0004; e2e "network lost … never a duplicate" |
| PUB-05 Quota counting | 🟡 | daily cap check; per-platform live quota (`getQuota`) not persisted yet |
| PUB-06 external id + permalink | ✅ | e2e |
| PUB-07 Publish log, redacted | ✅ | `publish_attempts`, `redact()` tests, adapter trace test |
| PUB-08 LINE recipients/quota preview | 🟡 | `LineAdapter.followerCount/getQuota`; endpoint + UI pending |
| PUB-10 Kill Switch (pulled into P1) | ✅ | e2e "Kill Switch" |
| NOTI-01 In-app + team LINE | 🟡 | in-app + LINE push; email pending |
| NOTI-02 Types (P1 subset) | 🟡 | publish_failed done |
| OPS-01 Immutable audit log | ✅ | rls.test "append-only" |
| OPS-02/03/04 Observability | 🟡 | pino JSON logs + /health; Sentry/Prometheus pending |
| OPS-07 Platform changelog process | 🟡 | `platform-researcher` agent + `/verify-platform-limits` skill |
| ANA-03 Event log | ✅ | ADR-0007 |
| INT-04 Meta data-deletion callback | 🟡 | signed_request verified + recorded; deletion job pending |
| SEC-01/03 | ✅ | crypto, webhook signature tests |
| PDPA-01/02/03 | ⬜ | P0 documents + P1 data-subject flow |
| Staging + CI/CD | 🟡 | `.github/workflows/ci.yml`; staging host pending |

## Phase 0 blockers (owner actions, outside code)

- ⏸ Meta App + App Review (`pages_manage_posts`, `instagram_content_publish`), Business Verification
- ⏸ TikTok + YouTube audits (submit now; they gate P2)
- ⏸ Domain + HTTPS, privacy policy URL, RoPA, retention periods
- ⏸ PRD amendments in ADR-0002/0003/0005 need owner sign-off
