/**
 * ANA-01/02 skeleton: engagement snapshots per published post. Snapshots are append-only
 * (never overwrite) and every platform's native numbers are mapped to the central names
 * (reach / likes / comments / shares). The collector runs on a worker timer and can be
 * triggered on demand; live platform insights land with ANA-01 proper (needs the Meta App).
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type Db,
  postMetrics,
  posts,
  postVariants,
  publishJobs,
  socialAccounts,
  withTenant,
} from '@scm/db';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
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
}
