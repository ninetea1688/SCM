import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const PUBLISH_QUEUE = 'publish';

export interface PublishJobData {
  publishJobId: string;
  workspaceId: string;
  /**
   * Which wake-up this is. `prepare` is the ADR-0004 pre-stage wake-up ahead of the
   * slot: it may only create media containers, never publish. Absent = publish.
   */
  phase?: 'prepare';
}

/**
 * PUB-01: our own scheduler — a delayed BullMQ job per PublishJob. The DB row is the
 * source of truth; the queue entry is only a wake-up call, so the runner re-checks state
 * and a stale/duplicate wake-up is harmless.
 */
@Injectable()
export class PublishQueue {
  constructor(@InjectQueue(PUBLISH_QUEUE) private readonly queue: Queue<PublishJobData>) {}

  async wakeAt(data: PublishJobData, runAt: Date, attempt: number | string = 0): Promise<void> {
    await this.queue.add('publish', data, {
      jobId: `${data.publishJobId}-${attempt}`,
      delay: Math.max(0, runAt.getTime() - Date.now()),
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Best effort: the runner ignores wake-ups for jobs that are no longer runnable. */
  async cancel(publishJobId: string, attempt: number | string): Promise<void> {
    await this.queue.remove(`${publishJobId}-${attempt}`).catch(() => undefined);
  }
}
