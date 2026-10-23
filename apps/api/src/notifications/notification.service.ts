import { Inject, Injectable, Logger } from '@nestjs/common';
import { notifications, type Tx } from '@scm/db';
import { type AppConfig, CONFIG } from '../config';

export type NotificationType =
  | 'publish_failed'
  | 'account_disconnected'
  | 'approval_requested'
  | 'approval_decided'
  | 'token_expiring';

export interface NotifyInput {
  workspaceId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Also alert the team LINE group (NOTI-01 internal OA). */
  teamLine?: boolean;
}

/**
 * NOTI-01/02. In-app rows are written in the caller's transaction; the LINE alert goes out
 * after commit via `flushLine()`, so a rolled-back action never pings the team.
 * Per-user preferences (NOTI-03) arrive in P2.
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  async notify(tx: Tx, n: NotifyInput): Promise<() => Promise<void>> {
    const unique = [...new Set(n.userIds)];
    if (unique.length) {
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
    return n.teamLine ? () => this.sendTeamLine(`${n.title}\n${n.body ?? ''}`.trim()) : noop;
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

const noop = async () => {};
