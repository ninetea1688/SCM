/**
 * INBOX-01 comment desk: Facebook Page comments arrive through the Meta webhook and are
 * linked to our posts via publish_jobs.external_post_id, so the desk is per post × platform.
 * Replies go out through the platform adapter; hiding is recorded locally for now (the
 * platform-side hide call lands with the Meta App work).
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type Db,
  postComments,
  posts,
  postVariants,
  publishJobs,
  socialAccounts,
  withTenant,
  workspaces,
} from '@scm/db';
import { classifyComment, DEFAULT_MODERATION, type ModerationConfig } from '@scm/domain';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { TokenCipher } from '../common/crypto';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { AdapterRegistry } from '../publishing/adapters/registry';

type Account = typeof socialAccounts.$inferSelect;

export interface MetaFeedChange {
  field: string;
  value: {
    item?: string;
    verb?: string;
    comment_id?: string;
    post_id?: string;
    parent_id?: string;
    from_name?: string;
    message?: string;
  };
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(APP_DB) private readonly db: Db,
    private readonly cipher: TokenCipher,
    private readonly adapters: AdapterRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Webhook path: the signature was already verified; everything else is bookkeeping. */
  async upsertFromMeta(account: Account, changes: MetaFeedChange[]): Promise<number> {
    const comments = changes.filter(
      (c) =>
        c.value.item === 'comment' &&
        c.value.verb === 'add' &&
        c.value.comment_id &&
        c.value.message,
    );
    const moderation = await this.moderationConfig(account.workspaceId);
    let inserted = 0;
    for (const c of comments) {
      const v = c.value;
      // Link the platform post back to ours (the account that published it).
      const [job] = await this.system
        .select({ postId: postVariants.postId })
        .from(publishJobs)
        .innerJoin(postVariants, eq(postVariants.id, publishJobs.variantId))
        .where(
          and(
            eq(publishJobs.workspaceId, account.workspaceId),
            eq(publishJobs.externalPostId, v.post_id!),
          ),
        )
        .limit(1);
      // MOD-02/03: forbidden words hide instantly; borderline phrasing or a watched
      // account goes to the human-decision queue instead of the open desk.
      const verdict = classifyComment(v.message!, v.from_name ?? null, moderation);
      const rows = await this.system
        .insert(postComments)
        .values({
          workspaceId: account.workspaceId,
          socialAccountId: account.id,
          platform: account.platform,
          postId: job?.postId ?? null,
          externalPostId: v.post_id!,
          externalCommentId: v.comment_id!,
          parentExternalCommentId: v.parent_id ?? null,
          authorName: v.from_name ?? null,
          text: v.message!,
          status:
            verdict === 'forbidden' ? 'hidden' : verdict === 'borderline' ? 'pending' : 'open',
          hiddenReason: verdict === 'forbidden' ? 'ซ่อนอัตโนมัติ: มีคำต้องห้าม' : null,
        })
        .onConflictDoNothing()
        .returning({ id: postComments.id });
      inserted += rows.length;
    }
    return inserted;
  }

  /** MOD-02: this workspace's moderation lists, defaults when unset. */
  private async moderationConfig(workspaceId: string): Promise<ModerationConfig> {
    const [ws] = await this.system
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return {
      ...DEFAULT_MODERATION,
      ...(((ws?.settings as { moderation?: Partial<ModerationConfig> })?.moderation ??
        {}) as Partial<ModerationConfig>),
    };
  }

  /** MOD-03: staff un-hide — returns the comment to the open desk. */
  async unhide(t: TenantInfo, u: AuthUser, commentId: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .update(postComments)
        .set({ status: 'open', hiddenReason: null })
        .where(and(eq(postComments.id, commentId), eq(postComments.workspaceId, t.workspaceId)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'comment_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'comment.unhidden',
        targetType: 'post_comment',
        targetId: commentId,
        after: { status: 'open' },
      });
      return row;
    });
  }

  list(t: TenantInfo, u: AuthUser, f: { platform?: string; postId?: string; status?: string }) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select({
          id: postComments.id,
          platform: postComments.platform,
          accountName: socialAccounts.name,
          postId: postComments.postId,
          postTitle: posts.title,
          authorName: postComments.authorName,
          text: postComments.text,
          status: postComments.status,
          replyText: postComments.replyText,
          receivedAt: postComments.receivedAt,
        })
        .from(postComments)
        .leftJoin(posts, eq(posts.id, postComments.postId))
        .innerJoin(socialAccounts, eq(socialAccounts.id, postComments.socialAccountId))
        .where(
          and(
            f.platform ? eq(postComments.platform, f.platform) : undefined,
            f.postId ? eq(postComments.postId, f.postId) : undefined,
            f.status
              ? eq(postComments.status, f.status as 'open' | 'replied' | 'hidden')
              : undefined,
          ),
        )
        .orderBy(desc(postComments.receivedAt))
        .limit(100),
    );
  }

  async reply(t: TenantInfo, u: AuthUser, commentId: string, text: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [c] = await tx
        .select()
        .from(postComments)
        .where(and(eq(postComments.id, commentId), eq(postComments.workspaceId, t.workspaceId)));
      if (!c) throw new NotFoundException({ code: 'comment_not_found' });
      const [account] = await tx
        .select()
        .from(socialAccounts)
        .where(eq(socialAccounts.id, c.socialAccountId));
      if (!account?.accessTokenEnc || account.status === 'disconnected') {
        throw new NotFoundException({ code: 'account_disconnected' });
      }
      const adapter = this.adapters.get(c.platform as 'facebook');
      if (!adapter.replyToComment) {
        throw new NotFoundException({
          code: 'not_supported',
          message: 'ช่องทางนี้ยังตอบคอมเมนต์จากในระบบไม่ได้',
        });
      }
      const sent = await adapter.replyToComment(
        {
          socialAccountId: account.id,
          externalId: account.externalId,
          accessToken: this.cipher.decrypt(account.accessTokenEnc),
        },
        c.externalCommentId,
        text,
      );
      const [row] = await tx
        .update(postComments)
        .set({ status: 'replied', replyText: text, repliedAt: new Date(), repliedBy: u.userId })
        .where(eq(postComments.id, commentId))
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'comment.replied',
        targetType: 'post_comment',
        targetId: commentId,
        after: { platform: c.platform, externalId: sent.externalId },
      });
      return row!;
    });
  }

  /** MOD-01/03 (lite): flags the comment locally so the desk stops showing it as open. */
  async hide(t: TenantInfo, u: AuthUser, commentId: string, reason: string | undefined) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .update(postComments)
        .set({ status: 'hidden', hiddenReason: reason ?? 'ซ่อนโดยเจ้าหน้าที่' })
        .where(and(eq(postComments.id, commentId), eq(postComments.workspaceId, t.workspaceId)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'comment_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'comment.hidden',
        targetType: 'post_comment',
        targetId: commentId,
        after: { reason: row.hiddenReason },
      });
      return row;
    });
  }
}
