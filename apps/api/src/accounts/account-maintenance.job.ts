/**
 * CONN-05: the hourly maintenance job. Worker-only provider (same pattern as
 * SweeperService): a timer around AccountHealthService.runMaintenance().
 */
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config';
import { AccountHealthService } from './account-health.service';

@Injectable()
export class AccountMaintenanceJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AccountMaintenanceJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly health: AccountHealthService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.run().catch((e) => this.log.error(e)),
      this.cfg.ACCOUNT_CHECK_INTERVAL_SEC * 1000,
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run() {
    const r = await this.health.runMaintenance();
    if (r.disconnected) this.log.warn(`${r.disconnected} account(s) disconnected`);
    return r;
  }
}
