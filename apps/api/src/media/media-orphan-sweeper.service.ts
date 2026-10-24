/**
 * MEDIA-08 (ADR-0008, PDPA retention): stored bytes of failed/abandoned assets must not
 * live forever. Every MEDIA_ORPHAN_SWEEP_SEC (worker process, system role):
 *   - `uploading` older than MEDIA_UPLOAD_ABANDON_MIN (the presigned PUT expired long ago)
 *     → object deleted, row deleted (nothing can reference a non-ready asset)
 *   - `failed` assets with bytes still stored → original + renditions deleted, the row
 *     stays for audit with `orphanCleanedAt` set (the sweeper then skips it)
 * Ready assets are never touched.
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Db, mediaAssets } from '@scm/db';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';
import { StorageService } from './storage.service';

@Injectable()
export class MediaOrphanSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MediaOrphanSweeper.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.sweep().catch((e) => this.log.error(e)),
      this.cfg.MEDIA_ORPHAN_SWEEP_SEC * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async sweep(now = new Date()): Promise<{ uploadsDeleted: number; failedCleaned: number }> {
    // 1. Abandoned uploads: presign TTL (≤ 15 min default) is long past.
    const abandoned = await this.system
      .delete(mediaAssets)
      .where(
        and(
          eq(mediaAssets.status, 'uploading'),
          lt(
            mediaAssets.createdAt,
            new Date(now.getTime() - this.cfg.MEDIA_UPLOAD_ABANDON_MIN * 60_000),
          ),
        ),
      )
      .returning({ id: mediaAssets.id, storageKey: mediaAssets.storageKey });
    for (const a of abandoned) await this.storage.delete(a.storageKey);

    // 2. Failed assets: delete every stored object, keep the row for audit.
    const failed = await this.system
      .select({
        id: mediaAssets.id,
        storageKey: mediaAssets.storageKey,
        thumbnailKey: mediaAssets.thumbnailKey,
        previewKey: mediaAssets.previewKey,
        publishKey: mediaAssets.publishKey,
      })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.status, 'failed'), isNull(mediaAssets.orphanCleanedAt)));
    for (const a of failed) {
      for (const key of [a.storageKey, a.thumbnailKey, a.previewKey, a.publishKey]) {
        if (key) await this.storage.delete(key);
      }
      await this.system
        .update(mediaAssets)
        .set({ orphanCleanedAt: now })
        .where(eq(mediaAssets.id, a.id));
    }

    if (abandoned.length || failed.length) {
      this.log.warn(
        { uploadsDeleted: abandoned.length, failedCleaned: failed.length },
        'media orphan sweeper acted',
      );
    }
    return { uploadsDeleted: abandoned.length, failedCleaned: failed.length };
  }
}
