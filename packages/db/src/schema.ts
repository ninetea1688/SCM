/**
 * P1 schema — PRD §8, amended by ADR-0003 (approval per variant+version) and ADR-0006
 * (every tenant table carries `workspace_id` and is protected by Row-Level Security; see
 * migrations/*_rls.sql). When you add a tenant table, add its RLS policy in the same PR.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const workspaceRef = () =>
  uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });

// ── Organisation ─────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshHash: text('refresh_hash').notNull(),
    mfaPassed: boolean('mfa_passed').notNull().default(false),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Bangkok'),
  killSwitch: boolean('kill_switch').notNull().default(false),
  crisisMode: boolean('crisis_mode').notNull().default(false),
  /** Configurable defaults (PRD §0): retry policy, quota warn ratio, health-check lead time… */
  settings: jsonb('settings').notNull().default({}),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: workspaceRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', {
      enum: ['owner', 'admin', 'approver', 'editor', 'agent', 'viewer'],
    }).notNull(),
    /** AUTH-03: null/empty = all accounts. */
    accountScope: uuid('account_scope').array(),
    createdAt: createdAt(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

// ── Accounts ─────────────────────────────────────────────────────────────────

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: id(),
    workspaceId: workspaceRef(),
    platform: text('platform', {
      enum: ['facebook', 'instagram', 'tiktok', 'youtube', 'line'],
    }).notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['own', 'partner'] })
      .notNull()
      .default('own'),
    status: text('status', { enum: ['active', 'expiring', 'disconnected', 'error'] })
      .notNull()
      .default('active'),
    /** CONN-04: AES-256-GCM envelope, see apps/api/src/common/crypto. Never plaintext. */
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    /** LINE channel secret / Meta app secret proof used to verify webhooks (SEC-03). */
    webhookSecretEnc: text('webhook_secret_enc'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    scopes: text('scopes').array(),
    connectedBy: uuid('connected_by').references(() => users.id),
    lastError: text('last_error'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('social_accounts_ext_uq').on(t.workspaceId, t.platform, t.externalId)],
);

// ── Content ──────────────────────────────────────────────────────────────────

export const mediaAssets = pgTable('media_assets', {
  id: id(),
  workspaceId: workspaceRef(),
  kind: text('kind', { enum: ['image', 'video', 'document'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  /** bigint: uploads may exceed 2 GiB (MEDIA_MAX_BYTES defaults to 4 GiB). */
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  durationSec: real('duration_sec'),
  folder: text('folder').notNull().default('/'),
  tags: text('tags').array().notNull().default([]),
  status: text('status', { enum: ['uploading', 'processing', 'ready', 'failed'] })
    .notNull()
    .default('uploading'),
  /** MEDIA-03 renditions (WebP), derived keys; null until processed or for documents. */
  thumbnailKey: text('thumbnail_key'),
  previewKey: text('preview_key'),
  /**
   * MEDIA-04 / ADR-0009: platform-ready copy (JPEG or H.264/AAC MP4, metadata stripped). Publishing
   * and validate() use it; the original stays untouched. Null for documents.
   */
  publishKey: text('publish_key'),
  publishMimeType: text('publish_mime_type'),
  publishSizeBytes: bigint('publish_size_bytes', { mode: 'number' }),
  publishWidth: integer('publish_width'),
  publishHeight: integer('publish_height'),
  /** Thai reason shown to the user when status = failed. */
  processingError: text('processing_error'),
  /**
   * MEDIA-08: set once the stored bytes of a failed asset were deleted (PDPA retention).
   * The row stays for audit; the sweeper skips assets with this set.
   */
  orphanCleanedAt: timestamp('orphan_cleaned_at', { withTimezone: true }),
  /** MEDIA-05: signed-URL keys of the aspect-ratio crops, e.g. { "1:1": "ws/…/x.jpg.crop-1-1.webp" }. */
  crops: jsonb('crops').$type<Record<string, string> | null>(),
  /** Set when processing is (re)queued; the sweeper uses it to find stuck jobs (ADR-0008). */
  processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
  /** How many times the sweeper re-queued a stuck job; it gives up after a few. */
  processingRequeues: integer('processing_requeues').notNull().default(0),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  /** MEDIA-07 usage rights: where it came from, under what licence, until when, and whether
   *  consent of the people shown is on file (PRD MEDIA-07). */
  source: text('source'),
  license: text('license'),
  rightsExpireAt: timestamp('rights_expire_at', { withTimezone: true }),
  consentOnFile: boolean('consent_on_file').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const campaigns = pgTable('campaigns', {
  id: id(),
  workspaceId: workspaceRef(),
  name: text('name').notNull(),
  startsOn: timestamp('starts_on', { withTimezone: true }),
  endsOn: timestamp('ends_on', { withTimezone: true }),
  goal: text('goal'),
  pillar: text('pillar'),
  createdAt: createdAt(),
});

export const posts = pgTable('posts', {
  id: id(),
  workspaceId: workspaceRef(),
  campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const postVariants = pgTable(
  'post_variants',
  {
    id: id(),
    workspaceId: workspaceRef(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    platform: text('platform', {
      enum: ['facebook', 'instagram', 'tiktok', 'youtube', 'line'],
    }).notNull(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id),
    caption: text('caption').notNull().default(''),
    options: jsonb('options').notNull().default({}),
    status: text('status').notNull().default('draft'),
    /** Bumped on every content edit; approvals bind to a version (ADR-0003). */
    version: integer('version').notNull().default(1),
    approvedVersion: integer('approved_version'),
    lastEditedBy: uuid('last_edited_by')
      .notNull()
      .references(() => users.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    externalPostId: text('external_post_id'),
    permalink: text('permalink'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_variants_post_idx').on(t.postId),
    index('post_variants_schedule_idx').on(t.workspaceId, t.scheduledAt),
  ],
);

export const variantMedia = pgTable(
  'variant_media',
  {
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => postVariants.id, { onDelete: 'cascade' }),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.position] })],
);

export const variantVersions = pgTable(
  'variant_versions',
  {
    id: id(),
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => postVariants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    editedBy: uuid('edited_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('variant_versions_uq').on(t.variantId, t.version)],
);

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => postVariants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    decision: text('decision', {
      enum: ['approved', 'changes_requested', 'rejected'],
    }).notNull(),
    level: integer('level').notNull().default(1),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id),
    comment: text('comment'),
    policyException: boolean('policy_exception').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('approvals_variant_idx').on(t.variantId, t.version)],
);

// ── Publishing ───────────────────────────────────────────────────────────────

export const publishJobs = pgTable(
  'publish_jobs',
  {
    id: id(),
    workspaceId: workspaceRef(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => postVariants.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    preparedHandle: text('prepared_handle'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    externalPostId: text('external_post_id'),
    permalink: text('permalink'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('publish_jobs_variant_idx').on(t.variantId)],
);

export const publishAttempts = pgTable(
  'publish_attempts',
  {
    id: id(),
    workspaceId: workspaceRef(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => publishJobs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    kind: text('kind', { enum: ['publish', 'reconcile', 'prepare'] })
      .notNull()
      .default('publish'),
    outcome: text('outcome', {
      enum: ['success', 'retryable', 'permanent', 'unknown', 'absent'],
    }).notNull(),
    httpStatus: integer('http_status'),
    /** Already redacted (PUB-07). */
    request: jsonb('request'),
    response: jsonb('response'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('publish_attempts_job_idx').on(t.jobId)],
);

export const quotaUsage = pgTable(
  'quota_usage',
  {
    id: id(),
    workspaceId: workspaceRef(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    used: integer('used').notNull().default(0),
    /** PUB-05: the platform-reported cap when the reading was taken (may change per plan). */
    quotaLimit: integer('quota_limit'),
  },
  (t) => [uniqueIndex('quota_usage_uq').on(t.socialAccountId, t.kind, t.windowStart)],
);

// ── Logs (ADR-0007: Audit = immutable compliance trail; Event = analytics stream) ─

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id'),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_ws_idx').on(t.workspaceId, t.createdAt)],
);

export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    channel: text('channel'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('events_ws_idx').on(t.workspaceId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    channel: text('channel', { enum: ['in_app', 'line', 'email'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'read'] })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/**
 * Raw verified webhook payloads, stored before processing (ack fast, process in queue).
 * Starts the LINE chat history from P1 so P4's knowledge distillation has data (PRD §6.14).
 */
export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: id(),
    workspaceId: workspaceRef(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    eventType: text('event_type').notNull(),
    externalEventId: text('external_event_id'),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when processing is (re)queued; the sweeper uses it to find stuck jobs (ADR-0008). */
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    /** How many times the sweeper re-queued a stuck job; it gives up after a few. */
    processingRequeues: integer('processing_requeues').notNull().default(0),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('inbound_events_ext_uq').on(t.socialAccountId, t.externalEventId),
    index('inbound_events_ws_idx').on(t.workspaceId, t.receivedAt),
  ],
);

/** INT-04 / PLAT-01: Meta Data Deletion Callback. Not tenant-scoped (arrives from Meta). */
export const dataDeletionRequests = pgTable('data_deletion_requests', {
  id: id(),
  platform: text('platform').notNull(),
  externalUserId: text('external_user_id').notNull(),
  confirmationCode: text('confirmation_code').notNull().unique(),
  status: text('status', { enum: ['received', 'processing', 'done'] })
    .notNull()
    .default('received'),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

/**
 * PDPA-02: data-subject requests from our own users (ขอดู/ขอแก้/ขอลบ).
 * Tenant-scoped: members see their own; owners/admins handle the queue.
 */
export const pdpaRequests = pgTable(
  'pdpa_requests',
  {
    id: id(),
    workspaceId: workspaceRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['access', 'correct', 'erase'] }).notNull(),
    detail: text('detail'),
    status: text('status', { enum: ['received', 'processing', 'done', 'rejected'] })
      .notNull()
      .default('received'),
    /** Set by the handler (owner/admin) when closing the request. */
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    handledNote: text('handled_note'),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('pdpa_requests_ws_idx').on(t.workspaceId, t.createdAt)],
);

// ── Unified Inbox (INBOX-01/02) ─────────────────────────────────────────────────────────────

/** One chat thread per platform contact (LINE OA user today; Messenger/IG DM later). */
export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    workspaceId: workspaceRef(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    externalUserId: text('external_user_id').notNull(),
    externalUserName: text('external_user_name'),
    /** INBOX-02: เปิด / รับเรื่องแล้ว / ปิด. */
    status: text('status', { enum: ['open', 'claimed', 'closed'] })
      .notNull()
      .default('open'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /** INBOX-04: reply due by (set on open/new inbound message); null = answered, nothing owed. */
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }),
    /** INBOX-04: set once the overdue escalation fired so it never repeats for one breach. */
    slaEscalatedAt: timestamp('sla_escalated_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text('last_message_preview'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('conversations_contact_uq').on(t.socialAccountId, t.externalUserId),
    index('conversations_ws_idx').on(t.workspaceId, t.lastMessageAt),
  ],
);

export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: id(),
    workspaceId: workspaceRef(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    senderName: text('sender_name'),
    text: text('text').notNull(),
    /** INBOX-06: internal notes are invisible to the customer (never sent to the platform). */
    isInternalNote: boolean('is_internal_note').notNull().default(false),
    /** INBOX-07: out-of-hours auto-answer (shown grey in the thread). */
    isAutoReply: boolean('is_auto_reply').notNull().default(false),
    /**
     * INBOX-09: sensitive replies from agents wait for a supervisor here — 'sent' = already
     * on the platform, 'pending' = awaiting approval, 'rejected' = sent back to redraft.
     */
    status: text('status', { enum: ['sent', 'pending', 'rejected'] })
      .notNull()
      .default('sent'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    /** Platform message id (LINE messageId) for redelivery dedupe; null for local drafts. */
    externalId: text('external_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('inbox_messages_ext_uq').on(t.conversationId, t.externalId),
    index('inbox_messages_conv_idx').on(t.conversationId, t.createdAt),
  ],
);

/** INBOX-05: approved standard answers, reused from the composer with one click. */
export const savedReplies = pgTable(
  'saved_replies',
  {
    id: id(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** INBOX-05: drawn from the approved Q&A store when CRM lands; free-form for now. */
    shortcut: text('shortcut'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('saved_replies_shortcut_uq').on(t.workspaceId, t.shortcut),
    index('saved_replies_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);

/**
 * NOTI-03/INBOX-11: per-user notification preferences. A missing row means "on" —
 * staff opt OUT per type/channel rather than opt in. In-app rows respect the type
 * toggle; email respects the email toggle for that type.
 */
export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationType: text('notification_type').notNull(),
    channel: text('channel', { enum: ['in_app', 'email'] }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('notification_prefs_uq').on(t.userId, t.notificationType, t.channel)],
);

/** INBOX-03: round-robin cursor per workspace (one row; the counter is not tenant data). */
export const inboxRotation = pgTable('inbox_rotation', {
  workspaceId: workspaceRef().primaryKey(),
  cursor: integer('cursor').notNull().default(0),
});

/** Comments on our published posts (INBOX-01: FB/IG feed via webhook; linked through publish_jobs). */
export const postComments = pgTable(
  'post_comments',
  {
    id: id(),
    workspaceId: workspaceRef(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    /** Our post when the platform post matches one we published; null for unknown posts. */
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    externalPostId: text('external_post_id'),
    externalCommentId: text('external_comment_id').notNull(),
    parentExternalCommentId: text('parent_external_comment_id'),
    authorName: text('author_name'),
    text: text('text').notNull(),
    /** MOD-01/03 lite: replied / hidden (spam/negative) / open for the team. */
    status: text('status', { enum: ['open', 'replied', 'hidden', 'pending'] })
      .notNull()
      .default('open'),
    replyText: text('reply_text'),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    repliedBy: uuid('replied_by').references(() => users.id, { onDelete: 'set null' }),
    hiddenReason: text('hidden_reason'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('post_comments_ext_uq').on(t.socialAccountId, t.externalCommentId),
    index('post_comments_ws_idx').on(t.workspaceId, t.receivedAt),
    index('post_comments_post_idx').on(t.postId),
  ],
);

/**
 * ANA-01: engagement snapshots per published post — append-only (never overwrite), so
 * trends survive metric-definition changes (ANA-02 maps them to the central names).
 */
export const postMetrics = pgTable(
  'post_metrics',
  {
    id: id(),
    workspaceId: workspaceRef(),
    socialAccountId: uuid('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    externalPostId: text('external_post_id'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    reach: integer('reach').notNull().default(0),
    likes: integer('likes').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    shares: integer('shares').notNull().default(0),
  },
  (t) => [index('post_metrics_post_idx').on(t.postId, t.capturedAt)],
);

/** Tables protected by the tenant RLS policy. Keep in sync with the RLS migration. */
export const TENANT_TABLES = [
  'workspaces',
  'memberships',
  'social_accounts',
  'media_assets',
  'campaigns',
  'posts',
  'post_variants',
  'variant_media',
  'variant_versions',
  'approvals',
  'publish_jobs',
  'publish_attempts',
  'quota_usage',
  'audit_logs',
  'events',
  'notifications',
  'inbound_events',
  'pdpa_requests',
  'conversations',
  'inbox_messages',
  'saved_replies',
  'notification_prefs',
  'inbox_rotation',
  'post_comments',
  'post_metrics',
] as const;
