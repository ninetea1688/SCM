/**
 * INT-04: processes Meta Data Deletion Callback requests recorded by the webhook.
 *
 * What we hold about a platform end-user in P1 is the raw webhook payload of
 * their inbound events, so deletion removes every inbound event on that
 * platform whose payload references the user, then closes the request. The
 * match is a containment check over the jsonb text — payload shapes differ per
 * event type — and is scoped by platform to keep it tight.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Db, dataDeletionRequests, inboundEvents } from '@scm/db';
import { and, eq, sql } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/core.module';

@Injectable()
export class DataDeletionService {
  private readonly log = new Logger(DataDeletionService.name);

  constructor(@Inject(SYSTEM_DB) private readonly system: Db) {}

  /** One sweep of pending requests; returns how many were completed. */
  async processOnce(): Promise<number> {
    const pending = await this.system
      .select()
      .from(dataDeletionRequests)
      .where(eq(dataDeletionRequests.status, 'received'))
      .limit(50);
    let done = 0;
    for (const r of pending) {
      await this.system
        .update(dataDeletionRequests)
        .set({ status: 'processing' })
        .where(eq(dataDeletionRequests.id, r.id));
      const removed = await this.system
        .delete(inboundEvents)
        .where(
          and(
            eq(inboundEvents.platform, r.platform),
            sql`${inboundEvents.payload}::text like ${`%${r.externalUserId}%`}`,
          ),
        )
        .returning({ id: inboundEvents.id });
      await this.system
        .update(dataDeletionRequests)
        .set({ status: 'done', completedAt: new Date() })
        .where(eq(dataDeletionRequests.id, r.id));
      this.log.log(`deletion request ${r.id}: removed ${removed.length} inbound event(s)`);
      done++;
    }
    return done;
  }
}

/** Worker timer around the sweep (INT-04). */
export class DataDeletionJob {
  private readonly log = new Logger(DataDeletionJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly service: DataDeletionService,
    private readonly intervalSec: number,
  ) {}

  start() {
    this.timer = setInterval(
      () => void this.service.processOnce().catch((e) => this.log.error(e)),
      this.intervalSec * 1000,
    );
  }

  stop() {
    clearInterval(this.timer);
  }
}
