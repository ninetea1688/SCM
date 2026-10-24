/** Workspaces and memberships — PRD AUTH-01/02/03/06/07. */

import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  auditLogs,
  type Db,
  memberships,
  socialAccounts,
  users,
  withTenant,
  withUser,
  workspaces,
} from '@scm/db';
import { MIN_OWNERS, ownerChangeAllowed, type Role } from '@scm/domain';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  mine(u: AuthUser) {
    return withUser(this.db, u.userId, (tx) =>
      tx
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: memberships.role,
          killSwitch: workspaces.killSwitch,
        })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(and(eq(memberships.userId, u.userId), isNull(memberships.revokedAt))),
    );
  }

  async create(u: AuthUser, name: string) {
    const id = randomUUID();
    return withTenant(this.db, { workspaceId: id, userId: u.userId }, async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ id, name }).returning();
      await tx.insert(memberships).values({ workspaceId: id, userId: u.userId, role: 'owner' });
      await this.audit.record(tx, {
        workspaceId: id,
        actorUserId: u.userId,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: id,
        after: { name },
      });
      return { ...ws!, ownersNeeded: MIN_OWNERS - 1 };
    });
  }

  members(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select({
          userId: users.id,
          email: users.email,
          displayName: users.displayName,
          role: memberships.role,
          accountScope: memberships.accountScope,
          totpEnabled: users.totpEnabled,
          revokedAt: memberships.revokedAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.workspaceId, t.workspaceId)),
    );
  }

  /** PRD §0: workspace behaviour lives in a configurable settings object, not in code. */
  async current(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [ws] = await tx
        .select({ id: workspaces.id, name: workspaces.name, settings: workspaces.settings })
        .from(workspaces)
        .where(eq(workspaces.id, t.workspaceId));
      if (!ws) throw new NotFoundException({ code: 'workspace_not_found' });
      return { ...ws, role: t.role };
    });
  }

  async updateSettings(
    t: TenantInfo,
    u: AuthUser,
    patch: {
      allowSelfApproval?: boolean;
      moderation?: {
        forbiddenWords?: string[];
        borderlineWords?: string[];
        watchAccounts?: string[];
      };
    },
  ) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [ws] = await tx
        .select({ settings: workspaces.settings })
        .from(workspaces)
        .where(eq(workspaces.id, t.workspaceId));
      const before = (ws!.settings ?? {}) as Record<string, unknown>;
      const after = {
        ...before,
        ...(patch.allowSelfApproval !== undefined
          ? { allowSelfApproval: patch.allowSelfApproval }
          : {}),
        ...(patch.moderation
          ? {
              moderation: {
                ...((before.moderation as Record<string, unknown>) ?? {}),
                ...patch.moderation,
              },
            }
          : {}),
      };
      await tx.update(workspaces).set({ settings: after }).where(eq(workspaces.id, t.workspaceId));
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'workspace.settings',
        targetType: 'workspace',
        targetId: t.workspaceId,
        before,
        after,
      });
      return after;
    });
  }

  async addMember(
    t: TenantInfo,
    u: AuthUser,
    input: { email: string; role: Role; accountScope?: string[] },
  ) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [target] = await tx
        .select()
        .from(users)
        .where(eq(users.email, input.email.toLowerCase()));
      if (!target) throw new NotFoundException({ code: 'user_not_found' });
      if (input.role === 'owner' && t.role !== 'owner') {
        throw new BadRequestException({ code: 'only_owner_can_add_owner' });
      }
      await tx
        .insert(memberships)
        .values({
          workspaceId: t.workspaceId,
          userId: target.id,
          role: input.role,
          accountScope: input.accountScope ?? null,
        })
        .onConflictDoUpdate({
          target: [memberships.workspaceId, memberships.userId],
          set: { role: input.role, accountScope: input.accountScope ?? null, revokedAt: null },
        });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'member.upserted',
        targetType: 'user',
        targetId: target.id,
        after: input,
      });
      return { userId: target.id, role: input.role };
    });
  }

  /**
   * AUTH-07: revoke immediately (+ optionally every session of that person) and report the
   * social accounts they connected, so the team can reconnect them under the organisation.
   * AUTH-06: refuses to drop below the owner minimum.
   */
  async revokeMember(t: TenantInfo, u: AuthUser, userId: string, opts: { allSessions: boolean }) {
    const result = await withTenant(
      this.db,
      { workspaceId: t.workspaceId, userId: u.userId },
      async (tx) => {
        const [m] = await tx
          .select()
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, t.workspaceId),
              eq(memberships.userId, userId),
              isNull(memberships.revokedAt),
            ),
          );
        if (!m) throw new NotFoundException({ code: 'member_not_found' });
        if (m.role === 'owner') {
          const [owners] = await tx
            .select({ n: count() })
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, t.workspaceId),
                eq(memberships.role, 'owner'),
                isNull(memberships.revokedAt),
              ),
            );
          if (!ownerChangeAllowed(owners?.n ?? 0, -1)) {
            throw new ConflictException({
              code: 'min_owners',
              message: `Workspace ต้องมีเจ้าของอย่างน้อย ${MIN_OWNERS} คน`,
            });
          }
        }
        await tx
          .update(memberships)
          .set({ revokedAt: new Date() })
          .where(and(eq(memberships.workspaceId, t.workspaceId), eq(memberships.userId, userId)));
        const connected = await tx
          .select({
            id: socialAccounts.id,
            platform: socialAccounts.platform,
            name: socialAccounts.name,
          })
          .from(socialAccounts)
          .where(eq(socialAccounts.connectedBy, userId));
        await this.audit.record(tx, {
          workspaceId: t.workspaceId,
          actorUserId: u.userId,
          action: 'member.revoked',
          targetType: 'user',
          targetId: userId,
          before: { role: m.role },
          after: { allSessions: opts.allSessions, connectedAccounts: connected.length },
        });
        return { revoked: true, connectedAccounts: connected };
      },
    );
    const sessionsRevoked = opts.allSessions ? await this.auth.revokeAllSessions(userId) : 0;
    return { ...result, sessionsRevoked };
  }

  auditLog(t: TenantInfo, u: AuthUser, limit = 100) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.workspaceId, t.workspaceId))
        .orderBy(desc(auditLogs.id))
        .limit(Math.min(limit, 500)),
    );
  }
}
