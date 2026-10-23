/**
 * OPS-03/04: system endpoints for monitoring.
 * - GET /metrics  Prometheus scrape (publish outcomes, queue depth, process metrics).
 *   Public on purpose: only reachable on the internal Docker network (Caddy does
 *   not proxy it); reaching it requires host access.
 * - GET /status   component health for the user-facing status page (OPS-04):
 *   db, redis (via the publish queue), object storage and queue depth.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { type Db } from '@scm/db';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.types';
import { APP_DB } from '../common/core.module';
import { StorageService } from '../media/storage.service';
import { PublishQueue } from '../publishing/queue';
import { MetricsService } from './metrics.service';

@Public()
@Controller()
export class OpsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(APP_DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly queue: PublishQueue,
  ) {}

  @Get('metrics')
  async prometheus() {
    const counts = await this.queue.counts().catch(() => null);
    if (counts) {
      this.metrics.queueWaiting.set({ state: 'waiting' }, counts.waiting ?? 0);
      this.metrics.queueWaiting.set({ state: 'delayed' }, counts.delayed ?? 0);
      this.metrics.queueWaiting.set({ state: 'active' }, counts.active ?? 0);
      this.metrics.queueWaiting.set({ state: 'failed' }, counts.failed ?? 0);
    }
    return this.metrics.render();
  }

  @Get('status')
  async status() {
    const check = async (fn: () => Promise<unknown>): Promise<'ok' | 'down'> => {
      try {
        await fn();
        return 'ok';
      } catch {
        return 'down';
      }
    };
    const [db, storage, queueCounts] = await Promise.all([
      check(() => this.db.execute(sql`select 1`)),
      check(() => this.storage.head('status/probe')), // exercises S3 connectivity
      this.queue.counts().catch(() => null),
    ]);
    const waiting = queueCounts ? (queueCounts.waiting ?? 0) + (queueCounts.delayed ?? 0) : null;
    return {
      status: db === 'ok' && storage === 'ok' ? 'ok' : 'degraded',
      components: { db, storage, queue: queueCounts ? 'ok' : 'down' },
      queue: { waiting, active: queueCounts?.active ?? null },
      time: new Date().toISOString(),
    };
  }
}
