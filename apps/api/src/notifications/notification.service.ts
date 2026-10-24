import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Db, memberships, notificationPrefs, notifications, type Tx, users } from '@scm/db';
import { and, eq, inArray } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';

export type NotificationType =
  | 'publish_failed'
  | 'account_disconnected'
  | 'approval_requested'
  | 'approval_decided'
  | 'token_expiring'
  | 'system_alert';

export interface NotifyInput {
  workspaceId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Also alert the team LINE group (NOTI-01 internal OA). */
  teamLine?: boolean;
  /** Also email the notified users (NOTI-01; needs SMTP_URL). */
  email?: boolean;
}

/**
 * NOTI-01/02. In-app rows are written in the caller's transaction; the LINE alert
 * and email go out after commit via the returned flush function, so a rolled-back
 * action never pings anyone. Per-user preferences (NOTI-03) arrive in P2.
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);
  private mailer: Transporter | null = null;

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(SYSTEM_DB) private readonly system: Db,
  ) {}

  /**
   * OPS-04: system-wide alert — in-app rows for every workspace's owners/admins
   * (cross-tenant, system role) and exactly ONE team LINE push, not one per workspace.
   */
  async notifySystem(n: {
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
  }): Promise<void> {
    const admins = await this.system
      .select({ workspaceId: memberships.workspaceId, userId: memberships.userId })
      .from(memberships)
      .where(inArray(memberships.role, ['owner', 'admin']));
    const allowed = await this.respectingPrefs(
      admins.map((a) => a.userId),
      n.type,
    );
    const recipients = admins.filter((a) => allowed.includes(a.userId));
    if (recipients.length) {
      await this.system.insert(notifications).values(
        recipients.map((a) => ({
          workspaceId: a.workspaceId,
          userId: a.userId,
          type: n.type,
          channel: 'in_app' as const,
          title: n.title,
          body: n.body ?? '',
          link: n.link ?? null,
          status: 'sent' as const,
          sentAt: new Date(),
        })),
      );
    }
    await this.sendTeamLine(`${n.title}\n${n.body ?? ''}`.trim());
  }

  async notify(tx: Tx, n: NotifyInput): Promise<() => Promise<void>> {
    const unique = await this.respectingPrefs(n.userIds, n.type);
    let emails: string[] = [];
    if (unique.length) {
      if (n.email && this.cfg.SMTP_URL) {
        // NOTI-03: email respects the per-user email toggle for this type.
        const emailAllowed = await this.respectingPrefs(unique, n.type, 'email');
        const rows = emailAllowed.length
          ? await tx
              .select({ email: users.email })
              .from(users)
              .where(inArray(users.id, emailAllowed))
          : [];
        emails = rows.map((r) => r.email);
      }
      await tx.insert(notifications).values(
        unique.map((userId) => ({
          workspaceId: n.workspaceId,
          userId,
          type: n.type,
          channel: 'in_app' as const,
          title: n.title,
          body: n.body ?? '',
          link: n.link ?? null,
          status: 'sent' as const,
          sentAt: new Date(),
        })),
      );
    }
    const line = n.teamLine ? this.sendTeamLine(`${n.title}\n${n.body ?? ''}`.trim()) : null;
    const mail =
      emails.length > 0
        ? this.sendEmail(
            emails,
            n.title,
            `${n.body ?? ''}${n.link ? `\n${this.cfg.WEB_ORIGIN}${n.link}` : ''}`,
          )
        : null;
    return async () => {
      if (line) await line;
      if (mail) await mail;
    };
  }

  /**
   * NOTI-03: keep only users who have not opted out of this type+channel. A missing pref
   * row means enabled (opt-out model). Cross-tenant by nature (other users' prefs) — the
   * caller's tx is RLS-scoped to the actor, so prefs go through the system role.
   */
  private async respectingPrefs(
    userIds: string[],
    type: NotificationType,
    channel: 'in_app' | 'email' = 'in_app',
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const prefs = await this.system
      .select({ userId: notificationPrefs.userId, enabled: notificationPrefs.enabled })
      .from(notificationPrefs)
      .where(
        and(
          inArray(notificationPrefs.userId, unique),
          eq(notificationPrefs.notificationType, type),
          eq(notificationPrefs.channel, channel),
        ),
      );
    const optedOut = new Set(prefs.filter((p) => !p.enabled).map((p) => p.userId));
    return unique.filter((id) => !optedOut.has(id));
  }

  /** NOTI-01 email channel. Dev points SMTP_URL at Mailpit; disabled when unset. */
  private async sendEmail(to: string[], subject: string, text: string): Promise<void> {
    if (!this.mailer) this.mailer = nodemailer.createTransport(this.cfg.SMTP_URL);
    try {
      const info = await this.mailer.sendMail({
        from: this.cfg.SMTP_FROM,
        to,
        subject,
        text,
      });
      this.log.log(`email sent to ${to.length} recipient(s): ${info.messageId}`);
    } catch (e) {
      this.log.error(`email to ${to.join(',')} failed: ${(e as Error).message}`);
    }
  }

  private async sendTeamLine(text: string): Promise<void> {
    const token = this.cfg.LINE_NOTIFY_CHANNEL_TOKEN;
    const to = this.cfg.LINE_NOTIFY_GROUP_ID;
    if (!token || !to) {
      this.log.warn(`team LINE not configured; alert: ${text}`);
      return;
    }
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 5000) }] }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.log.error(`team LINE push failed: HTTP ${res.status}`);
    } catch (e) {
      this.log.error(`team LINE push failed: ${(e as Error).message}`);
    }
  }
}
