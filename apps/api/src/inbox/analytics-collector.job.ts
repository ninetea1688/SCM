/** ANA-01: hourly engagement snapshots for every published post (worker-only timer). */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config';
import { AnalyticsService } from './analytics.service';

@Injectable()
export class AnalyticsCollectorJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AnalyticsCollectorJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly analytics: AnalyticsService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.analytics.collect().catch((e) => this.log.error(e)),
      this.cfg.ANA_SNAPSHOT_INTERVAL_SEC * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
