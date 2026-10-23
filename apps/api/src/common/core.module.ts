import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, createPool, type Db } from '@scm/db';
import type pg from 'pg';
import { type AppConfig, CONFIG, loadConfig } from '../config';
import { MetricsService } from '../health/metrics.service';
import { AuditService } from './audit.service';
import { TokenCipher } from './crypto';
import { APP_DB, SYSTEM_DB } from './db-tokens';
import { QuotaRecorder } from './quota-recorder.service';

export { APP_DB, SYSTEM_DB };

/** Cross-tenant DB (role scm_system, BYPASSRLS). Only for system jobs — see ADR-0006. */
// (tokens live in ./db-tokens to avoid a circular import; re-exported above)
const POOLS = Symbol('POOLS');

@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    {
      provide: POOLS,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => ({
        app: createPool(cfg.DATABASE_URL, 10),
        system: createPool(cfg.DATABASE_SYSTEM_URL, 4),
      }),
    },
    { provide: APP_DB, inject: [POOLS], useFactory: (p: { app: pg.Pool }) => createDb(p.app) },
    {
      provide: SYSTEM_DB,
      inject: [POOLS],
      useFactory: (p: { system: pg.Pool }) => createDb(p.system),
    },
    {
      provide: TokenCipher,
      inject: [CONFIG],
      useFactory: (cfg: AppConfig) => new TokenCipher(cfg.TOKEN_ENC_KEYS),
    },
    AuditService,
    MetricsService,
    QuotaRecorder,
  ],
  exports: [CONFIG, APP_DB, SYSTEM_DB, TokenCipher, AuditService, MetricsService, QuotaRecorder],
})
export class CoreModule implements OnApplicationShutdown {
  constructor(@Inject(POOLS) private readonly pools: { app: pg.Pool; system: pg.Pool }) {}

  async onApplicationShutdown() {
    await Promise.all([this.pools.app.end(), this.pools.system.end()]);
  }
}

export type { Db };
