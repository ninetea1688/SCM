import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AccountMaintenanceJob } from './accounts/account-maintenance.job';
import { CoreModule } from './common/core.module';
import { pinoParams } from './common/logging';
import { type AppConfig, CONFIG, loadConfig } from './config';
import { MediaJobProcessor } from './media/media.processor';
import { MediaSweeper } from './media/media-sweeper.service';
import { PublishProcessor } from './publishing/publish.processor';
import { PublishingModule } from './publishing/publishing.module';
import { SweeperService } from './publishing/sweeper.service';
import { bullRoot } from './queue.config';
import { DataDeletionJob, DataDeletionService } from './webhooks/data-deletion.service';

/** Wires the INT-04 deletion timer with the configured interval. */
@Injectable()
export class DataDeletionTimer implements OnModuleInit, OnModuleDestroy {
  private readonly job: DataDeletionJob;

  constructor(service: DataDeletionService, @Inject(CONFIG) cfg: AppConfig) {
    this.job = new DataDeletionJob(service, cfg.DATA_DELETION_POLL_SEC);
  }

  onModuleInit() {
    this.job.start();
  }

  onModuleDestroy() {
    this.job.stop();
  }
}

/** Worker process: queue consumers and periodic system jobs. No HTTP routes. */
@Module({
  imports: [LoggerModule.forRoot(pinoParams(loadConfig())), CoreModule, bullRoot, PublishingModule],
  providers: [
    PublishProcessor,
    MediaJobProcessor,
    SweeperService,
    MediaSweeper,
    AccountMaintenanceJob,
    DataDeletionService,
    DataDeletionTimer,
  ],
})
export class WorkerModule {}
