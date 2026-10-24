import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
/** PRD §0 + MOD-02: workspace behaviour toggles and the moderation lists. */
const Settings = z
  .object({
    allowSelfApproval: z.boolean().optional(),
    moderation: z
      .object({
        forbiddenWords: z.array(z.string().max(100)).max(200).optional(),
        borderlineWords: z.array(z.string().max(100)).max(200).optional(),
        watchAccounts: z.array(z.string().max(100)).max(200).optional(),
      })
      .optional(),
    /** BRAND-01/02: kit + voice — read by the composer, used as AI context later. */
    brand: z
      .object({
        signature: z.string().max(500).optional(),
        defaultHashtags: z.array(z.string().max(50)).max(30).optional(),
        tone: z.string().max(300).optional(),
        voiceNotes: z.string().max(2000).optional(),
        examplePosts: z.array(z.string().max(2000)).max(10).optional(),
      })
      .optional(),
    /** CAL-06: mourning / significant-event ranges — cheerful content gets a warning. */
    mourningRanges: z
      .array(
        z.object({
          start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          note: z.string().max(200).optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();

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

  @Get('current')
  @UseGuards(TenantGuard)
  current(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.ws.current(t, u);
  }

  /** PRD §0 + role table: admins manage members, the owner owns workspace policy. */
  @Patch('current/settings')
  @UseGuards(TenantGuard)
  @RequirePermission('workspace.policy')
  updateSettings(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.ws.updateSettings(t, u, parseInput(Settings, body));
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
