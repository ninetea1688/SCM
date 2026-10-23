import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PublishRunner } from './publish-runner.service';
import { PUBLISH_QUEUE, type PublishJobData } from './queue';

@Processor(PUBLISH_QUEUE, { concurrency: 5 })
export class PublishProcessor extends WorkerHost {
  private readonly log = new Logger(PublishProcessor.name);

  constructor(private readonly runner: PublishRunner) {
    super();
  }

  async process(job: Job<PublishJobData>) {
    const result = await this.runner.run(job.data);
    this.log.log({ publishJobId: job.data.publishJobId, ...result }, 'publish wake-up handled');
    return result;
  }
}
