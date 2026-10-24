/** INBOX-05: standard answers — CRUD plus lookup by shortcut for the reply composer. */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Db, savedReplies, withTenant } from '@scm/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser, TenantInfo } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/db-tokens';

export const SavedReplyInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  /** Typed in the reply box as `/shortcut` to expand instantly. */
  shortcut: z
    .string()
    .max(50)
    .regex(/^[\w.-]*$/, 'ใช้ได้เฉพาะตัวอักษร ตัวเลข . - _')
    .optional(),
});

@Injectable()
export class SavedRepliesService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(t: TenantInfo, u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx.select().from(savedReplies).orderBy(asc(savedReplies.title)).limit(200),
    );
  }

  async create(t: TenantInfo, u: AuthUser, input: z.infer<typeof SavedReplyInput>) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .insert(savedReplies)
        .values({
          workspaceId: t.workspaceId,
          title: input.title,
          body: input.body,
          shortcut: input.shortcut || null,
          createdBy: u.userId,
        })
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'saved_reply.created',
        targetType: 'saved_reply',
        targetId: row!.id,
        after: { title: input.title, shortcut: input.shortcut ?? null },
      });
      return row!;
    });
  }

  async update(t: TenantInfo, u: AuthUser, id: string, input: z.infer<typeof SavedReplyInput>) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .update(savedReplies)
        .set({ ...input, shortcut: input.shortcut || null, updatedAt: new Date() })
        .where(and(eq(savedReplies.id, id), eq(savedReplies.workspaceId, t.workspaceId)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'saved_reply_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'saved_reply.updated',
        targetType: 'saved_reply',
        targetId: id,
        after: { title: input.title },
      });
      return row;
    });
  }

  async remove(t: TenantInfo, u: AuthUser, id: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [row] = await tx
        .delete(savedReplies)
        .where(and(eq(savedReplies.id, id), eq(savedReplies.workspaceId, t.workspaceId)))
        .returning();
      if (!row) throw new NotFoundException({ code: 'saved_reply_not_found' });
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'saved_reply.deleted',
        targetType: 'saved_reply',
        targetId: id,
        after: { title: row.title },
      });
      return { deleted: true };
    });
  }
}
