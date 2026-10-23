/**
 * Safety net run by the worker every minute (system role, cross-tenant — ADR-0006):
 * - jobs stuck in `running` (worker crashed mid-call) → `outcome_unknown` so they reconcile
 *   instead of being retried blindly (ADR-0004);
 * - due jobs whose queue wake-up was lost (Redis flush/restore) → woken again.
 * The runner re-checks state, so an extra wake-up is harmless.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Db, publishJobs } from '@scm/db';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/core.module';
import { PublishQueue } from './queue';

const STUCK_AFTER_MS = 10 * 60_000;
const LOST_AFTER_MS = 2 * 60_000;

@Injectable()
export class SweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SweeperService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    private readonly queue: PublishQueue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep(now = new Date()) {
    const stuck = await this.system
      .update(publishJobs)
      .set({ status: 'outcome_unknown', updatedAt: now })
      .where(
        and(
          eq(publishJobs.status, 'running'),
          lt(publishJobs.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
        ),
      )
      .returning();
    const lost = await this.system
      .select()
      .from(publishJobs)
      .where(
        and(
          inArray(publishJobs.status, ['queued', 'retrying', 'outcome_unknown']),
          lt(publishJobs.runAt, new Date(now.getTime() - LOST_AFTER_MS)),
        ),
      )
      .limit(500);
    for (const j of [...stuck, ...lost]) {
      await this.queue.wakeAt(
        { publishJobId: j.id, workspaceId: j.workspaceId },
        now,
        `sweep${now.getTime()}`,
      );
    }
    if (stuck.length || lost.length) {
      this.log.warn({ stuck: stuck.length, lost: lost.length }, 'sweeper re-woke publish jobs');
    }
    return { stuck: stuck.length, lost: lost.length };
  }
}
