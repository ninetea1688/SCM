/**
 * INBOX-01/02: the LINE OA chat desk today (Messenger / IG DM arrive through the same
 * shapes later). The webhook (P1 raw store) calls upsertFromLine directly so the desk is
 * current without a queue hop; replies go out through the platform adapter and every
 * message — inbound and outbound — stays in the thread for the team.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { conversations, type Db, inboxMessages, socialAccounts, users, withTenant } from '@scm/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { TokenCipher } from '../common/crypto';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
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
  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(APP_DB) private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly adapters: AdapterRegistry,
    private readonly audit: AuditService,
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
            lastMessageAt: at,
            lastMessagePreview: e.message!.text!.slice(0, 200),
          })
          .onConflictDoUpdate({
            target: [conversations.socialAccountId, conversations.externalUserId],
            set: {
              lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${at})`,
              lastMessagePreview: e.message!.text!.slice(0, 200),
              // A new message reopens a closed thread but never un-claims one.
              status: sql`case when ${conversations.status} = 'closed' then 'open' else ${conversations.status} end`,
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
    return inserted;
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

  /** INBOX-02: answering claims the thread for the answerer; the message goes out via the adapter. */
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
