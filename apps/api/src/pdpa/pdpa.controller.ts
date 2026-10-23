/** PDPA-02: data-subject request endpoints (Thai UI labels live in the web app). */
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
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
import { PdpaService } from './pdpa.service';

const Create = z.object({
  kind: z.enum(['access', 'correct', 'erase']),
  detail: z.string().max(2000).optional(),
});
const Complete = z.object({
  decision: z.enum(['done', 'rejected']),
  note: z.string().max(2000).optional(),
});

@Controller('pdpa/requests')
@UseGuards(TenantGuard)
export class PdpaController {
  constructor(private readonly pdpa: PdpaService) {}

  /** Any member may ask about their own data — no extra permission needed. */
  @Post()
  create(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.pdpa.create(t, u, parseInput(Create, b));
  }

  @Get()
  list(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.pdpa.list(t, u);
  }

  @Get(':id/export')
  export(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.pdpa.export(t, u, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('member.manage')
  complete(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.pdpa.complete(t, u, id, parseInput(Complete, b));
  }
}
