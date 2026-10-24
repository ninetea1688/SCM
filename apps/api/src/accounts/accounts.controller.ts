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
import { QuotaRecorder } from '../common/quota-recorder.service';
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
    private readonly recorder: QuotaRecorder,
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
    const a = await this.credsFor(t, u, id);
    if (!a) return [];
    const quotas = await this.adapters.get(a.credentials.platform).getQuota(a.credentials);
    await this.recorder.record({ id: a.row.id, workspaceId: a.row.workspaceId }, quotas); // PUB-05
    return quotas;
  }

  /**
   * PUB-08: what a send would consume, shown before the user confirms a LINE
   * broadcast/narrowcast. `recipients` is LINE's targeted reach of yesterday;
   * null when the platform has no insight (or the account is sandbox).
   */
  @Get(':id/publish-preview')
  @RequirePermission('report.view')
  async publishPreview(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
  ) {
    const a = await this.credsFor(t, u, id);
    if (a?.row.platform !== 'line') return { recipients: null, quota: [] };
    // LINE's insight API answers per day; yesterday is the newest complete one.
    const ymd = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
    const adapter = this.adapters.get('line');
    const [recipients, quota] = await Promise.all([
      adapter.followerCount ? adapter.followerCount(a.credentials, ymd).catch(() => null) : null,
      adapter.getQuota(a.credentials).catch(() => []),
    ]);
    return { recipients, quota };
  }

  /** Account row + decrypted credentials, or null when there is nothing live to ask. */
  private async credsFor(t: TenantInfo, u: AuthUser, id: string) {
    const [a] = await withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx.select().from(socialAccounts).where(eq(socialAccounts.id, id)),
    );
    if (!a) throw new NotFoundException({ code: 'account_not_found' });
    if (!a.accessTokenEnc || a.status === 'disconnected') return null;
    if ((a.scopes ?? []).includes('sandbox')) return null;
    return {
      row: a,
      credentials: {
        platform: a.platform,
        socialAccountId: a.id,
        externalId: a.externalId,
        accessToken: this.cipher.decrypt(a.accessTokenEnc),
      },
    };
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

  /** CONN-01: the Meta consent-dialog URL; the web /session route sends the browser here. */
  @Get('meta/oauth/start')
  @RequirePermission('account.connect')
  metaOauthStart(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.accounts.metaOAuthStart(t, u);
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
