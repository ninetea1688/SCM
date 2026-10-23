/**
 * PUB-05: persist live platform quota readings so usage survives restarts and can
 * be alerted/trended on. One row per (account, kind, window): rolling daily windows
 * (ig_posts_24h) anchor to the current UTC day, monthly windows (LINE) to the month,
 * and a newer reading upserts the same row. System role — the sweep is cross-tenant;
 * the caller supplies the workspace from the account row (ADR-0006).
 */
import { Inject, Injectable } from '@nestjs/common';
import { type Db, quotaUsage } from '@scm/db';
import type { QuotaInfo } from '@scm/domain';
import { sql } from 'drizzle-orm';
import { SYSTEM_DB } from './db-tokens';

export function windowAnchor(kind: string, now = new Date()): Date {
  if (kind.endsWith('_month')) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class QuotaRecorder {
  constructor(@Inject(SYSTEM_DB) private readonly system: Db) {}

  async record(
    account: { id: string; workspaceId: string },
    quotas: readonly QuotaInfo[],
  ): Promise<number> {
    if (quotas.length === 0) return 0;
    const rows = quotas.map((q) => ({
      workspaceId: account.workspaceId,
      socialAccountId: account.id,
      kind: q.kind,
      windowStart: windowAnchor(q.kind),
      used: q.used,
      quotaLimit: q.limit ?? null,
    }));
    await this.system
      .insert(quotaUsage)
      .values(rows)
      .onConflictDoUpdate({
        target: [quotaUsage.socialAccountId, quotaUsage.kind, quotaUsage.windowStart],
        set: { used: sql`excluded.used`, quotaLimit: sql`excluded.quota_limit` },
      });
    return rows.length;
  }
}
