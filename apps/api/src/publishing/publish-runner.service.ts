/**
 * Executes one PublishJob wake-up. PRD PUB-01..07, APPR-01 AC, ADR-0004.
 *
 * Three phases so no DB transaction is held open across a platform HTTP call:
 *   1. claim   (tx)  — re-check everything; mark running
 *   2. call    (no tx) — reconcile if the last outcome was unknown, then publish
 *   3. record  (tx)  — attempts, job + variant state, audit/event, notifications
 * Side effects that must not happen on rollback (queue wake-ups, LINE alerts) run after commit.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  approvals,
  type Db,
  mediaAssets,
  memberships,
  postVariants,
  publishAttempts,
  publishJobs,
  socialAccounts,
  type Tx,
  variantMedia,
  withTenant,
  workspaces,
} from '@scm/db';
import {
  type AttemptOutcome,
  type AttemptTrace,
  DEFAULT_RETRY_POLICY,
  nextStep,
  type Platform,
  type PublishRequest,
  type RetryPolicy,
  type SignedMedia,
  transitionVariant,
  type VariantDraft,
  type VariantEvent,
  type VariantStatus,
} from '@scm/domain';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { TokenCipher } from '../common/crypto';
import { StorageService } from '../media/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { AdapterRegistry } from './adapters/registry';
import { type PublishJobData, PublishQueue } from './queue';

export type RunResult =
  | { status: 'skipped'; reason: string }
  | { status: 'succeeded' | 'retrying' | 'outcome_unknown' | 'failed' };

const RUNNABLE = ['queued', 'retrying', 'outcome_unknown'] as const;
const MAX_RECONCILE_CHECKS = 5;

type Job = typeof publishJobs.$inferSelect;
type Variant = typeof postVariants.$inferSelect;

interface Claimed {
  job: Job;
  variant: Variant;
  req: PublishRequest;
  reconcileFirst: boolean;
  policy: RetryPolicy;
  blocked?: AttemptOutcome;
}

@Injectable()
export class PublishRunner {
  private readonly log = new Logger(PublishRunner.name);

  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly adapters: AdapterRegistry,
    private readonly cipher: TokenCipher,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly queue: PublishQueue,
  ) {}

  async run(data: PublishJobData): Promise<RunResult> {
    const claimed = await withTenant(this.db, { workspaceId: data.workspaceId }, (tx) =>
      this.claim(tx, data),
    );
    if ('skip' in claimed) return { status: 'skipped', reason: claimed.skip };

    const { req, reconcileFirst } = claimed;
    if (claimed.blocked)
      return this.record(data, claimed, [], claimed.blocked, { publishAttempted: true });
    const adapter = this.adapters.get(req.variant.platform);
    const attempts: RecordedAttempt[] = [];
    let outcome: AttemptOutcome | null = null;

    if (reconcileFirst) {
      const startedAt = new Date();
      try {
        const found = await adapter.reconcile(req);
        attempts.push({
          kind: 'reconcile',
          outcome: found ? 'success' : 'absent',
          startedAt,
          trace: {},
        });
        outcome = found;
      } catch (e) {
        attempts.push({ kind: 'reconcile', outcome: 'unknown', startedAt, trace: {} });
        outcome = {
          kind: 'unknown',
          errorCode: 'reconcile_failed',
          errorMessage: (e as Error).message,
        };
        return this.record(data, claimed, attempts, outcome, { publishAttempted: false });
      }
    }

    let publishAttempted = false;
    if (!outcome) {
      const startedAt = new Date();
      const res = await adapter.publish({ ...req, attemptStartedAt: startedAt });
      publishAttempted = true;
      attempts.push({ kind: 'publish', outcome: res.outcome.kind, startedAt, trace: res.trace });
      outcome = res.outcome;
    }
    return this.record(data, claimed, attempts, outcome, { publishAttempted });
  }

  // ── phase 1 ────────────────────────────────────────────────────────────────

  private async claim(tx: Tx, data: PublishJobData): Promise<Claimed | { skip: string }> {
    const [job] = await tx
      .select()
      .from(publishJobs)
      .where(eq(publishJobs.id, data.publishJobId))
      .for('update');
    if (!job || !(RUNNABLE as readonly string[]).includes(job.status)) {
      return { skip: `job_${job?.status ?? 'missing'}` };
    }
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, job.workspaceId));
    const [variant] = await tx
      .select()
      .from(postVariants)
      .where(eq(postVariants.id, job.variantId))
      .for('update');
    if (!ws || !variant) return { skip: 'variant_missing' };

    const vStatus = variant.status as VariantStatus;
    const reconcileFirst = job.status === 'outcome_unknown';
    const expected: VariantStatus[] = reconcileFirst ? ['publishing'] : ['scheduled', 'retrying'];
    if (!expected.includes(vStatus)) {
      await tx
        .update(publishJobs)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(publishJobs.id, job.id));
      return { skip: `variant_${vStatus}` };
    }

    // PUB-10: never start while the Kill Switch is on (an in-flight unknown still reconciles).
    if (ws.killSwitch && !reconcileFirst) {
      if (vStatus === 'scheduled') await this.setVariant(tx, variant, 'pause');
      await tx
        .update(publishJobs)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(eq(publishJobs.id, job.id));
      return { skip: 'kill_switch' };
    }

    // APPR-01 AC, defence in depth: the exact version must carry an approval record.
    const [approval] = await tx
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          eq(approvals.variantId, variant.id),
          eq(approvals.version, variant.version),
          eq(approvals.decision, 'approved'),
        ),
      )
      .limit(1);
    if (!approval || variant.approvedVersion !== variant.version) {
      await tx
        .update(publishJobs)
        .set({
          status: 'failed',
          errorCode: 'not_approved',
          errorMessage: 'ไม่มีบันทึกการอนุมัติของเวอร์ชันนี้',
          updatedAt: new Date(),
        })
        .where(eq(publishJobs.id, job.id));
      this.log.error(`job ${job.id} reached the runner without approval — blocked`);
      return { skip: 'not_approved' };
    }

    const [account] = await tx
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, variant.socialAccountId));
    // A disconnected account fails loudly (notify) instead of silently waiting (CONN-07).
    const blocked: AttemptOutcome | undefined =
      !account?.accessTokenEnc || account.status === 'disconnected'
        ? {
            kind: 'permanent',
            errorCode: 'account_disconnected',
            errorMessage: 'บัญชีหลุดการเชื่อมต่อ กรุณาเชื่อมต่อใหม่แล้วตั้งเวลาอีกครั้ง',
          }
        : undefined;

    if (!reconcileFirst) await this.setVariant(tx, variant, 'start');
    await tx
      .update(publishJobs)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(publishJobs.id, job.id));

    const mediaRows = await tx
      .select({ asset: mediaAssets })
      .from(variantMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, variantMedia.mediaAssetId))
      .where(eq(variantMedia.variantId, variant.id))
      .orderBy(asc(variantMedia.position));
    const media: SignedMedia[] = [];
    for (const { asset } of mediaRows) {
      if (asset.kind === 'document') continue;
      media.push({
        mediaAssetId: asset.id,
        kind: asset.kind,
        // MEDIA-04 / ADR-0009: platforms get the converted copy, never the raw original.
        mimeType: asset.publishMimeType ?? asset.mimeType,
        sizeBytes: asset.publishSizeBytes ?? asset.sizeBytes,
        width: asset.publishWidth ?? asset.width ?? undefined,
        height: asset.publishHeight ?? asset.height ?? undefined,
        durationSec: asset.durationSec ?? undefined,
        url: await this.storage.presignGet(asset.publishKey ?? asset.storageKey),
        expiresAt: new Date(Date.now() + 3600_000),
      });
    }

    const [lastPublish] = await tx
      .select({ startedAt: publishAttempts.startedAt })
      .from(publishAttempts)
      .where(and(eq(publishAttempts.jobId, job.id), eq(publishAttempts.kind, 'publish')))
      .orderBy(desc(publishAttempts.startedAt))
      .limit(1);

    const settings = (ws.settings ?? {}) as { retryPolicy?: Partial<RetryPolicy> };
    return {
      job,
      variant,
      reconcileFirst,
      blocked,
      policy: { ...DEFAULT_RETRY_POLICY, ...settings.retryPolicy },
      req: {
        jobId: job.id,
        idempotencyKey: job.idempotencyKey,
        variant: {
          platform: variant.platform as Platform,
          caption: variant.caption,
          options: variant.options as VariantDraft['options'],
        },
        media,
        account: {
          socialAccountId: variant.socialAccountId,
          externalId: account?.externalId ?? '',
          accessToken: blocked ? '' : this.cipher.decrypt(account!.accessTokenEnc!),
        },
        attemptStartedAt: lastPublish?.startedAt ?? new Date(),
      },
    };
  }

  // ── phase 3 ────────────────────────────────────────────────────────────────

  private async record(
    data: PublishJobData,
    claimed: Claimed,
    attempts: RecordedAttempt[],
    outcome: AttemptOutcome,
    opts: { publishAttempted: boolean },
  ): Promise<RunResult> {
    const after: (() => Promise<void>)[] = [];
    const result = await withTenant(this.db, { workspaceId: data.workspaceId }, async (tx) => {
      const [job] = await tx
        .select()
        .from(publishJobs)
        .where(eq(publishJobs.id, claimed.job.id))
        .for('update');
      const [variant] = await tx
        .select()
        .from(postVariants)
        .where(eq(postVariants.id, claimed.variant.id))
        .for('update');
      if (!job || !variant) return { status: 'skipped', reason: 'vanished' } as const;

      const attemptNo = job.attempts + (opts.publishAttempted ? 1 : 0);
      for (const a of attempts) {
        await tx.insert(publishAttempts).values({
          workspaceId: data.workspaceId,
          jobId: job.id,
          attempt: attemptNo,
          kind: a.kind,
          outcome: a.outcome,
          httpStatus: a.trace.httpStatus ?? null,
          request: a.trace.request ?? null,
          response: a.trace.response ?? null,
          startedAt: a.startedAt,
        });
      }

      let step = nextStep(attemptNo, outcome, claimed.policy);
      if (step.action === 'reconcile') {
        const [checks] = await tx
          .select({ n: count() })
          .from(publishAttempts)
          .where(and(eq(publishAttempts.jobId, job.id), eq(publishAttempts.kind, 'reconcile')));
        if ((checks?.n ?? 0) >= MAX_RECONCILE_CHECKS)
          step = { action: 'give_up', status: 'failed' };
      }
      // An absent reconcile followed by a publish that ran means attempts already counted.
      const base = { attempts: attemptNo, updatedAt: new Date() };
      const errorFields =
        outcome.kind === 'success'
          ? { errorCode: null, errorMessage: null }
          : { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };

      switch (step.action) {
        case 'complete': {
          if (outcome.kind !== 'success') throw new Error('unreachable');
          await tx
            .update(publishJobs)
            .set({
              ...base,
              ...errorFields,
              status: 'succeeded',
              externalPostId: outcome.externalPostId,
              permalink: outcome.permalink ?? null,
            })
            .where(eq(publishJobs.id, job.id));
          await this.setVariant(tx, variant, 'succeed', {
            externalPostId: outcome.externalPostId,
            permalink: outcome.permalink ?? null,
            publishedAt: new Date(),
          });
          await this.audit.record(tx, {
            workspaceId: data.workspaceId,
            actorUserId: null,
            action: 'variant.published',
            targetType: 'post_variant',
            targetId: variant.id,
            after: { externalPostId: outcome.externalPostId, platform: variant.platform },
          });
          return { status: 'succeeded' } as const;
        }
        case 'retry': {
          const runAt = new Date(Date.now() + step.delayMs);
          await tx
            .update(publishJobs)
            .set({ ...base, ...errorFields, status: 'retrying', runAt })
            .where(eq(publishJobs.id, job.id));
          await this.setVariant(tx, variant, 'fail_retryable');
          after.push(() => this.queue.wakeAt(data, runAt, attemptNo));
          return { status: 'retrying' } as const;
        }
        case 'reconcile': {
          const runAt = new Date(Date.now() + step.delayMs);
          await tx
            .update(publishJobs)
            .set({ ...base, ...errorFields, status: 'outcome_unknown', runAt })
            .where(eq(publishJobs.id, job.id));
          // Variant stays `publishing` until we know.
          after.push(() => this.queue.wakeAt(data, runAt, `${attemptNo}r${attempts.length}`));
          return { status: 'outcome_unknown' } as const;
        }
        case 'give_up': {
          await tx
            .update(publishJobs)
            .set({ ...base, ...errorFields, status: 'failed' })
            .where(eq(publishJobs.id, job.id));
          await this.setVariant(tx, variant, 'fail_permanent');
          await this.audit.record(tx, {
            workspaceId: data.workspaceId,
            actorUserId: null,
            action: 'variant.publish_failed',
            targetType: 'post_variant',
            targetId: variant.id,
            after: errorFields,
          });
          after.push(await this.notifyFailure(tx, data.workspaceId, variant, errorFields));
          return { status: 'failed' } as const;
        }
      }
    });
    for (const fn of after) await fn();
    return result;
  }

  /** PUB AC: owner of the work + approvers alerted (in-app now, LINE right after commit). */
  private async notifyFailure(
    tx: Tx,
    workspaceId: string,
    variant: Variant,
    e: { errorCode: string | null; errorMessage: string | null },
  ) {
    const approvers = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspaceId),
          inArray(memberships.role, ['owner', 'admin', 'approver']),
        ),
      );
    return this.notifications.notify(tx, {
      workspaceId,
      userIds: [variant.lastEditedBy, ...approvers.map((a) => a.userId)],
      type: 'publish_failed',
      title: `โพสต์ไป ${variant.platform} ไม่สำเร็จ`,
      body: `${e.errorMessage ?? ''} (${e.errorCode ?? ''})`,
      link: `/posts/${variant.postId}`,
      teamLine: true,
    });
  }

  private async setVariant(
    tx: Tx,
    variant: Variant,
    event: VariantEvent,
    extra: Partial<typeof postVariants.$inferInsert> = {},
  ) {
    const r = transitionVariant(variant.status as VariantStatus, event);
    if (!r.ok) throw new Error(`variant ${variant.id}: ${JSON.stringify(r.error)}`);
    await tx
      .update(postVariants)
      .set({ ...extra, status: r.value.to, updatedAt: new Date() })
      .where(eq(postVariants.id, variant.id));
    variant.status = r.value.to;
  }
}

interface RecordedAttempt {
  kind: 'publish' | 'reconcile';
  outcome: 'success' | 'retryable' | 'permanent' | 'unknown' | 'absent';
  startedAt: Date;
  trace: AttemptTrace;
}
