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
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Db, memberships, socialAccounts } from '@scm/db';
import type { Platform } from '@scm/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { SYSTEM_DB } from '../common/core.module';
import { TokenCipher } from '../common/crypto';
import { type AppConfig, CONFIG } from '../config';
import { NotificationService } from '../notifications/notification.service';

export type Probe = 'ok' | 'expired' | 'transient';

type Account = typeof socialAccounts.$inferSelect;

/** Graph auth codes (matches adapters/graph.ts) and LINE 401 mean "reconnect". */
const GRAPH_AUTH_CODES = new Set([10, 102, 190, 200]);

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
  }> {
    const rows = await this.system.select().from(socialAccounts);
    let disconnected = 0;
    for (const a of rows) {
      if (a.status === 'disconnected') continue;
      const verdict = await this.checkAccount(a, fetchFn);
      if (verdict === 'expired') disconnected++;
    }
    return { checked: rows.length, disconnected };
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
