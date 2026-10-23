import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@scm/domain';
import type { Request } from 'express';

export interface AuthUser {
  userId: string;
  sessionId: string;
  /** Second factor verified for this session. */
  mfa: boolean;
  totpEnabled: boolean;
}

export interface TenantInfo {
  workspaceId: string;
  role: Role;
  accountScope: string[] | null;
  killSwitch: boolean;
}

export type AppRequest = Request & { user?: AuthUser; tenant?: TenantInfo };

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSION = 'permission';
/** Declares the permission required for a tenant route (checked by TenantGuard). */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION, p);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AppRequest>().user!,
);

export const Tenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantInfo =>
    ctx.switchToHttp().getRequest<AppRequest>().tenant!,
);
