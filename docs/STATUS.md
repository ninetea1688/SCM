# Delivery status — traceability matrix

**Current phase: P1 MVP (feature-complete on code).** Last updated 2026-10-24 (OPS-04 watch).
Legend: ✅ done + tested · 🟡 partial · ⬜ not started · ⏸ blocked (reason).
Evidence = the test that proves the AC. Update this file in the same change that moves a row
(the `/implement-req` skill does it). The SessionStart hook prints the "Next up" list.

## Next up (P1, in order)

1. Staging **host** (owner action): `docs/runbooks/deploy.md` §Staging — the stack itself is
   done and boot-verified locally (same `docker-compose.prod.yml`, `.env.staging`, sandbox
   publisher via `ALLOW_FAKE_PUBLISHER`, seed via the `migrate` service).

## P1 requirements

| ID | Status | Evidence / note |
| --- | --- | --- |
| AUTH-01 Multi-workspace isolation | ✅ | `packages/db/src/rls.test.ts`, e2e "tenant isolation" |
| AUTH-02 Multi-membership | ✅ | `withUser` + `GET /workspaces` |
| AUTH-03 RBAC workspace + per-account scope | ✅ | `rules.test.ts` rbac, `TenantGuard`, `PostsService.account()` |
| AUTH-04 2FA owner/admin | 🟡 | smoke test; `TenantGuard` `mfa_required_for_role`. Enforcement config-gated (`AUTH_ENFORCE_MFA`: on in production, off in dev/test until SSO/Azure AD — SEC-02); `auth-mfa.e2e.test.ts` proves the gate |
| AUTH-06 ≥2 owners | ✅ | e2e "membership" |
| AUTH-07 Instant revoke + connected-accounts report | ✅ | e2e "membership" |
| CONN-01 Meta OAuth (pages + IG) | 🟡 | full OAuth dialog flow (`GET /accounts/meta/oauth/start` + public signed-state callback, `meta-oauth.e2e.test.ts`) + paste-token fallback + "เชื่อมต่อผ่าน Meta" button in `/accounts`; untested against real Meta (needs App — owner) |
| CONN-02 LINE connect + webhook | 🟡 | token verified live at connect; LINE OA form in `/accounts` shows the webhook URL to paste into the console; untested without a real channel |
| CONN-04 Encrypted tokens | ✅ | `TokenCipher` AES-256-GCM, key rotation by id |
| CONN-05 Auto refresh + pre-slot health check | ✅ | `account-health.test.ts` + `account-maintenance.e2e.test.ts`: hourly sweep (system role), Meta token re-exchange hook, pre-slot probe in the prepare wake-up; expired tokens disconnect + alert |
| CONN-06 Health dashboard | ✅ | `/accounts` table: status, expiry, last error + live quota column (`GET /accounts/:id/quota`) + reconnect button (sandbox re-upsert; live jumps to connect panel) |
| CONN-07 Disconnect alert + reconnect | ✅ | publish fails loudly with `account_disconnected`; proactive alert (in-app + team LINE + email); reconnect button in `/accounts` (sandbox re-upsert; live jumps to the connect panel) |
| MEDIA-01 Presigned direct upload | ✅ | `media.e2e.test.ts` (real SeaweedFS PUT); `/media` uploader. Fixed SDK checksum bug that broke browser PUTs |
| MEDIA-02 Folders/tags/search | ✅ | API + UI: name search, folder, tag chips (with counts), orientation, duration window; `GET /media/facets` (`media-filters.e2e.test.ts`) |
| MEDIA-03 Thumbnails + preview | ✅ | `media.e2e.test.ts` (15 tests): image/video/EXIF renditions, no upscale, poster frame content, audit event, queue hand-off + re-queue, final-attempt failure, sweeper; safety per ADR-0008 (allowlist, format match, size match, pixel cap, disguised playlist, immutable key). Video preview = poster still; documents: no preview yet |
| MEDIA-04 FFmpeg/Sharp conversion | ✅ | `media-convert.e2e.test.ts` (7 tests, mutation-checked): HEIC tile grid → full JPEG, GPS/EXIF stripped, PNG flattened, HEVC .mov → H.264/AAC faststart, compliant MP4 remuxed only, oversize scaled to 1920, IG publish receives the JPEG. ADR-0009 |
| MEDIA-05 Multi-ratio crops (P2, pulled forward) | ✅ | processor cover-crops 1:1 / 4:5 / 9:16 / 16:9 from the verified frame (never upscales, `cropBox`), signed URLs in the view + a crop strip on each library card (`media-crops-rights.e2e.test.ts`) |
| MEDIA-07 Usage rights (P2, pulled forward) | ✅ | source / licence / rightsExpireAt / consentOnFile set at upload and editable per asset (PATCH /media/:id/rights, audited); attaching lapsed media is refused (`media_rights_expired`) and an expiry within 7 days shows a Thai warning issue that blocks submission |
| MEDIA-08 Orphan cleanup (follow-up, done 2026-10-24) | ✅ | `MediaOrphanSweeper` (worker, hourly): abandoned `uploading` rows (≥60 min) deleted object+row; failed assets lose every stored object (original + renditions) with the row kept for audit (`orphanCleanedAt`); ready assets untouched (`media-orphans.e2e.test.ts`) |
| MEDIA-06 Short-lived signed URLs | ✅ | `StorageService.presignGet` (TTL from config), public endpoint split; originals signed as attachment only |
| POST-01 Post → variants | ✅ | e2e, composer UI |
| POST-02 Per-platform options | ✅ | schema + validation; shared `VariantOptions` UI in composer + variant card (IG format, FB format, YouTube title, LINE broadcast/narrowcast) |
| POST-04 validate() (moved to P1, ADR-0002) | ✅ | `rules.test.ts`, e2e "POST-04 AC" |
| APPR-01/02 single-level approval (ADR-0002) | ✅ | e2e "approval workflow" |
| CAL-01 Calendar views | ✅ | month/week/day/list + mobile agenda; drag-and-drop → atomic `POST /variants/:id/reschedule` (e2e "reschedule (CAL-01)": new job armed, old wake-up cancelled, lead-time + kill-switch guards) |
| CAL-02 Filters + colours | ✅ | API filters (`platforms`/`statuses`, `calendar filters (CAL-02)` e2e) + UI chip groups in `/calendar` (selection in the URL, survives navigation) |
| CAL-03 BE/CE, Asia/Bangkok | ✅ | `thai-date.ts` + `thai-holidays.ts` (fixed dates, weekend observation, annual table 2569 sourced from the cabinet resolution — re-verify yearly); shown in month/week/list views |
| CAL-05 Quota warning | ✅ | enforced at schedule (409); day cells show a "ใกล้โควตา n/limit" chip at ≥80% of `DAILY_PUBLISH_LIMITS` |
| PUB-01 Own scheduler | ✅ | BullMQ delayed job; smoke: fired 0.14 s after slot |
| PUB-02 Adapters FB/IG/LINE | 🟡 | FB + IG + LINE live adapters, unit-tested with mocked HTTP (`adapters.test.ts`); IG: containers → `media_publish`, carousel, `prepare()` pre-stage (e2e), `reconcile`, live `content_publishing_limit`. Untested against real platform APIs (Meta App pending) |
| PUB-03 Retry + backoff | ✅ | `publish-job.test.ts`, e2e "PUB-03" |
| PUB-04 No duplicates | ✅ | ADR-0004; e2e "network lost … never a duplicate" |
| PUB-05 Quota counting | ✅ | local daily cap at schedule (409) + live platform readings persisted in `quota_usage` (dashboard view + hourly sweep; `QuotaRecorder` e2e) |
| PUB-06 external id + permalink | ✅ | e2e |
| PUB-07 Publish log, redacted | ✅ | `publish_attempts`, `redact()` tests, adapter trace test |
| PUB-08 LINE recipients/quota preview | ✅ | `GET /accounts/:id/publish-preview` (targeted reach + monthly quota, `publish-preview` e2e) + "ตัวอย่างก่อนส่ง" on the LINE variant card before scheduling; Narrowcast needs Audiences (CRM-03, P5) |
| PUB-10 Kill Switch (pulled into P1) | ✅ | e2e "Kill Switch" |
| NOTI-01 In-app + team LINE + email | ✅ | publish_failed/account_disconnected alert in-app + team LINE + email via SMTP (Mailpit in dev, `ops.e2e.test.ts`) |
| NOTI-02 Types (P1 subset) | ✅ | publish_failed, account_disconnected, approval_requested (submit pings owner/admin/approver, never the author), token_expiring (daily-deduped warn in the health sweep); remaining types are P2–P3 |
| OPS-01 Immutable audit log | ✅ | rls.test "append-only" |
| OPS-02/03/04 Observability | 🟡 | pino logs, `/health`; OPS-03 ✅ Prometheus `/metrics` (publish outcomes per platform, queue depth); OPS-04 ✅ `/status` page + worker `StatusWatchJob` alerts owners/admins in-app + ONE team LINE push on component-down/backlog threshold, recovery notice, edge-triggered (`status-watch.e2e.test.ts`); OPS-02 🟡 Sentry SDK wired behind `SENTRY_DSN` (untested — needs DSN) |
| INBOX-07/08/09 Desk rules (P2, done early) | ✅ | out-of-hours auto-answer (workspace-configurable hours via settings.inboxWorkingHours, one auto-answer per unanswered streak, shown grey "ตอบอัตโนมัติ"); per-platform reply windows (REPLY_WINDOW_HOURS: LINE unlimited, Messenger/IG 24 h — desk shows the deadline, warn at 2 h); sensitive replies (DEFAULT_SENSITIVE_KEYWORDS + settings.sensitiveKeywords) from agents wait as 'pending' until a supervisor approves (sends via adapter) or rejects (`inbox-rules.e2e.test.ts`) |
| INBOX-03/04/05/06 Desk workflow (P2, done early) | ✅ | auto-assign round-robin to agent/approver/admin/owner on new conversations (`inbox_rotation` cursor, INBOX_AUTO_ASSIGN); SLA: reply due in INBOX_SLA_HOURS from each inbound message, worker `InboxSlaJob` escalates once per breach (team LINE via notifySystem + in-app rows for owners/admins), replying clears the debt; Saved Replies CRUD (`/saved-replies`, `/shortcut` + chips in the composer, audited); internal notes render as โน้ตภายใน bubbles and never reach the platform (`inbox-workflow.e2e.test.ts`) |
| INBOX-01/02 Chat + comment desks (P2 core, done early) | ✅ | `/inbox` (LINE OA: webhook → conversation + messages, reply claims the thread "กำลังตอบโดย…", open/claimed/closed, dedupe by messageId) + `/comments` (Meta feed webhook → per post × platform, reply via adapter, hide; unknown posts kept unlinked) — `engage.e2e.test.ts`; Messenger/IG DM need the Meta App |
| ANA-01/02 skeleton + per-post analytics (P2/P3, first cut) | ✅ first cut | append-only `post_metrics` snapshots per post × platform (worker hourly `AnalyticsCollectorJob`, deduped per day), central names reach/likes/comments/shares; `/analytics` table sorted by engagement rate; live Meta/YouTube/LINE insights land with ANA-01 proper |
| MOD-01..03 Comment moderation (P2 core, done early) | ✅ | MOD-02 lists (forbidden/borderline/watchAccounts) owner-configurable in /settings, audited; webhook classifies on arrival (forbidden → auto-hidden, borderline/watched → รอตัดสิน queue), staff un-hide restores (MOD-03), redelivery never resurrects (`moderation.e2e.test.ts`); platform-side hide (MOD-01 FB/IG API) lands with the Meta App |
| APPR-03/04 Internal comments + approval reminders (P2, done early) | ✅ | internal discussion per post (GET/POST /posts/:id/comments, 'ความเห็นภายในทีม' on the post page, RLS-protected) + worker reminders when a variant sits in_review past APPROVAL_REMIND_HOURS (once/variant/day, owners/admins/approvers in-app + team LINE, toggleable via NOTI-03) (`appr.e2e.test.ts`); ผู้อนุมัติสำรอง + PWA remain |
| NOTI-03/INBOX-11 Per-user notification prefs (P2, done early) | ✅ | opt-out model (missing row = on), per type × channel (in_app/email); NotificationService filters in-app + email recipients; /settings 'การแจ้งเตือนของฉัน' toggles; user-scoped RLS (`notification-prefs.e2e.test.ts`) |
| BRAND-01/02 Brand kit + voice (P2, done early) | ✅ | settings.brand (signature, defaultHashtags, tone, voiceNotes, examplePosts) owner-editable in /settings; composer shows แทรกลายเซ็น/#hashtag chips; voice fields ready as AI context for AIC-* (`workspaces.e2e.test.ts`) |
| POST-03 Per-platform preview (P2, done early) | ✅ | variant card 'พรีวิวหน้าตาบน <platform>' — styled FB feed / IG square / LINE bubble / YouTube card mocks using the media preview rendition; purely client-side, honest approximation |
| POST-07 Forbidden words + Thai proof (words part) | ✅ words | workspace forbidden list (MOD-02) blocks submit with 'forbidden_word' Thai issue (`publishing.e2e.test.ts`); Thai spell-check and ad-category rules remain (need a dictionary/rule source) |
| CRM-01 Contact profile + history (P2, done early) | ✅ | GET /inbox/conversations/:id/profile — identity, first-contact date, received/sent/total counts (notes excluded), same-contact threads across accounts; CRM line in the chat desk header (`engage.e2e.test.ts`) |
| CAL-04 Content gap (P2, done early) | ✅ | month-board empty non-holiday cells show a ว่าง chip |
| CAL-06 Mourning/event ranges (P2, done early) | ✅ | settings.mourningRanges (owner PATCH, audited) — amber banner listing overlapping ranges + ไว้ทุกข์ markers on board cells for a content-appropriateness review |
| OPS-07 Platform changelog process | 🟡 | `platform-researcher` agent + `/verify-platform-limits` skill |
| ANA-03 Event log | ✅ | ADR-0007 |
| INT-04 Meta data-deletion callback | ✅ | callback verified + recorded; worker job deletes matching inbound events and closes the request (`pdpa.e2e.test.ts`) |
| SEC-01/03 | ✅ | crypto, webhook signature tests |
| PDPA-01/02/03 | 🟡 | PDPA-02 ✅ self-service data-subject requests: file/list/export JSON (ขอดู), owner queue + audited handling; erase removes the user's copies (`pdpa.e2e.test.ts`). PDPA-01/03 documents remain owner actions |
| Workspace settings (PRD §0, role table) | ✅ | `/settings` in the nav: approval policy toggle (owner-only `PATCH /workspaces/current/settings`, audited), member management (list/add/revoke — the existing AUTH-06/07 API), audit trail (30 latest), 2FA link; `workspaces.e2e.test.ts` proves the owner-only write + audit entry |
| Staging + deploy | 🟡 | Docker Compose only (no hosted CI, owner decision 2026-10-23); `pnpm verify` before every deploy; staging **stack** done + boot-verified locally (compose `ENV_FILE`, `.env.staging.example`, sandbox opt-in, runbook §Staging); staging **host** pending (owner) |

## Known follow-ups

- Worker egress restriction: the 2 GiB /tmp tmpfs is in compose; the DOCKER-USER firewall snippet (runbooks/deploy.md) is applied per host at setup

## Phase 0 blockers (owner actions, outside code)

- ⏸ Meta App + App Review (`pages_manage_posts`, `instagram_content_publish`), Business Verification
- ⏸ TikTok + YouTube audits (submit now; they gate P2)
- ⏸ Domain + HTTPS, privacy policy URL, RoPA, retention periods
- ⏸ PRD amendments in ADR-0002/0003/0005 need owner sign-off
