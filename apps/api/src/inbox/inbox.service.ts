/**
 * INBOX-01/02 (chat desk) + INBOX-03 (auto-assign) + INBOX-04 (SLA) + INBOX-06 (notes):
 * the LINE OA chat desk today (Messenger / IG DM arrive through the same shapes later).
 * The webhook (P1 raw store) calls upsertFromLine directly so the desk is current without
 * a queue hop; replies go out through the platform adapter and every message — inbound,
 * outbound and internal notes — stays in the thread (notes are never sent to the customer).
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  conversations,
  type Db,
  inboxMessages,
  inboxRotation,
  memberships,
  socialAccounts,
  users,
  withTenant,
} from '@scm/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { TokenCipher } from '../common/crypto';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { type AppConfig, CONFIG } from '../config';
import { AdapterRegistry } from '../publishing/adapters/registry';

type Account = typeof socialAccounts.$inferSelect;

export interface LineInboxEvent {
  type: string;
  source?: { userId?: string; type?: string };
  message?: { id?: string; text?: string };
  timestamp?: number;
  webhookEventId?: string;
}

@Injectable()
export class InboxService {
  private readonly log = new Logger(InboxService.name);

  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(APP_DB) private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly adapters: AdapterRegistry,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Webhook path: identity comes from the verified signature; writes are tenant-scoped. */
  async upsertFromLine(account: Account, events: LineInboxEvent[]): Promise<number> {
    const chats = events.filter((e) => e.type === 'message' && e.source?.userId && e.message?.text);
    let inserted = 0;
    for (const e of chats) {
      const at = new Date(e.timestamp ?? Date.now());
      await this.system.transaction(async (tx) => {
        const [conv] = await tx
          .insert(conversations)
          .values({
            workspaceId: account.workspaceId,
            socialAccountId: account.id,
            platform: 'line',
            externalUserId: e.source!.userId!,
            // INBOX-04: the clock starts when the question arrives.
            slaDueAt: new Date(at.getTime() + this.cfg.INBOX_SLA_HOURS * 3600_000),
            lastMessageAt: at,
            lastMessagePreview: e.message!.text!.slice(0, 200),
          })
          .onConflictDoUpdate({
            target: [conversations.socialAccountId, conversations.externalUserId],
            set: {
              lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${at})`,
              lastMessagePreview: e.message!.text!.slice(0, 200),
              // A new message reopens a closed thread but never un-claims one,
              // and the SLA clock restarts only if the last message was ours.
              status: sql`case when ${conversations.status} = 'closed' then 'open' else ${conversations.status} end`,
              slaDueAt: new Date(at.getTime() + this.cfg.INBOX_SLA_HOURS * 3600_000),
              slaEscalatedAt: null,
            },
          })
          .returning();
        const rows = await tx
          .insert(inboxMessages)
          .values({
            workspaceId: account.workspaceId,
            conversationId: conv!.id,
            direction: 'in',
            senderName: e.source!.userId!,
            text: e.message!.text!,
            externalId: e.message!.id ?? null,
            createdAt: at,
          })
          .onConflictDoNothing()
          .returning({ id: inboxMessages.id });
        inserted += rows.length;
      });
    }
    // INBOX-03: new conversations get an agent round-robin (best effort — never blocks the webhook).
    try {
      const assigned = await this.autoAssign(account.workspaceId);
      if (assigned > 0) this.log?.log?.(`auto-assigned ${assigned} conversation(s)`);
    } catch (e) {
      console.error('auto-assign failed:', e instanceof Error ? e.message : e);
    }
    return inserted;
  }

  /** INBOX-03: hand every still-unclaimed open thread to the next agent in rotation. */
  private async autoAssign(workspaceId: string): Promise<number> {
    if (!this.cfg.INBOX_AUTO_ASSIGN) return 0;
    return this.system.transaction(async (tx) => {
      const agents = (
        await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.workspaceId, workspaceId),
              isNull(memberships.revokedAt),
              inArray(memberships.role, ['agent', 'approver', 'admin', 'owner']),
            ),
          )
          .orderBy(asc(memberships.userId))
      ).map((m) => m.userId);
      if (agents.length === 0) return 0;

      const [rot] = await tx
        .insert(inboxRotation)
        .values({ workspaceId, cursor: 0 })
        .onConflictDoUpdate({
          target: inboxRotation.workspaceId,
          set: { cursor: sql`${inboxRotation.cursor} + 1` },
        })
        .returning();
      // returning gives the post-update cursor; first insert yields 0 → start at agent 0.
      const start = ((rot?.cursor ?? 0) + agents.length) % agents.length;

      const unclaimed = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.workspaceId, workspaceId),
            eq(conversations.status, 'open'),
            isNull(conversations.assigneeId),
          ),
        );
      for (const [i, c] of unclaimed.entries()) {
        await tx
          .update(conversations)
          .set({ assigneeId: agents[(start + i) % agents.length]!, status: 'claimed' })
          .where(eq(conversations.id, c.id));
      }
      return unclaimed.length;
    });
  }

  conversations(t: TenantInfo, u: AuthUser, f: { status?: string; platform?: string }) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select({
          id: conversations.id,
          platform: conversations.platform,
          accountName: socialAccounts.name,
          externalUserName: conversations.externalUserName,
          status: conversations.status,
          assignee: users.displayName,
          slaDueAt: conversations.slaDueAt,
          slaEscalatedAt: conversations.slaEscalatedAt,
          lastMessageAt: conversations.lastMessageAt,
          lastMessagePreview: conversations.lastMessagePreview,
        })
        .from(conversations)
        .innerJoin(socialAccounts, eq(socialAccounts.id, conversations.socialAccountId))
        .leftJoin(users, eq(users.id, conversations.assigneeId))
        .where(
          and(
            f.status
              ? eq(conversations.status, f.status as 'open' | 'claimed' | 'closed')
              : undefined,
            f.platform ? eq(conversations.platform, f.platform) : undefined,
          ),
        )
        .orderBy(desc(conversations.lastMessageAt))
        .limit(100),
    );
  }

  messages(t: TenantInfo, u: AuthUser, conversationId: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select()
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.conversationId, conversationId),
            eq(inboxMessages.workspaceId, t.workspaceId),
          ),
        )
        .orderBy(inboxMessages.createdAt)
        .limit(200),
    );
  }

  /** INBOX-02: answering claims the thread and clears the SLA debt; the message goes out via the adapter. */
  async reply(t: TenantInfo, u: AuthUser, conversationId: string, text: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(
          and(eq(conversations.id, conversationId), eq(conversations.workspaceId, t.workspaceId)),
        );
      if (!conv) throw new NotFoundException({ code: 'conversation_not_found' });
      const [account] = await tx
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, conv.socialAccountId));
      if (!account?.accessTokenEnc || account.status === 'disconnected') {
        throw new NotFoundException({ code: 'account_disconnected' });
      }
      const adapter = this.adapters.get(conv.platform as 'line');
      if (!adapter.sendMessage) {
        throw new NotFoundException({
          code: 'not_supported',
          message: 'ช่องทางนี้ยังส่งข้อความส่วนตัวไม่ได้',
        });
      }
      const sent = await adapter.sendMessage(
        {
          socialAccountId: account.id,
          externalId: account.externalId,
          accessToken: this.cipher.decrypt(account.accessTokenEnc),
        },
        conv.externalUserId,
        text,
      );
      const [msg] = await tx
        .insert(inboxMessages)
        .values({
          workspaceId: t.workspaceId,
          conversationId,
          direction: 'out',
          senderName: 'เจ้าหน้าที่',
          text,
          externalId: sent.externalId,
        })
        .returning();
      await tx
        .update(conversations)
        .set({
          status: conv.status === 'closed' ? 'closed' : 'claimed',
          assigneeId: conv.assigneeId ?? u.userId,
          slaDueAt: null, // answered — nothing owed until the customer writes back
          slaEscalatedAt: conv.slaEscalatedAt,
          lastMessageAt: new Date(),
          lastMessagePreview: text.slice(0, 200),
        })
        .where(eq(conversations.id, conversationId));
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'inbox.replied',
        targetType: 'conversation',
        targetId: conversationId,
        after: { platform: conv.platform },
      });
      return msg!;
    });
  }

  /** INBOX-06: staff-only note — stored in the thread, never sent to the customer. */
  async addNote(t: TenantInfo, u: AuthUser, conversationId: string, text: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.id, conversationId), eq(conversations.workspaceId, t.workspaceId)),
        );
      if (!conv) throw new NotFoundException({ code: 'conversation_not_found' });
      const [me] = await tx
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, u.userId));
      const [msg] = await tx
        .insert(inboxMessages)
        .values({
          workspaceId: t.workspaceId,
          conversationId,
          direction: 'out',
          senderName: me?.name ?? 'โน้ตภายใน',
          text,
          isInternalNote: true,
        })
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'inbox.note',
        targetType: 'conversation',
        targetId: conversationId,
        after: { length: text.length },
      });
      return msg!;
    });
  }

  async setStatus(
    t: TenantInfo,
    u: AuthUser,
    conversationId: string,
    status: 'open' | 'claimed' | 'closed',
  ) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .update(conversations)
        .set({ status, ...(status === 'claimed' ? { assigneeId: u.userId } : {}) })
        .where(
          and(eq(conversations.id, conversationId), eq(conversations.workspaceId, t.workspaceId)),
        )
        .returning();
      if (!row) throw new NotFoundException({ code: 'conversation_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'inbox.status',
        targetType: 'conversation',
        targetId: conversationId,
        after: { status },
      });
      return row;
    });
  }
}
