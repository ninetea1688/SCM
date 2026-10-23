import { Injectable } from '@nestjs/common';
import { auditLogs, events, type Tx } from '@scm/db';
import { redact } from '@scm/domain';

export interface AuditEntry {
  workspaceId: string | null;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * ADR-0007: one call writes both trails inside the caller's transaction.
 * - audit_logs: immutable compliance record with before/after (OPS-01)
 * - events: analytics stream of every action (ANA-03)
 * Values are redacted so secrets never land in either log.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, e: AuditEntry, opts: { audit?: boolean } = {}): Promise<void> {
    if (opts.audit !== false) {
      await tx.insert(auditLogs).values({
        workspaceId: e.workspaceId,
        actorUserId: e.actorUserId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId ?? null,
        before: e.before === undefined ? null : redact(e.before),
        after: e.after === undefined ? null : redact(e.after),
        ip: e.ip ?? null,
      });
    }
    await tx.insert(events).values({
      workspaceId: e.workspaceId,
      actor: e.actorUserId ?? 'system',
      action: e.action,
      objectType: e.targetType,
      objectId: e.targetId ?? null,
      payload: (redact(e.after ?? {}) as Record<string, unknown>) ?? {},
    });
  }
}
