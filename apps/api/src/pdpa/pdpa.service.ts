/**
 * PDPA-02: data-subject requests (ขอดู / ขอแก้ / ขอลบ) for our own users.
 *
 * Any member can file a request about their own data and export it as JSON
 * (machine-readable "ขอดู"). Owners/admins work the queue; completing an
 * `erase` request deletes the user's notification copies in this workspace —
 * the audited business records (posts, approvals) stay, and full account
 * removal stays a manual owner action documented in the handled note.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Db, memberships, notifications, pdpaRequests, users, withTenant } from '@scm/db';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';

export type PdpaKind = 'access' | 'correct' | 'erase';

@Injectable()
export class PdpaService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async create(t: TenantInfo, u: AuthUser, input: { kind: PdpaKind; detail?: string }) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .insert(pdpaRequests)
        .values({
          workspaceId: t.workspaceId,
          userId: u.userId,
          kind: input.kind,
          detail: input.detail ?? null,
        })
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'pdpa.requested',
        targetType: 'pdpa_request',
        targetId: row!.id,
        after: { kind: input.kind },
      });
      return row!;
    });
  }

  /** Own requests for everyone; the whole queue for owner/admin. */
  async list(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select()
        .from(pdpaRequests)
        .where(
          t.role === 'owner' || t.role === 'admin' ? undefined : eq(pdpaRequests.userId, u.userId),
        )
        .orderBy(desc(pdpaRequests.createdAt))
        .limit(200),
    );
  }

  /** PDPA-02 "ขอดู": machine-readable export of the requester's own data. */
  async export(t: TenantInfo, u: AuthUser, id: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [r] = await tx.select().from(pdpaRequests).where(eq(pdpaRequests.id, id));
      if (!r) throw new NotFoundException({ code: 'pdpa_not_found' });
      if (r.userId !== u.userId) throw new NotFoundException({ code: 'pdpa_not_found' });
      const [profile] = await tx
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, u.userId));
      const myMemberships = await tx
        .select({ workspaceId: memberships.workspaceId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, u.userId));
      const myNotifications = await tx
        .select({
          type: notifications.type,
          title: notifications.title,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, u.userId))
        .orderBy(desc(notifications.createdAt))
        .limit(100);
      return {
        request: { id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt },
        profile,
        memberships: myMemberships,
        notifications: myNotifications,
        exportedAt: new Date().toISOString(),
      };
    });
  }

  /** Owner/admin closes a request; `erase` + done also removes the user's copies here. */
  async complete(
    t: TenantInfo,
    u: AuthUser,
    id: string,
    input: { decision: 'done' | 'rejected'; note?: string },
  ) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [r] = await tx.select().from(pdpaRequests).where(eq(pdpaRequests.id, id));
      if (!r) throw new NotFoundException({ code: 'pdpa_not_found' });
      if (input.decision === 'done' && r.kind === 'erase') {
        await tx
          .delete(notifications)
          .where(
            and(eq(notifications.workspaceId, t.workspaceId), eq(notifications.userId, r.userId)),
          );
      }
      const [row] = await tx
        .update(pdpaRequests)
        .set({
          status: input.decision === 'done' ? 'done' : 'rejected',
          handledBy: u.userId,
          handledNote: input.note ?? null,
          handledAt: new Date(),
        })
        .where(eq(pdpaRequests.id, id))
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'pdpa.handled',
        targetType: 'pdpa_request',
        targetId: id,
        after: { decision: input.decision, kind: r.kind },
      });
      return row!;
    });
  }
}
