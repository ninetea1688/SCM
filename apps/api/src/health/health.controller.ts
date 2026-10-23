import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Db } from '@scm/db';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.types';
import { APP_DB } from '../common/core.module';

/** Liveness/readiness for Docker healthcheck and uptime monitor (OPS-02). */
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(APP_DB) private readonly db: Db) {}

  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'down', db: false });
    }
    return { status: 'ok', db: true, time: new Date().toISOString() };
  }
}
