import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { type AppConfig, CONFIG } from '../config';
import type { MediaJobData } from './media-processor.service';

export const MEDIA_QUEUE = 'media';

@Injectable()
export class MediaQueue {
  constructor(
    @InjectQueue(MEDIA_QUEUE) private readonly queue: Queue<MediaJobData>,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * `slot` makes the job id unique per (re)queue: the processor skips assets that are no longer
   * `processing`, so an extra wake-up is harmless, while a lost one would strand the asset.
   */
  async enqueue(data: MediaJobData, slot: string | number = 0): Promise<void> {
    await this.queue.add('process', data, {
      jobId: `media-${data.mediaAssetId}-${slot}`,
      attempts: this.cfg.MEDIA_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}
