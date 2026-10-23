import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PLATFORMS } from '@scm/domain';
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
import { AccountsService } from './accounts.service';

const Line = z.object({
  channelAccessToken: z.string().min(20),
  channelSecret: z.string().min(16),
});
const Meta = z.object({ userAccessToken: z.string().min(20) });
const Sandbox = z.object({ platform: z.enum(PLATFORMS), name: z.string().min(1).max(100) });

@Controller('accounts')
@UseGuards(TenantGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermission('report.view')
  list(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.accounts.list(t, u);
  }

  @Post('line')
  @RequirePermission('account.connect')
  line(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.accounts.connectLine(t, u, parseInput(Line, b));
  }

  @Post('meta')
  @RequirePermission('account.connect')
  meta(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.accounts.connectMeta(t, u, parseInput(Meta, b).userAccessToken);
  }

  @Post('sandbox')
  @RequirePermission('account.connect')
  sandbox(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    const { platform, name } = parseInput(Sandbox, b);
    return this.accounts.createSandbox(t, u, platform, name);
  }

  @Delete(':id')
  @RequirePermission('account.connect')
  disconnect(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.accounts.disconnect(t, u, id);
  }
}
