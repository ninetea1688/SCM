/**
 * ADR-0008: no asset stays in `processing` forever (Redis hiccup after commit, worker crash,
 * killed job). Every minute (worker process, system role — cross-tenant by nature):
 *   in `processing` longer than MEDIA_STUCK_AFTER_MIN → re-enqueue (counted, clock restarts)
 *   already re-queued MAX_REQUEUES times               → failed, with a Thai reason
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Db, mediaAssets } from '@scm/db';
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/core.module';
import { type AppConfig, CONFIG } from '../config';
import { MediaQueue } from './media-queue';

export const MAX_REQUEUES = 3;

@Injectable()
export class MediaSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MediaSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly queue: MediaQueue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep(now = new Date()) {
    const due = and(
      eq(mediaAssets.status, 'processing'),
      lt(
        mediaAssets.processingStartedAt,
        new Date(now.getTime() - this.cfg.MEDIA_STUCK_AFTER_MIN * 60_000),
      ),
    );
    const failed = await this.system
      .update(mediaAssets)
      .set({
        status: 'failed',
        processingError: 'ประมวลผลไฟล์นานเกินกำหนด กรุณาอัปโหลดใหม่อีกครั้ง',
        processedAt: now,
      })
      .where(and(due, gte(mediaAssets.processingRequeues, MAX_REQUEUES)))
      .returning({ id: mediaAssets.id });
    const stuck = await this.system
      .update(mediaAssets)
      .set({
        processingStartedAt: now,
        processingRequeues: sql`${mediaAssets.processingRequeues} + 1`,
      })
      .where(and(due, lte(mediaAssets.processingRequeues, MAX_REQUEUES - 1)))
      .returning({ id: mediaAssets.id, workspaceId: mediaAssets.workspaceId });
    for (const a of stuck) {
      await this.queue.enqueue(
        { mediaAssetId: a.id, workspaceId: a.workspaceId },
        `sweep${now.getTime()}`,
      );
    }
    if (failed.length || stuck.length) {
      this.log.warn({ requeued: stuck.length, failed: failed.length }, 'media sweeper acted');
    }
    return { requeued: stuck.length, failed: failed.length };
  }
}
