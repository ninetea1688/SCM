/**
 * Posts, Variants and the approval workflow — PRD POST-01/02/04/06, APPR-01/02, PUB-01/10.
 * Every state change goes through `transitionVariant()` from @scm/domain; this service only
 * loads, persists, audits and schedules.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  approvals,
  type Db,
  mediaAssets,
  posts,
  postVariants,
  publishJobs,
  socialAccounts,
  type Tx,
  variantMedia,
  variantVersions,
  withTenant,
  workspaces,
} from '@scm/db';
import {
  blockingIssues,
  canOnAccount,
  checkQuota,
  DAILY_PUBLISH_LIMITS,
  idempotencyKey,
  type MediaFacts,
  type Permission,
  type Platform,
  type QuotaCheck,
  type TransitionContext,
  transitionVariant,
  type ValidationIssue,
  type VariantDraft,
  type VariantEvent,
  type VariantStatus,
  validateVariant,
} from '@scm/domain';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { type AppConfig, CONFIG } from '../config';
import { PublishQueue } from '../publishing/queue';

export interface VariantInput {
  socialAccountId: string;
  caption?: string;
  options?: VariantDraft['options'];
  mediaIds?: string[];
}

export interface CreatePostInput {
  title: string;
  body?: string;
  campaignId?: string;
  variants: VariantInput[];
}

type Variant = typeof postVariants.$inferSelect;

/** Minimum lead time so the worker can pick the job up and pre-stage (NFR-02). */
const MIN_LEAD_MS = 60_000;

@Injectable()
export class PostsService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly queue: PublishQueue,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  private tx<T>(t: TenantInfo, u: AuthUser, fn: (tx: Tx) => Promise<T>) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, fn);
  }

  async create(t: TenantInfo, u: AuthUser, input: CreatePostInput) {
    if (input.variants.length === 0) {
      throw new BadRequestException({ code: 'no_variants', message: 'ต้องเลือกอย่างน้อย 1 ช่องทาง' });
    }
    return this.tx(t, u, async (tx) => {
      const [post] = await tx
        .insert(posts)
        .values({
          workspaceId: t.workspaceId,
          title: input.title,
          body: input.body ?? '',
          campaignId: input.campaignId ?? null,
          createdBy: u.userId,
        })
        .returning();
      for (const v of input.variants) {
        const account = await this.account(tx, t, v.socialAccountId, 'post.edit');
        const [variant] = await tx
          .insert(postVariants)
          .values({
            workspaceId: t.workspaceId,
            postId: post!.id,
            platform: account.platform,
            socialAccountId: account.id,
            caption: v.caption ?? input.body ?? '',
            options: v.options ?? {},
            lastEditedBy: u.userId,
          })
          .returning();
        await this.setMedia(tx, t, variant!.id, v.mediaIds ?? []);
        await this.snapshot(tx, variant!, u.userId);
      }
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'post.created',
        targetType: 'post',
        targetId: post!.id,
        after: { title: post!.title, variants: input.variants.length },
      });
      return this.load(tx, post!.id);
    });
  }

  async get(t: TenantInfo, u: AuthUser, postId: string) {
    return this.tx(t, u, (tx) => this.load(tx, postId));
  }

  /** CAL-01/02: variants in a time window with filters. */
  async calendar(
    t: TenantInfo,
    u: AuthUser,
    q: { from: Date; to: Date; platforms?: Platform[]; statuses?: VariantStatus[] },
  ) {
    return this.tx(t, u, (tx) =>
      tx
        .select({
          id: postVariants.id,
          postId: postVariants.postId,
          title: posts.title,
          platform: postVariants.platform,
          socialAccountId: postVariants.socialAccountId,
          status: postVariants.status,
          scheduledAt: postVariants.scheduledAt,
          caption: postVariants.caption,
        })
        .from(postVariants)
        .innerJoin(posts, eq(posts.id, postVariants.postId))
        .where(
          and(
            gte(postVariants.scheduledAt, q.from),
            lt(postVariants.scheduledAt, q.to),
            q.platforms?.length ? inArray(postVariants.platform, q.platforms) : undefined,
            q.statuses?.length ? inArray(postVariants.status, q.statuses) : undefined,
          ),
        )
        .orderBy(asc(postVariants.scheduledAt)),
    );
  }

  /** Unscheduled work (ideas, drafts, in review) for the side list. */
  async backlog(t: TenantInfo, u: AuthUser) {
    return this.tx(t, u, (tx) =>
      tx
        .select({
          id: postVariants.id,
          postId: postVariants.postId,
          title: posts.title,
          platform: postVariants.platform,
          status: postVariants.status,
          updatedAt: postVariants.updatedAt,
        })
        .from(postVariants)
        .innerJoin(posts, eq(posts.id, postVariants.postId))
        .where(
          inArray(postVariants.status, [
            'idea',
            'draft',
            'in_review',
            'rejected',
            'approved',
            'failed',
          ]),
        )
        .orderBy(asc(postVariants.updatedAt))
        .limit(200),
    );
  }

  /** POST-06 versioning + POST AC: editing approved content sends it back to review. */
  async editVariant(
    t: TenantInfo,
    u: AuthUser,
    variantId: string,
    patch: Omit<VariantInput, 'socialAccountId'>,
  ) {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.tx(t, u, async (tx) => {
      const v = await this.variantForUpdate(tx, variantId);
      await this.account(tx, t, v.socialAccountId, 'post.edit');
      const r = transitionVariant(v.status as VariantStatus, 'edit_content');
      if (!r.ok) throw new ConflictException({ code: r.error.code, status: v.status });

      const [updated] = await tx
        .update(postVariants)
        .set({
          caption: patch.caption ?? v.caption,
          options: patch.options ?? v.options,
          status: r.value.to,
          version: v.version + 1,
          approvedVersion: r.value.approvalInvalidated ? null : v.approvedVersion,
          lastEditedBy: u.userId,
          updatedAt: new Date(),
        })
        .where(eq(postVariants.id, v.id))
        .returning();
      if (patch.mediaIds) await this.setMedia(tx, t, v.id, patch.mediaIds);
      await this.snapshot(tx, updated!, u.userId);
      if (r.value.cancelPendingJob) afterCommit.push(await this.cancelJobs(tx, v.id));
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'variant.edited',
        targetType: 'post_variant',
        targetId: v.id,
        before: { caption: v.caption, status: v.status, version: v.version },
        after: { caption: updated!.caption, status: updated!.status, version: updated!.version },
      });
      return this.withIssues(tx, updated!);
    });
    for (const fn of afterCommit) await fn();
    return result;
  }

  async validate(t: TenantInfo, u: AuthUser, variantId: string) {
    return this.tx(t, u, async (tx) => {
      const [v] = await tx.select().from(postVariants).where(eq(postVariants.id, variantId));
      if (!v) throw new NotFoundException();
      return (await this.withIssues(tx, v)).issues;
    });
  }

  /**
   * Workflow actions. `comment` is required for request_changes/reject (APPR-02).
   * Permission per action is enforced by the controller; account scope (AUTH-03) here.
   */
  async act(
    t: TenantInfo,
    u: AuthUser,
    variantId: string,
    event: Extract<
      VariantEvent,
      | 'develop'
      | 'submit'
      | 'approve'
      | 'request_changes'
      | 'reject'
      | 'reopen'
      | 'schedule'
      | 'unschedule'
      | 'cancel'
      | 'revise'
    >,
    opts: { comment?: string; scheduledAt?: Date; permission: Permission },
  ) {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.tx(t, u, async (tx) => {
      const v = await this.variantForUpdate(tx, variantId);
      await this.account(tx, t, v.socialAccountId, opts.permission);
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, t.workspaceId));

      const ctx: TransitionContext = { killSwitchActive: ws?.killSwitch ?? false };
      let issues: ValidationIssue[] = [];
      let quota: QuotaCheck | null = null;

      if (event === 'submit') {
        issues = (await this.withIssues(tx, v)).issues;
        ctx.blockingIssueCount = blockingIssues(issues).length;
      }
      if (event === 'approve') {
        ctx.actorUserId = u.userId;
        ctx.authorUserId = v.lastEditedBy;
        ctx.selfApprovalAllowed =
          (ws?.settings as { allowSelfApproval?: boolean })?.allowSelfApproval === true;
      }
      if ((event === 'request_changes' || event === 'reject') && !opts.comment?.trim()) {
        throw new BadRequestException({ code: 'comment_required', message: 'กรุณาระบุเหตุผล' });
      }
      if (event === 'schedule') {
        const at = opts.scheduledAt;
        if (!at || at.getTime() < Date.now() + MIN_LEAD_MS) {
          throw new BadRequestException({
            code: 'schedule_too_soon',
            message: 'ต้องตั้งเวลาล่วงหน้าอย่างน้อย 1 นาที',
          });
        }
        ctx.approvedVersionIsCurrent = v.approvedVersion === v.version;
        quota = await this.dailyQuota(tx, v, at);
        if (quota?.level === 'exceeded') {
          throw new ConflictException({
            code: 'quota_exceeded',
            message: `บัญชีนี้มีโพสต์ใน 24 ชม. ครบโควตาแล้ว (${quota.limit})`,
          });
        }
      }

      const r = transitionVariant(v.status as VariantStatus, event, ctx);
      if (!r.ok) {
        const status = r.error.code === 'validation_failed' ? 422 : 409;
        const body = { code: r.error.code, status: v.status, issues };
        throw status === 422
          ? new BadRequestException(body)
          : r.error.code === 'self_approval_forbidden'
            ? new ForbiddenException(body)
            : new ConflictException(body);
      }

      const patch: Partial<typeof postVariants.$inferInsert> = {
        status: r.value.to,
        updatedAt: new Date(),
      };
      if (event === 'approve') patch.approvedVersion = v.version;
      if (event === 'schedule') patch.scheduledAt = opts.scheduledAt!;
      if (event === 'unschedule' || event === 'cancel') patch.scheduledAt = null;
      await tx.update(postVariants).set(patch).where(eq(postVariants.id, v.id));

      if (event === 'approve' || event === 'request_changes' || event === 'reject') {
        await tx.insert(approvals).values({
          workspaceId: t.workspaceId,
          variantId: v.id,
          version: v.version,
          decision:
            event === 'approve'
              ? 'approved'
              : event === 'reject'
                ? 'rejected'
                : 'changes_requested',
          reviewerId: u.userId,
          comment: opts.comment ?? null,
          policyException: r.value.policyExceptionUsed,
        });
      }
      if (r.value.cancelPendingJob) afterCommit.push(await this.cancelJobs(tx, v.id));
      if (event === 'schedule') {
        const at = opts.scheduledAt!;
        const key = idempotencyKey(v.id, v.version, at.toISOString());
        const [job] = await tx
          .insert(publishJobs)
          .values({ workspaceId: t.workspaceId, variantId: v.id, idempotencyKey: key, runAt: at })
          .onConflictDoUpdate({
            target: publishJobs.idempotencyKey,
            set: { status: 'queued', runAt: at, updatedAt: new Date() },
          })
          .returning();
        afterCommit.push(() =>
          this.queue.wakeAt(
            { publishJobId: job!.id, workspaceId: t.workspaceId },
            at,
            job!.attempts,
          ),
        );
        // ADR-0004 prepare(): an extra wake-up ahead of the slot so adapters can
        // pre-stage media (IG containers). The runner skips it instantly when the
        // adapter has no prepare(), so it costs nothing on other platforms.
        afterCommit.push(() =>
          this.queue.wakeAt(
            { publishJobId: job!.id, workspaceId: t.workspaceId, phase: 'prepare' },
            new Date(at.getTime() - this.cfg.PUBLISH_PREPARE_LEAD_SEC * 1000),
            'pre',
          ),
        );
      }

      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: `variant.${event}`,
        targetType: 'post_variant',
        targetId: v.id,
        before: { status: v.status },
        after: {
          status: r.value.to,
          version: v.version,
          comment: opts.comment,
          scheduledAt: opts.scheduledAt?.toISOString(),
          policyException: r.value.policyExceptionUsed || undefined,
        },
      });
      return { status: r.value.to, issues, quota };
    });
    for (const fn of afterCommit) await fn();
    return result;
  }

  /** PUB-10: pause every scheduled variant in one click; release later. */
  async setKillSwitch(t: TenantInfo, u: AuthUser, active: boolean) {
    return this.tx(t, u, async (tx) => {
      await tx
        .update(workspaces)
        .set({ killSwitch: active })
        .where(eq(workspaces.id, t.workspaceId));
      let affected = 0;
      if (active) {
        const rows = await tx
          .update(postVariants)
          .set({ status: 'paused', updatedAt: new Date() })
          .where(eq(postVariants.status, 'scheduled'))
          .returning({ id: postVariants.id });
        affected = rows.length;
        if (rows.length) {
          await tx
            .update(publishJobs)
            .set({ status: 'paused', updatedAt: new Date() })
            .where(
              and(
                inArray(
                  publishJobs.variantId,
                  rows.map((r) => r.id),
                ),
                inArray(publishJobs.status, ['queued', 'retrying']),
              ),
            );
        }
      }
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: active ? 'killswitch.activated' : 'killswitch.released',
        targetType: 'workspace',
        targetId: t.workspaceId,
        after: { active, affected },
      });
      return { active, paused: affected };
    });
  }

  /** PUB-10: release paused variants (one or all) after the switch is off. */
  async resume(t: TenantInfo, u: AuthUser, variantIds: string[] | 'all') {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.tx(t, u, async (tx) => {
      const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, t.workspaceId));
      if (ws?.killSwitch) {
        throw new ConflictException({ code: 'kill_switch_active', message: 'ปิด Kill Switch ก่อน' });
      }
      const paused = await tx
        .select()
        .from(postVariants)
        .where(
          and(
            eq(postVariants.status, 'paused'),
            variantIds === 'all' ? undefined : inArray(postVariants.id, variantIds),
          ),
        )
        .for('update');
      const resumed: string[] = [];
      for (const v of paused) {
        const r = transitionVariant('paused', 'resume');
        if (!r.ok) continue;
        // Missed slot while paused → publish one minute from now rather than in the past.
        const at = new Date(Math.max(v.scheduledAt?.getTime() ?? 0, Date.now() + MIN_LEAD_MS));
        await tx
          .update(postVariants)
          .set({ status: r.value.to, scheduledAt: at, updatedAt: new Date() })
          .where(eq(postVariants.id, v.id));
        const jobs = await tx
          .update(publishJobs)
          .set({ status: 'queued', runAt: at, updatedAt: new Date() })
          .where(and(eq(publishJobs.variantId, v.id), eq(publishJobs.status, 'paused')))
          .returning();
        for (const job of jobs) {
          afterCommit.push(() =>
            this.queue.wakeAt(
              { publishJobId: job.id, workspaceId: t.workspaceId },
              at,
              `${job.attempts}p${Date.now()}`,
            ),
          );
        }
        resumed.push(v.id);
      }
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'variant.resumed',
        targetType: 'workspace',
        targetId: t.workspaceId,
        after: { variantIds: resumed },
      });
      return { resumed: resumed.length };
    });
    for (const fn of afterCommit) await fn();
    return result;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async load(tx: Tx, postId: string) {
    const [post] = await tx.select().from(posts).where(eq(posts.id, postId));
    if (!post) throw new NotFoundException({ code: 'post_not_found' });
    const variants = await tx
      .select()
      .from(postVariants)
      .where(eq(postVariants.postId, postId))
      .orderBy(asc(postVariants.createdAt));
    return {
      ...post,
      variants: await Promise.all(variants.map((v) => this.withIssues(tx, v))),
    };
  }

  private async withIssues(tx: Tx, v: Variant) {
    const media = await tx
      .select({
        id: mediaAssets.id,
        kind: mediaAssets.kind,
        // validate() checks what will actually be published (MEDIA-04 / ADR-0009).
        mimeType: sql<string>`coalesce(${mediaAssets.publishMimeType}, ${mediaAssets.mimeType})`,
        sizeBytes: sql<number>`coalesce(${mediaAssets.publishSizeBytes}, ${mediaAssets.sizeBytes})`,
        width: sql<number | null>`coalesce(${mediaAssets.publishWidth}, ${mediaAssets.width})`,
        height: sql<number | null>`coalesce(${mediaAssets.publishHeight}, ${mediaAssets.height})`,
        durationSec: mediaAssets.durationSec,
      })
      .from(variantMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, variantMedia.mediaAssetId))
      .where(eq(variantMedia.variantId, v.id))
      .orderBy(asc(variantMedia.position));
    const facts: MediaFacts[] = media
      .filter((m) => m.kind !== 'document')
      .map((m) => ({
        kind: m.kind as MediaFacts['kind'],
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        width: m.width ?? undefined,
        height: m.height ?? undefined,
        durationSec: m.durationSec ?? undefined,
      }));
    const issues = validateVariant(
      {
        platform: v.platform as Platform,
        caption: v.caption,
        options: v.options as VariantDraft['options'],
      },
      facts,
    );
    return { ...v, mediaIds: media.map((m) => m.id), issues };
  }

  private async variantForUpdate(tx: Tx, id: string): Promise<Variant> {
    const [v] = await tx.select().from(postVariants).where(eq(postVariants.id, id)).for('update');
    if (!v) throw new NotFoundException({ code: 'variant_not_found' });
    return v;
  }

  private async account(tx: Tx, t: TenantInfo, accountId: string, permission: Permission) {
    const [a] = await tx.select().from(socialAccounts).where(eq(socialAccounts.id, accountId));
    if (!a) throw new NotFoundException({ code: 'account_not_found' });
    if (!canOnAccount(t.role, permission, { socialAccountIds: t.accountScope ?? [] }, a.id)) {
      throw new ForbiddenException({ code: 'account_out_of_scope' });
    }
    return a;
  }

  private async setMedia(tx: Tx, t: TenantInfo, variantId: string, mediaIds: string[]) {
    await tx.delete(variantMedia).where(eq(variantMedia.variantId, variantId));
    if (mediaIds.length === 0) return;
    const found = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, mediaIds), eq(mediaAssets.status, 'ready')));
    if (found.length !== new Set(mediaIds).size) {
      throw new BadRequestException({ code: 'media_not_ready', message: 'มีไฟล์สื่อที่ยังไม่พร้อมใช้' });
    }
    await tx.insert(variantMedia).values(
      mediaIds.map((mediaAssetId, position) => ({
        workspaceId: t.workspaceId,
        variantId,
        mediaAssetId,
        position,
      })),
    );
  }

  private async snapshot(tx: Tx, v: Variant, userId: string) {
    const media = await tx
      .select({ id: variantMedia.mediaAssetId })
      .from(variantMedia)
      .where(eq(variantMedia.variantId, v.id))
      .orderBy(asc(variantMedia.position));
    await tx.insert(variantVersions).values({
      workspaceId: v.workspaceId,
      variantId: v.id,
      version: v.version,
      snapshot: { caption: v.caption, options: v.options, mediaIds: media.map((m) => m.id) },
      editedBy: userId,
    });
  }

  /** Cancels DB jobs; returns queue removals to run after commit (never inside the tx). */
  private async cancelJobs(tx: Tx, variantId: string): Promise<() => Promise<void>> {
    const jobs = await tx
      .update(publishJobs)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(publishJobs.variantId, variantId),
          inArray(publishJobs.status, ['queued', 'retrying', 'paused']),
        ),
      )
      .returning();
    return async () => {
      for (const j of jobs) {
        await this.queue.cancel(j.id, j.attempts);
        await this.queue.cancel(j.id, 'pre');
      }
    };
  }

  /** CAL-05 / PUB-05: count other variants on the same account within ±24h of the slot. */
  private async dailyQuota(tx: Tx, v: Variant, at: Date): Promise<QuotaCheck | null> {
    const format = (v.options as { fbFormat?: string })?.fbFormat;
    const limit =
      DAILY_PUBLISH_LIMITS[`${v.platform}:any`] ?? DAILY_PUBLISH_LIMITS[`${v.platform}:${format}`];
    if (!limit) return null;
    const day = 24 * 3600_000;
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(postVariants)
      .where(
        and(
          eq(postVariants.socialAccountId, v.socialAccountId),
          inArray(postVariants.status, ['scheduled', 'publishing', 'retrying', 'published']),
          gte(postVariants.scheduledAt, new Date(at.getTime() - day)),
          lt(postVariants.scheduledAt, new Date(at.getTime() + day)),
        ),
      );
    return checkQuota(row?.n ?? 0, 1, limit);
  }
}
