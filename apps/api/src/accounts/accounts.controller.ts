import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Db, socialAccounts, withTenant } from '@scm/db';
import { PLATFORMS } from '@scm/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
  Tenant,
  type TenantInfo,
} from '../auth/auth.types';
import { APP_DB } from '../common/core.module';
import { TokenCipher } from '../common/crypto';
import { parseInput } from '../common/zod';
import { AdapterRegistry } from '../publishing/adapters/registry';
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
  constructor(
    private readonly accounts: AccountsService,
    @Inject(APP_DB) private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly adapters: AdapterRegistry,
  ) {}

  @Get()
  @RequirePermission('report.view')
  list(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.accounts.list(t, u);
  }

  /**
   * CONN-06: live per-account quota for the health dashboard (IG 24h window, LINE
   * monthly messages). Sandbox accounts (fake publisher) and platforms without a
   * quota API answer an empty list — the UI shows "—".
   */
  @Get(':id/quota')
  @RequirePermission('report.view')
  async quota(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    const [a] = await withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx.select().from(socialAccounts).where(eq(socialAccounts.id, id)),
    );
    if (!a) throw new NotFoundException({ code: 'account_not_found' });
    if (!a.accessTokenEnc || a.status === 'disconnected') return [];
    if ((a.scopes ?? []).includes('sandbox')) return [];
    const adapter = this.adapters.get(a.platform);
    return adapter.getQuota({
      socialAccountId: a.id,
      externalId: a.externalId,
      accessToken: this.cipher.decrypt(a.accessTokenEnc),
    });
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
