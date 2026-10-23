import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ROLES } from '@scm/domain';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
  Tenant,
  type TenantInfo,
} from '../auth/auth.types';
import { parseInput } from '../common/zod';
import { TenantGuard } from '../tenancy/tenant.guard';
import { WorkspacesService } from './workspaces.service';

const Create = z.object({ name: z.string().min(1).max(200) });
const Member = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  accountScope: z.array(z.uuid()).optional(),
});
const Revoke = z.object({ allSessions: z.stringbool().default(true) });

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly ws: WorkspacesService) {}

  @Get()
  mine(@CurrentUser() u: AuthUser) {
    return this.ws.mine(u);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.ws.create(u, parseInput(Create, body).name);
  }

  @Get('current/members')
  @UseGuards(TenantGuard)
  @RequirePermission('member.manage')
  members(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.ws.members(t, u);
  }

  @Put('current/members')
  @UseGuards(TenantGuard)
  @RequirePermission('member.manage')
  addMember(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.ws.addMember(t, u, parseInput(Member, body));
  }

  @Delete('current/members/:userId')
  @UseGuards(TenantGuard)
  @RequirePermission('member.manage')
  revoke(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('userId') userId: string,
    @Query() q: unknown,
  ) {
    return this.ws.revokeMember(t, u, userId, parseInput(Revoke, q));
  }

  @Get('current/audit-log')
  @UseGuards(TenantGuard)
  @RequirePermission('audit.view')
  audit(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.ws.auditLog(t, u);
  }
}
