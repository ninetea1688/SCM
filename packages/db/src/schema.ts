/**
 * P1 schema — PRD §8, amended by ADR-0003 (approval per variant+version) and ADR-0006
 * (every tenant table carries `workspace_id` and is protected by Row-Level Security; see
 * migrations/*_rls.sql). When you add a tenant table, add its RLS policy in the same PR.
 */
import { sql } from 'drizzle-orm';
import {
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
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  durationSec: real('duration_sec'),
  folder: text('folder').notNull().default('/'),
  tags: text('tags').array().notNull().default([]),
  status: text('status', { enum: ['uploading', 'processing', 'ready', 'failed'] })
    .notNull()
    .default('uploading'),
  source: text('source'),
  license: text('license'),
  rightsExpireAt: timestamp('rights_expire_at', { withTimezone: true }),
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
] as const;
