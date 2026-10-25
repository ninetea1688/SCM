/**
 * ANA-01/02 skeleton: engagement snapshots per published post. Snapshots are append-only
 * (never overwrite) and every platform's native numbers are mapped to the central names
 * (reach / likes / comments / shares). The collector runs on a worker timer and can be
 * triggered on demand; live platform insights land with ANA-01 proper (needs the Meta App).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  conversations,
  type Db,
  inboxMessages,
  kpiGoals,
  mediaAssets,
  postMetrics,
  posts,
  postVariants,
  publishJobs,
  quotaUsage,
  socialAccounts,
  withTenant,
} from '@scm/db';
import { and, asc, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { TokenCipher } from '../common/crypto';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { AdapterRegistry } from '../publishing/adapters/registry';

const dayMs = 24 * 3600_000;

@Injectable()
export class AnalyticsService {
  private readonly log = new Logger(AnalyticsService.name);

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(APP_DB) private readonly db: Db,
    private readonly cipher: TokenCipher,
    // Optional so tests can build the service without the publishing wiring.
    @Optional() private readonly adapters?: AdapterRegistry,
  ) {}

  /** One snapshot per (account, external post) per day; adapters without insights are skipped. */
  async collect(now = new Date()): Promise<{ captured: number; skipped: number }> {
    const succeeded = await this.system
      .select({
        workspaceId: publishJobs.workspaceId,
        variantId: publishJobs.variantId,
        externalPostId: publishJobs.externalPostId,
      })
      .from(publishJobs)
      .where(and(eq(publishJobs.status, 'succeeded'), isNotNull(publishJobs.externalPostId)));
    let captured = 0;
    let skipped = 0;
    for (const job of succeeded) {
      const [variant] = await this.system
        .select({
          workspaceId: postVariants.workspaceId,
          platform: postVariants.platform,
          socialAccountId: postVariants.socialAccountId,
          postId: postVariants.postId,
        })
        .from(postVariants)
        .where(eq(postVariants.id, job.variantId!));
      if (!variant) continue;
      const [account] = await this.system
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, variant.socialAccountId));
      if (!account?.accessTokenEnc) continue;
      if (!this.adapters) continue;
      const adapter = this.adapters.get(variant.platform as 'facebook');
      if (!adapter.getInsights) {
        skipped++;
        continue;
      }
      // ANA-01: one snapshot per day is enough for trends; the job runs hourly.
      const [today] = await this.system
        .select({ id: postMetrics.id })
        .from(postMetrics)
        .where(
          and(
            eq(postMetrics.socialAccountId, variant.socialAccountId),
            eq(postMetrics.externalPostId, job.externalPostId!),
            gte(postMetrics.capturedAt, new Date(now.getTime() - dayMs)),
          ),
        )
        .limit(1);
      if (today) continue;
      try {
        const m = await adapter.getInsights(
          {
            socialAccountId: account.id,
            externalId: account.externalId,
            accessToken: this.cipher.decrypt(account.accessTokenEnc),
          },
          job.externalPostId!,
        );
        if (!m) {
          skipped++;
          continue;
        }
        await this.system.insert(postMetrics).values({
          workspaceId: variant.workspaceId,
          socialAccountId: variant.socialAccountId,
          platform: variant.platform,
          postId: variant.postId!,
          externalPostId: job.externalPostId!,
          reach: m.reach,
          likes: m.likes,
          comments: m.comments,
          shares: m.shares,
          capturedAt: now,
        });
        captured++;
      } catch (e) {
        this.log.warn(`insights for ${job.externalPostId} failed: ${String(e)}`);
        skipped++;
      }
    }
    return { captured, skipped };
  }

  /**
   * ANA-05 first cut: aggregates for the monitoring layers we have data for
   * (1 ผลงานคอนเทนต์, 3 การสนทนา, 6 ทีม/workflow, 7 ระบบ, 8 ต้นทุน) — layers
   * ผู้ติดตาม/บอท/พันธมิตร arrive with their P3 integrations.
   */
  async dashboard(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      // Layer 1 — content performance (latest snapshot per post × platform).
      const perfRows = await tx
        .select({
          postId: postMetrics.postId,
          platform: postMetrics.platform,
          reach: postMetrics.reach,
          likes: postMetrics.likes,
          comments: postMetrics.comments,
          shares: postMetrics.shares,
        })
        .from(postMetrics)
        .orderBy(desc(postMetrics.capturedAt))
        .limit(500);
      const latest = new Map<string, (typeof perfRows)[number]>();
      for (const r of perfRows) {
        const key = `${r.postId}:${r.platform}`;
        if (!latest.has(key)) latest.set(key, r);
      }
      let reach = 0;
      let likes = 0;
      let comments = 0;
      let shares = 0;
      for (const r of latest.values()) {
        reach += r.reach;
        likes += r.likes;
        comments += r.comments;
        shares += r.shares;
      }
      const content = {
        posts: latest.size,
        reach,
        likes,
        comments,
        shares,
        engagement: likes + comments + shares,
        engagementRate:
          reach > 0 ? Math.round(((likes + comments + shares) / reach) * 1000) / 10 : null,
      };

      // Layer 3 — conversations & service.
      const convs = await tx
        .select({
          status: conversations.status,
          n: sql<number>`count(*)::int`,
        })
        .from(conversations)
        .groupBy(conversations.status);
      const byStatus = Object.fromEntries(convs.map((c) => [c.status, c.n]));
      const [msgCounts] = await tx
        .select({
          received: sql<number>`count(*) filter (where ${inboxMessages.direction} = 'in' and ${inboxMessages.isInternalNote} = false)::int`,
          sent: sql<number>`count(*) filter (where ${inboxMessages.direction} = 'out' and ${inboxMessages.isInternalNote} = false)::int`,
        })
        .from(inboxMessages);

      // Layer 6 — team & workflow.
      const statusRows = await tx
        .select({ status: postVariants.status, n: sql<number>`count(*)::int` })
        .from(postVariants)
        .groupBy(postVariants.status);
      const byVariantStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));

      // Layer 7 — system (published jobs success rate + tokens near expiry).
      const jobRows = await tx
        .select({ status: publishJobs.status, n: sql<number>`count(*)::int` })
        .from(publishJobs)
        .groupBy(publishJobs.status);
      const jobsByStatus = Object.fromEntries(jobRows.map((r) => [r.status, r.n]));
      const finished = (jobsByStatus['succeeded'] ?? 0) + (jobsByStatus['failed'] ?? 0);
      const successRate =
        finished > 0 ? Math.round(((jobsByStatus['succeeded'] ?? 0) / finished) * 1000) / 10 : null;
      const [tokens] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(socialAccounts)
        .where(
          and(
            eq(socialAccounts.status, 'active'),
            sql`${socialAccounts.tokenExpiresAt} is not null and ${socialAccounts.tokenExpiresAt} < now() + interval '7 days'`,
          ),
        );

      // Layer 8 — cost: LINE monthly quota (latest reading) + storage bytes.
      const [quota] = await tx
        .select({ used: quotaUsage.used, limit: quotaUsage.quotaLimit })
        .from(quotaUsage)
        .where(eq(quotaUsage.kind, 'line_messages_month'))
        .orderBy(desc(quotaUsage.windowStart))
        .limit(1);
      const [storage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)::bigint` })
        .from(mediaAssets);

      return {
        content,
        conversations: {
          total: convs.reduce((a, c) => a + c.n, 0),
          open: byStatus['open'] ?? 0,
          claimed: byStatus['claimed'] ?? 0,
          closed: byStatus['closed'] ?? 0,
          received: msgCounts?.received ?? 0,
          sent: msgCounts?.sent ?? 0,
        },
        workflow: {
          inReview: byVariantStatus['in_review'] ?? 0,
          scheduled: byVariantStatus['scheduled'] ?? 0,
          published: byVariantStatus['published'] ?? 0,
          failed: byVariantStatus['failed'] ?? 0,
        },
        system: {
          publishSuccessRate: successRate,
          publishFailed: jobsByStatus['failed'] ?? 0,
          tokenExpiring: tokens?.n ?? 0,
        },
        cost: {
          lineMessages: quota ? { used: quota.used, limit: quota.limit } : null,
          storageBytes: Number(storage?.bytes ?? 0),
        },
      };
    });
  }

  /** Per post × platform, using each one's newest snapshot; engagement = interactions / reach. */
  async overview(t: TenantInfo, u: AuthUser, f: { platform?: string }) {
    const rows = await withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select({
          postId: postMetrics.postId,
          postTitle: posts.title,
          platform: postMetrics.platform,
          accountName: socialAccounts.name,
          externalPostId: postMetrics.externalPostId,
          capturedAt: postMetrics.capturedAt,
          reach: postMetrics.reach,
          likes: postMetrics.likes,
          comments: postMetrics.comments,
          shares: postMetrics.shares,
        })
        .from(postMetrics)
        .innerJoin(posts, eq(posts.id, postMetrics.postId))
        .innerJoin(socialAccounts, eq(socialAccounts.id, postMetrics.socialAccountId))
        .where(f.platform ? eq(postMetrics.platform, f.platform) : undefined)
        .orderBy(desc(postMetrics.capturedAt))
        .limit(1000),
    );
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const key = `${r.postId}:${r.platform}`;
      if (!latest.has(key)) latest.set(key, r); // rows are newest-first
    }
    return [...latest.values()]
      .map((r) => {
        const engagement = r.likes + r.comments + r.shares;
        return {
          ...r,
          engagement,
          engagementRate: r.reach > 0 ? Math.round((engagement / r.reach) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => (b.engagementRate ?? -1) - (a.engagementRate ?? -1));
  }

  /** ANA-06: KPI targets, keyed metric×platform. */
  goals(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx.select().from(kpiGoals).orderBy(asc(kpiGoals.metric)),
    );
  }

  static GoalInput = z.object({
    goals: z
      .array(
        z.object({
          metric: z.enum(['reach', 'engagement_rate', 'posts', 'conversations']),
          platform: z.string().max(20).default('all'),
          target: z.number().int().min(0).max(100_000_000),
        }),
      )
      .max(40),
  });

  async setGoals(
    t: TenantInfo,
    u: AuthUser,
    goals: { metric: string; platform: string; target: number }[],
  ) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      for (const g of goals) {
        await tx
          .insert(kpiGoals)
          .values({
            workspaceId: t.workspaceId,
            metric: g.metric as 'reach' | 'engagement_rate' | 'posts' | 'conversations',
            platform: g.platform,
            target: g.target,
            updatedBy: u.userId,
          })
          .onConflictDoUpdate({
            target: [kpiGoals.workspaceId, kpiGoals.metric, kpiGoals.platform],
            set: { target: g.target, updatedBy: u.userId, updatedAt: new Date() },
          });
      }
      return this.goals(t, u);
    });
  }
}
