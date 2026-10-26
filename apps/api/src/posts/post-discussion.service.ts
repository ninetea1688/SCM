/**
 * APPR-03: internal discussion on a post (editor ↔ approver dialogue) — team-only,
 * never sent to any platform. Plus the APPR-04 reminder job for approvals stuck
 * in review past APPROVAL_REMIND_HOURS (one reminder per variant per day).
 */
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type Db,
  memberships,
  notifications,
  postInternalComments,
  posts,
  postVariants,
  users,
  withTenant,
} from '@scm/db';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';

export const InternalCommentInput = z.object({ text: z.string().min(1).max(2000) });

@Injectable()
export class PostDiscussionService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(t: TenantInfo, u: AuthUser, postId: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      await this.postOr404(tx, t.workspaceId, postId);
      return tx
        .select({
          id: postInternalComments.id,
          author: users.displayName,
          text: postInternalComments.text,
          createdAt: postInternalComments.createdAt,
        })
        .from(postInternalComments)
        .innerJoin(users, eq(users.id, postInternalComments.userId))
        .where(eq(postInternalComments.postId, postId))
        .orderBy(asc(postInternalComments.createdAt))
        .limit(200);
    });
  }

  async add(t: TenantInfo, u: AuthUser, postId: string, text: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      await this.postOr404(tx, t.workspaceId, postId);
      const [me] = await tx
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, u.userId));
      const [row] = await tx
        .insert(postInternalComments)
        .values({ workspaceId: t.workspaceId, postId, userId: u.userId, text })
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'post.commented',
        targetType: 'post',
        targetId: postId,
        after: { length: text.length },
      });
      return { ...row!, author: me?.name ?? '' };
    });
  }

  private async postOr404(
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    ws: string,
    postId: string,
  ) {
    const [post] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, postId), eq(posts.workspaceId, ws)));
    if (!post) throw new NotFoundException({ code: 'post_not_found' });
  }
}

@Injectable()
export class ApprovalReminderJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ApprovalReminderJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    private readonly notifications: NotificationService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick().catch((e) => this.log.error(e)),
      Math.min(this.cfg.STATUS_WATCH_INTERVAL_SEC, 300) * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** APPR-04: remind once per variant per day while it sits in review too long. */
  async tick(now = new Date(), workspaceId?: string): Promise<{ reminded: number }> {
    const cutoff = new Date(now.getTime() - this.cfg.APPROVAL_REMIND_HOURS * 3600_000);
    const stuck = await this.system
      .select({
        id: postVariants.id,
        postId: postVariants.postId,
        title: posts.title,
        updatedAt: postVariants.updatedAt,
        workspaceId: posts.workspaceId,
      })
      .from(postVariants)
      .innerJoin(posts, eq(posts.id, postVariants.postId))
      .where(
        and(
          eq(postVariants.status, 'in_review'),
          lt(postVariants.updatedAt, cutoff),
          // Scoped call (tests, manual re-run) stays hermetic against other workspaces' backlog.
          workspaceId ? eq(posts.workspaceId, workspaceId) : undefined,
        ),
      )
      .orderBy(asc(postVariants.updatedAt)) // oldest backlog first
      .limit(500);

    let reminded = 0;
    for (const v of stuck) {
      const [latest] = await this.system
        .select({ sentAt: notifications.sentAt })
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'approval_reminder'),
            eq(notifications.link, `/posts/${v.postId}`),
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(1);
      // One reminder per variant per day.
      if (latest?.sentAt && now.getTime() - latest.sentAt.getTime() < 24 * 3600_000) continue;

      await this.notifications.notifySystem({
        type: 'approval_reminder',
        title: `🔔 งานรออนุมัติค้างนาน: ${v.title}`,
        body: 'ส่งตรวจมาแล้วยังไม่ถูกอนุมัติภายในเวลาที่กำหนด',
        link: `/posts/${v.postId}`,
      });
      const admins = await this.system
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, v.workspaceId),
            inArray(memberships.role, ['owner', 'admin', 'approver']),
          ),
        );
      if (admins.length) {
        await this.system.insert(notifications).values(
          admins.map((a) => ({
            workspaceId: v.workspaceId,
            userId: a.userId,
            type: 'approval_reminder' as const,
            channel: 'in_app' as const,
            title: `🔔 งานรออนุมัติค้างนาน: ${v.title}`,
            body: 'ส่งตรวจมาแล้วยังไม่ถูกอนุมัติภายในเวลาที่กำหนด',
            link: `/posts/${v.postId}`,
            status: 'sent' as const,
            sentAt: now,
          })),
        );
      }
      reminded++;
    }
    if (reminded) this.log.warn(`${reminded} stuck approval(s) reminded`);
    return { reminded };
  }
}
