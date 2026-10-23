/**
 * OPS-04: the periodic system-health watch. Worker-only provider (same pattern as
 * AccountMaintenanceJob): a timer around StatusWatchService.tick().
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config';
import { StatusWatchService } from './status-watch.service';

@Injectable()
export class StatusWatchJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(StatusWatchJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly watch: StatusWatchService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.watch.tick().catch((e) => this.log.error(e)),
      this.cfg.STATUS_WATCH_INTERVAL_SEC * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    return this.watch.tick();
  }
}
