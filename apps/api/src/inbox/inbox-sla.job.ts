/**
 * INBOX-04: the SLA watch. Every few minutes (worker-only timer), find conversations whose
 * slaDueAt passed without a reply and escalate ONCE per breach — one team LINE push plus
 * in-app rows for the workspace's owners/admins. A reply clears slaDueAt, so answering on
 * time is the only thing staff must do.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { conversations, type Db, memberships, notifications, socialAccounts } from '@scm/db';
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';

@Injectable()
export class InboxSlaJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(InboxSlaJob.name);
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

  async tick(now = new Date()): Promise<{ escalated: number }> {
    const overdue = await this.system
      .select({
        id: conversations.id,
        workspaceId: conversations.workspaceId,
        accountName: socialAccounts.name,
        slaDueAt: conversations.slaDueAt,
      })
      .from(conversations)
      .innerJoin(socialAccounts, eq(socialAccounts.id, conversations.socialAccountId))
      .where(and(lt(conversations.slaDueAt, now), isNull(conversations.slaEscalatedAt)))
      .orderBy(asc(conversations.slaDueAt))
      .limit(50);
    if (overdue.length === 0) return { escalated: 0 };

    // Mark first (idempotent), then notify — a notification failure must not loop alerts.
    await this.system
      .update(conversations)
      .set({ slaEscalatedAt: now })
      .where(and(lt(conversations.slaDueAt, now), isNull(conversations.slaEscalatedAt)));

    const names = overdue
      .map((c) => `${c.accountName} (ครบกำหนด ${thTime(c.slaDueAt)})`)
      .join(', ');
    await this.notifications.notifySystem({
      type: 'system_alert',
      title: `⏰ SLA เกินกำหนด ${overdue.length} บทสนทนา`,
      body: `ตอบไม่ทันเวลาที่กำหนด: ${names} — กรุณาตอบหรือมอบหมายผู้รับผิดชอบ`,
      link: '/inbox',
    });
    // The workspace's owners/admins also get in-app rows (they can reassign the work).
    const byWorkspace = new Map<string, typeof overdue>();
    for (const c of overdue)
      byWorkspace.set(c.workspaceId, [...(byWorkspace.get(c.workspaceId) ?? []), c]);
    for (const [workspaceId, list] of byWorkspace) {
      const admins = await this.system
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            inArray(memberships.role, ['owner', 'admin']),
          ),
        );
      if (admins.length === 0) continue;
      await this.system.insert(notifications).values(
        admins.map((a) => ({
          workspaceId,
          userId: a.userId,
          type: 'system_alert' as const,
          channel: 'in_app' as const,
          title: `⏰ SLA เกินกำหนด ${list.length} บทสนทนา`,
          body: `ตอบไม่ทันเวลาที่กำหนด: ${list.map((c) => c.accountName).join(', ')}`,
          link: '/inbox',
          status: 'sent' as const,
          sentAt: new Date(),
        })),
      );
    }
    this.log.warn(`${overdue.length} conversation(s) breached the reply SLA`);
    return { escalated: overdue.length };
  }
}

const thTime = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d)
    : '—';
