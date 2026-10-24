/** Social account connections — PRD CONN-01/02/04/06/07. */
import { createHmac } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Db, socialAccounts, withTenant } from '@scm/db';
import type { Platform } from '@scm/domain';
import { eq } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { TokenCipher } from '../common/crypto';
import { type AppConfig, CONFIG } from '../config';

type Account = typeof socialAccounts.$inferSelect;

export type Health = 'ok' | 'expiring' | 'disconnected' | 'error';

@Injectable()
export class AccountsService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly cipher: TokenCipher,
    private readonly audit: AuditService,
  ) {}

  /** CONN-06 health dashboard. Tokens never leave the server. */
  async list(t: TenantInfo, u: AuthUser) {
    const rows = await withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx.select().from(socialAccounts),
    );
    return rows.map((a) => this.view(a));
  }

  /** CONN-02. Verifies the token with LINE before storing it encrypted. */
  async connectLine(
    t: TenantInfo,
    u: AuthUser,
    input: { channelAccessToken: string; channelSecret: string },
  ) {
    const info = await this.lineBotInfo(input.channelAccessToken);
    const account = await this.upsert(t, u, {
      platform: 'line',
      externalId: info.userId,
      name: info.displayName,
      accessToken: input.channelAccessToken,
      webhookSecret: input.channelSecret,
      scopes: ['messaging'],
    });
    return {
      ...this.view(account),
      webhookUrl: `${this.cfg.PUBLIC_BASE_URL}/webhooks/line/${account.id}`,
    };
  }

  /**
   * CONN-01. The browser runs Facebook Login (ideally as a Business Manager System User) and
   * sends the short-lived user token; we exchange it for a long-lived one and store each
   * Page token (and its linked Instagram Professional account).
   */
  async connectMeta(t: TenantInfo, u: AuthUser, userAccessToken: string) {
    if (!this.cfg.META_APP_ID || !this.cfg.META_APP_SECRET) {
      throw new BadRequestException({ code: 'meta_not_configured' });
    }
    const v = this.cfg.META_GRAPH_VERSION;
    const exchange = await this.json(
      `https://graph.facebook.com/${v}/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.cfg.META_APP_ID}&client_secret=${this.cfg.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(userAccessToken)}`,
    );
    const longLived = String(exchange.access_token ?? '');
    if (!longLived) throw new BadGatewayException({ code: 'meta_exchange_failed' });
    const pages = await this.json(
      `https://graph.facebook.com/${v}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100`,
      longLived,
    );
    const out = [];
    for (const p of (pages.data ?? []) as MetaPage[]) {
      out.push(
        await this.upsert(t, u, {
          platform: 'facebook',
          externalId: p.id,
          name: p.name,
          accessToken: p.access_token,
          scopes: [],
        }),
      );
      if (p.instagram_business_account) {
        out.push(
          await this.upsert(t, u, {
            platform: 'instagram',
            externalId: p.instagram_business_account.id,
            name: p.instagram_business_account.username ?? p.name,
            accessToken: p.access_token,
            scopes: [],
          }),
        );
      }
    }
    return out.map((a) => this.view(a));
  }

  /**
   * CONN-01 OAuth dialog flow. `start` builds the Meta consent URL carrying an HMAC-signed
   * state (identity + 10-minute expiry, signed with JWT_SECRET). Meta then redirects the
   * browser to the public callback, which verifies the state, exchanges the code for a
   * short-lived user token and reuses connectMeta() — so Pages and their Instagram
   * Professional accounts all land in one round trip.
   */
  metaOAuthStart(t: TenantInfo, u: AuthUser): { redirectUrl: string } {
    if (!this.cfg.META_APP_ID || !this.cfg.META_APP_SECRET) {
      throw new BadRequestException({ code: 'meta_not_configured' });
    }
    const redirectUri = `${this.cfg.PUBLIC_BASE_URL}/api/accounts/meta/oauth/callback`;
    const payload = `${u.userId}.${t.workspaceId}.${Date.now() + 10 * 60_000}`;
    const state = `${payload}.${this.stateSignature(payload)}`;
    const scope =
      'pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish,business_management';
    const redirectUrl =
      `https://www.facebook.com/${this.cfg.META_GRAPH_VERSION}/dialog/oauth` +
      `?client_id=${encodeURIComponent(this.cfg.META_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}&response_type=code&scope=${scope}`;
    return { redirectUrl };
  }

  async metaOAuthCallback(code: string, state: string): Promise<{ redirectUrl: string }> {
    const fail = (reason: string) =>
      `${this.cfg.WEB_ORIGIN}/accounts?connected=error&reason=${reason}`;
    const parts = state.split('.');
    if (parts.length !== 4) return { redirectUrl: fail('bad_state') };
    const [userId, workspaceId, exp, sig] = parts as [string, string, string, string];
    if (this.stateSignature(`${userId}.${workspaceId}.${exp}`) !== sig) {
      return { redirectUrl: fail('bad_state') };
    }
    if (Number(exp) < Date.now()) return { redirectUrl: fail('state_expired') };
    const redirectUri = `${this.cfg.PUBLIC_BASE_URL}/api/accounts/meta/oauth/callback`;
    const j = await this.json(
      `https://graph.facebook.com/${this.cfg.META_GRAPH_VERSION}/oauth/access_token` +
        `?client_id=${encodeURIComponent(this.cfg.META_APP_ID)}` +
        `&client_secret=${encodeURIComponent(this.cfg.META_APP_SECRET)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`,
    ).catch(() => null);
    const userToken = String(j?.access_token ?? '');
    if (!userToken) return { redirectUrl: fail('exchange_failed') };
    // Identity comes from the signed state, not the request (Meta's browser has no JWT).
    const t: TenantInfo = {
      workspaceId: workspaceId!,
      role: 'admin',
      accountScope: null,
      killSwitch: false,
    };
    const u: AuthUser = { userId: userId!, sessionId: 'meta-oauth', mfa: true, totpEnabled: true };
    const added = await this.connectMeta(t, u, userToken).catch(() => null);
    if (!added) return { redirectUrl: fail('connect_failed') };
    return { redirectUrl: `${this.cfg.WEB_ORIGIN}/accounts?connected=meta&added=${added.length}` };
  }

  private stateSignature(payload: string): string {
    return createHmac('sha256', this.cfg.JWT_SECRET).update(payload).digest('base64url');
  }

  /** Dev/CI only: an account backed by the fake publisher. */
  async createSandbox(t: TenantInfo, u: AuthUser, platform: Platform, name: string) {
    if (this.cfg.PUBLISHER_MODE !== 'fake')
      throw new BadRequestException({ code: 'sandbox_disabled' });
    const a = await this.upsert(t, u, {
      platform,
      externalId: `sandbox-${platform}-${name}`,
      name,
      accessToken: 'sandbox-token',
      scopes: ['sandbox'],
    });
    return this.view(a);
  }

  async disconnect(t: TenantInfo, u: AuthUser, id: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [a] = await tx
        .update(socialAccounts)
        .set({ status: 'disconnected', accessTokenEnc: null, refreshTokenEnc: null })
        .where(eq(socialAccounts.id, id))
        .returning();
      if (!a) throw new NotFoundException({ code: 'account_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'account.disconnected',
        targetType: 'social_account',
        targetId: id,
        after: { platform: a.platform, name: a.name },
      });
      return this.view(a);
    });
  }

  private async upsert(
    t: TenantInfo,
    u: AuthUser,
    a: {
      platform: Platform;
      externalId: string;
      name: string;
      accessToken: string;
      webhookSecret?: string;
      scopes: string[];
      expiresAt?: Date;
    },
  ): Promise<Account> {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const values = {
        name: a.name,
        status: 'active' as const,
        accessTokenEnc: this.cipher.encrypt(a.accessToken),
        webhookSecretEnc: a.webhookSecret ? this.cipher.encrypt(a.webhookSecret) : null,
        tokenExpiresAt: a.expiresAt ?? null,
        scopes: a.scopes,
        connectedBy: u.userId,
        lastError: null,
        lastCheckedAt: new Date(),
      };
      const [row] = await tx
        .insert(socialAccounts)
        .values({
          workspaceId: t.workspaceId,
          platform: a.platform,
          externalId: a.externalId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [socialAccounts.workspaceId, socialAccounts.platform, socialAccounts.externalId],
          set: values,
        })
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'account.connected',
        targetType: 'social_account',
        targetId: row!.id,
        after: { platform: a.platform, name: a.name, externalId: a.externalId },
      });
      return row!;
    });
  }

  private view(a: Account) {
    const warnMs = this.cfg.TOKEN_EXPIRY_WARN_DAYS * 24 * 3600_000;
    let health: Health = 'ok';
    if (a.status === 'disconnected' || !a.accessTokenEnc) health = 'disconnected';
    else if (a.status === 'error') health = 'error';
    else if (a.tokenExpiresAt && a.tokenExpiresAt.getTime() - Date.now() < warnMs)
      health = 'expiring';
    return {
      id: a.id,
      platform: a.platform,
      name: a.name,
      externalId: a.externalId,
      kind: a.kind,
      health,
      tokenExpiresAt: a.tokenExpiresAt,
      lastError: a.lastError,
      lastCheckedAt: a.lastCheckedAt,
      scopes: a.scopes,
    };
  }

  private async lineBotInfo(token: string): Promise<{ userId: string; displayName: string }> {
    const j = await this.json('https://api.line.me/v2/bot/info', token);
    if (!j.userId) throw new BadRequestException({ code: 'line_token_invalid' });
    return { userId: String(j.userId), displayName: String(j.displayName ?? 'LINE OA') };
  }

  private async json(url: string, bearer?: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new BadGatewayException({ code: 'platform_error', status: res.status });
    return j;
  }
}

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}
