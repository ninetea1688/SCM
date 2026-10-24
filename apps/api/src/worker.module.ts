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
import { StatusWatchJob } from './health/status-watch.job';
import { StatusWatchService } from './health/status-watch.service';
import { MediaJobProcessor } from './media/media.processor';
import { MediaOrphanSweeper } from './media/media-orphan-sweeper.service';
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
    MediaOrphanSweeper,
    AccountMaintenanceJob,
    DataDeletionService,
    DataDeletionTimer,
    StatusWatchService,
    StatusWatchJob,
  ],
})
export class WorkerModule {}
