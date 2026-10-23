import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { loadConfig } from '../config';
import { type MediaJobData, MediaProcessor } from './media-processor.service';
import { MEDIA_QUEUE } from './media-queue';

/** FFmpeg is CPU-heavy: keep concurrency low (MEDIA_WORKER_CONCURRENCY); scale with containers. */
@Processor(MEDIA_QUEUE, { concurrency: loadConfig().MEDIA_WORKER_CONCURRENCY })
export class MediaJobProcessor extends WorkerHost {
  constructor(private readonly processor: MediaProcessor) {
    super();
  }

  process(job: Job<MediaJobData>) {
    return this.processor.process(job.data, {
      finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    });
  }
}
