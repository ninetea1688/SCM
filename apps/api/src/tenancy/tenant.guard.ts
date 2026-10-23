import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Db, memberships, withTenant, workspaces } from '@scm/db';
import { can, type Permission, ROLES_REQUIRING_2FA, type Role } from '@scm/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { type AppRequest, PERMISSION } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { type AppConfig, CONFIG } from '../config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the workspace from the `x-workspace-id` header, loads the caller's membership
 * and enforces (1) AUTH-04 2FA for owner/admin and (2) the route's @RequirePermission.
 * Denials return 403 and are written to the audit log (AUTH AC).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = req.user!;
    const workspaceId = String(req.headers['x-workspace-id'] ?? '');
    if (!UUID.test(workspaceId)) {
      throw new ForbiddenException({ code: 'workspace_required' });
    }

    const row = await withTenant(this.db, { workspaceId, userId: user.userId }, async (tx) => {
      const [m] = await tx
        .select({
          role: memberships.role,
          accountScope: memberships.accountScope,
          killSwitch: workspaces.killSwitch,
        })
        .from(memberships)
        .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
        .where(
          and(
            eq(memberships.workspaceId, workspaceId),
            eq(memberships.userId, user.userId),
            isNull(memberships.revokedAt),
          ),
        );
      return m;
    });
    // Not a member looks identical to "does not exist" — no cross-tenant probing.
    if (!row) throw new ForbiddenException({ code: 'not_a_member' });

    const role = row.role as Role;
    req.tenant = {
      workspaceId,
      role,
      accountScope: row.accountScope ?? null,
      killSwitch: row.killSwitch,
    };

    // AUTH-04: enforcement is config-gated (off in dev/test until SSO lands — SEC-02).
    if (
      this.cfg.AUTH_ENFORCE_MFA &&
      ROLES_REQUIRING_2FA.includes(role) &&
      !(user.totpEnabled && user.mfa)
    ) {
      throw new ForbiddenException({ code: 'mfa_required_for_role' });
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (permission && !can(role, permission)) {
      await withTenant(this.db, { workspaceId, userId: user.userId }, (tx) =>
        this.audit.record(tx, {
          workspaceId,
          actorUserId: user.userId,
          action: 'permission.denied',
          targetType: 'route',
          targetId: `${req.method} ${req.route?.path ?? req.path}`,
          after: { permission, role },
          ip: req.ip ?? null,
        }),
      );
      throw new ForbiddenException({ code: 'forbidden', permission });
    }
    return true;
  }
}
