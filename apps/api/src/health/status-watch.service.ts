/**
 * OPS-04: watch system components on a timer (same checks as GET /status) and alert
 * the admins — in-app rows for every workspace plus ONE team LINE push — when a
 * component goes down or the queue backlog crosses its threshold. Edge-triggered:
 * one alert on ok→bad, one recovery notice on bad→ok; a still-bad system only logs.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Db } from '@scm/db';
import { sql } from 'drizzle-orm';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';
import { StorageService } from '../media/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { PublishQueue } from '../publishing/queue';

interface Health {
  db: 'ok' | 'down';
  storage: 'ok' | 'down';
  queue: 'ok' | 'down';
  backlog: number | null;
}

@Injectable()
export class StatusWatchService {
  private readonly log = new Logger(StatusWatchService.name);
  /** null = healthy; otherwise the reason the last tick found. */
  private badReason: string | null = null;

  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(SYSTEM_DB) readonly _system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly queue: PublishQueue,
    private readonly notifications: NotificationService,
  ) {}

  /** Swappable in tests: evaluate all components once. */
  async check(): Promise<Health> {
    const one = async (fn: () => Promise<unknown>): Promise<'ok' | 'down'> => {
      try {
        await fn();
        return 'ok';
      } catch {
        return 'down';
      }
    };
    const [db, storage, counts] = await Promise.all([
      one(() => this.db.execute(sql`select 1`)),
      one(() => this.storage.head('status/probe')),
      this.queue.counts().catch(() => null),
    ]);
    const backlog = counts ? (counts.waiting ?? 0) + (counts.delayed ?? 0) : null;
    return { db, storage, queue: counts ? 'ok' : 'down', backlog };
  }

  async tick(): Promise<{ bad: boolean; reason: string | null }> {
    const h = await this.check();
    const problems: string[] = [];
    if (h.db === 'down') problems.push('ฐานข้อมูลล่ม');
    if (h.storage === 'down') problems.push('Object storage เชื่อมต่อไม่ได้');
    if (h.queue === 'down') problems.push('คิวงานเชื่อมต่อไม่ได้');
    if (h.backlog !== null && h.backlog > this.cfg.STATUS_QUEUE_BACKLOG_ALERT) {
      problems.push(`คิวค้าง ${h.backlog} งาน (เกณฑ์ ${this.cfg.STATUS_QUEUE_BACKLOG_ALERT})`);
    }
    const reason = problems.join(', ') || null;

    if (reason && !this.badReason) {
      this.badReason = reason;
      await this.notifications.notifySystem({
        type: 'system_alert',
        title: `⚠️ ระบบมีปัญหา: ${reason}`,
        body: 'ตรวจสอบได้ที่หน้าสถานะระบบ',
        link: '/status',
      });
      this.log.warn(`system degraded: ${reason}`);
    } else if (!reason && this.badReason) {
      const was = this.badReason;
      this.badReason = null;
      await this.notifications.notifySystem({
        type: 'system_alert',
        title: '✅ ระบบกลับมาปกติแล้ว',
        body: `ปัญหาเดิม: ${was}`,
        link: '/status',
      });
      this.log.log('system recovered');
    } else if (reason) {
      this.log.warn(`system still degraded: ${reason}`);
    }
    return { bad: reason !== null, reason };
  }
}
