/**
 * CONN-05/07: account health probes, token renewal and disconnect alerts.
 *
 * Probes are cheap authenticated calls (Graph `?fields=id`, LINE `/bot/info`) that
 * classify a token as ok / expired / transient. Only a proven auth failure
 * disconnects an account — transient network errors never do (ADR-0004 spirit).
 * The maintenance job (AccountMaintenanceJob, worker-only) runs hourly; the
 * PublishRunner calls the same probe during the pre-stage wake-up so a dead
 * account is reported before the slot instead of at it.
 *
 * Uses the system role (cross-tenant, BYPASSRLS — ADR-0006): these checks are
 * workspace-independent system work, never per-request tenant reads.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Db, memberships, notifications, socialAccounts } from '@scm/db';
import type { Platform } from '@scm/domain';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { TokenCipher } from '../common/crypto';
import { SYSTEM_DB } from '../common/db-tokens';
import { QuotaRecorder } from '../common/quota-recorder.service';
import { type AppConfig, CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';
import type { AdapterRegistry } from '../publishing/adapters/registry';

export type Probe = 'ok' | 'expired' | 'transient';

type Account = typeof socialAccounts.$inferSelect;

/** Graph auth codes (matches adapters/graph.ts) and LINE 401 mean "reconnect". */
const GRAPH_AUTH_CODES = new Set([10, 102, 190, 200]);

/** Platforms whose adapters expose a live quota API worth persisting (PUB-05). */
const QUOTA_PLATFORMS: ReadonlySet<string> = new Set(['facebook', 'instagram', 'line']);

@Injectable()
export class AccountHealthService {
  private readonly log = new Logger(AccountHealthService.name);
  /** Swappable in tests; production uses global fetch. */
  probeFetch: typeof fetch = fetch;

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly cipher: TokenCipher,
    private readonly notifications: NotificationService,
    // Optional: only the publishing wiring can fetch live quotas; bare test
    // constructions (probe unit tests) skip the PUB-05 recording below.
    @Optional() private readonly adapters?: AdapterRegistry,
    @Optional() private readonly recorder?: QuotaRecorder,
  ) {}

  /** One authenticated call. Never throws — a network failure is `transient`. */
  async probe(a: Account, fetchFn: typeof fetch = this.probeFetch): Promise<Probe> {
    if ((a.scopes ?? []).includes('sandbox')) return 'ok'; // fake publisher, no platform
    if (!a.accessTokenEnc) return 'expired';
    let token: string;
    try {
      token = this.cipher.decrypt(a.accessTokenEnc);
    } catch {
      return 'expired'; // unreadable envelope (rotated key) — treat as dead token
    }
    try {
      if (a.platform === 'facebook' || a.platform === 'instagram') {
        const res = await fetchFn(
          `https://graph.facebook.com/${this.cfg.META_GRAPH_VERSION}/${a.externalId}?fields=id`,
          { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
        );
        if (res.ok) return 'ok';
        const j = (await res.json().catch(() => ({}))) as { error?: { code?: number } };
        return GRAPH_AUTH_CODES.has(j.error?.code ?? 0) ? 'expired' : 'transient';
      }
      if (a.platform === 'line') {
        const res = await fetchFn('https://api.line.me/v2/bot/info', {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return 'ok';
        return res.status === 401 ? 'expired' : 'transient';
      }
      return 'ok'; // tiktok/youtube adapters are P2; nothing to probe yet
    } catch {
      return 'transient';
    }
  }

  /**
   * Probe + persist. An `expired` verdict disconnects the account and alerts the
   * workspace immediately (CONN-07): in-app rows for owners/admins + team LINE.
   */
  async checkAccount(a: Account, fetchFn: typeof fetch = this.probeFetch): Promise<Probe> {
    const verdict = await this.probe(a, fetchFn);
    if (verdict === 'ok') {
      await this.refreshIfExpiring(a);
      await this.system
        .update(socialAccounts)
        .set({ lastCheckedAt: new Date(), ...(a.status !== 'active' ? { status: 'active' } : {}) })
        .where(eq(socialAccounts.id, a.id));
      await this.warnIfExpiring(a); // NOTI-02
      return verdict;
    }
    if (verdict === 'transient') {
      await this.system
        .update(socialAccounts)
        .set({ lastCheckedAt: new Date() })
        .where(eq(socialAccounts.id, a.id));
      return verdict;
    }
    await this.markDisconnected(a, 'โทเคนหมดอายุหรือถูกเพิกถอน กรุณาเชื่อมต่อใหม่');
    return verdict;
  }

  /** CONN-05 maintenance sweep: every active account, cross-tenant (system role). */
  async runMaintenance(fetchFn: typeof fetch = this.probeFetch): Promise<{
    checked: number;
    disconnected: number;
    quotasRecorded: number;
  }> {
    const rows = await this.system.select().from(socialAccounts);
    let disconnected = 0;
    let quotasRecorded = 0;
    for (const a of rows) {
      if (a.status === 'disconnected') continue;
      const verdict = await this.checkAccount(a, fetchFn);
      if (verdict === 'expired') disconnected++;
      if (verdict === 'ok') quotasRecorded += await this.recordQuotas(a); // PUB-05
    }
    return { checked: rows.length, disconnected, quotasRecorded };
  }

  /** Persist the platform's live reading for healthy, non-sandbox accounts. */
  private async recordQuotas(a: Account): Promise<number> {
    if (
      !this.adapters ||
      !this.recorder ||
      !QUOTA_PLATFORMS.has(a.platform) ||
      (a.scopes ?? []).includes('sandbox') ||
      !a.accessTokenEnc
    ) {
      return 0;
    }
    try {
      const quotas = await this.adapters.get(a.platform as Platform).getQuota({
        socialAccountId: a.id,
        externalId: a.externalId,
        accessToken: this.cipher.decrypt(a.accessTokenEnc),
      });
      return await this.recorder.record({ id: a.id, workspaceId: a.workspaceId }, quotas);
    } catch (e) {
      this.log.debug(`quota read for ${a.id} failed: ${String(e)}`);
      return 0;
    }
  }

  /**
   * CONN-05 renewal hook: Meta long-lived user tokens can be re-exchanged with
   * fb_exchange_token. Page tokens (what connectMeta stores today) do not expire,
   * so this only runs for accounts carrying a near tokenExpiresAt — e.g. tokens
   * issued with an explicit expiry later. A failed refresh is not an auth verdict;
   * the probe above decides health.
   */
  private async refreshIfExpiring(a: Account): Promise<void> {
    const metaLike: Platform[] = ['facebook', 'instagram'];
    if (
      !metaLike.includes(a.platform as Platform) ||
      !a.tokenExpiresAt ||
      a.tokenExpiresAt.getTime() - Date.now() > this.cfg.TOKEN_EXPIRY_WARN_DAYS * 24 * 3600_000 ||
      !this.cfg.META_APP_ID ||
      !this.cfg.META_APP_SECRET
    ) {
      return;
    }
    try {
      const token = this.cipher.decrypt(a.accessTokenEnc!);
      const url =
        `https://graph.facebook.com/${this.cfg.META_GRAPH_VERSION}/oauth/access_token` +
        `?grant_type=fb_exchange_token&client_id=${this.cfg.META_APP_ID}` +
        `&client_secret=${this.cfg.META_APP_SECRET}&fb_exchange_token=${encodeURIComponent(token)}`;
      const res = await this.probeFetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return;
      const j = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!j.access_token) return;
      await this.system
        .update(socialAccounts)
        .set({
          accessTokenEnc: this.cipher.encrypt(j.access_token),
          tokenExpiresAt: j.expires_in
            ? new Date(Date.now() + j.expires_in * 1000)
            : a.tokenExpiresAt,
        })
        .where(eq(socialAccounts.id, a.id));
      this.log.log(`refreshed near-expiry token for account ${a.id}`);
    } catch (e) {
      this.log.warn(`token refresh for account ${a.id} failed: ${String(e)}`);
    }
  }

  /**
   * NOTI-02: a token inside the warn window gets an in-app + team LINE + email alert
   * to owners/admins, deduped to at most one per account per day (the sweep runs hourly).
   */
  private async warnIfExpiring(a: Account): Promise<void> {
    if (
      !a.tokenExpiresAt ||
      a.tokenExpiresAt.getTime() - Date.now() > this.cfg.TOKEN_EXPIRY_WARN_DAYS * 24 * 3600_000
    ) {
      return;
    }
    const link = `/accounts#${a.id}`;
    const recent = await this.system
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'token_expiring'),
          eq(notifications.link, link),
          gt(notifications.sentAt, new Date(Date.now() - 24 * 3600_000)),
        ),
      )
      .limit(1);
    if (recent.length) return;
    const after: (() => Promise<void>)[] = [];
    await this.system.transaction(async (tx) => {
      const admins = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, a.workspaceId),
            inArray(memberships.role, ['owner', 'admin']),
          ),
        );
      after.push(
        await this.notifications.notify(tx, {
          workspaceId: a.workspaceId,
          userIds: admins.map((m) => m.userId),
          type: 'token_expiring',
          title: `โทเคนบัญชี ${a.name} ใกล้หมดอายุ`,
          body: 'กรุณาเชื่อมต่อใหม่ก่อนโทเคนหมดอายุ เพื่อไม่ให้การโพสต์สะดุด',
          // The account fragment is the dedupe key (one alert per account per day).
          link: `/accounts#${a.id}`,
          teamLine: true,
          email: true,
        }),
      );
    });
    for (const fn of after) await fn();
    this.log.log(`warned owners/admins about the expiring token of account ${a.id}`);
  }

  /** Disconnect + immediate alert (CONN-07). System tx: worker context has no tenant. */
  private async markDisconnected(a: Account, reason: string) {
    const after: (() => Promise<void>)[] = [];
    await this.system.transaction(async (tx) => {
      await tx
        .update(socialAccounts)
        .set({ status: 'disconnected', lastError: reason, lastCheckedAt: new Date() })
        .where(eq(socialAccounts.id, a.id));
      const admins = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.workspaceId, a.workspaceId),
            inArray(memberships.role, ['owner', 'admin']),
          ),
        );
      after.push(
        await this.notifications.notify(tx, {
          workspaceId: a.workspaceId,
          userIds: admins.map((m) => m.userId),
          type: 'account_disconnected',
          title: `บัญชี ${a.name} หลุดการเชื่อมต่อ`,
          body: reason,
          link: '/accounts',
          teamLine: true,
          email: true, // NOTI-01
        }),
      );
    });
    for (const fn of after) await fn();
  }
}
