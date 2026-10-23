/**
 * MEDIA-01/02/06 (P1 subset): presigned direct upload → complete → list.
 * Thumbnails and FFmpeg/Sharp conversion (MEDIA-03/04) run in the worker — see docs/STATUS.md.
 */

import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type Db, mediaAssets, withTenant } from '@scm/db';
import { and, arrayContains, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
  Tenant,
  type TenantInfo,
} from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { APP_DB } from '../common/core.module';
import { parseInput } from '../common/zod';
import { TenantGuard } from '../tenancy/tenant.guard';
import { StorageService } from './storage.service';

const MAX_BYTES = 4 * 1024 ** 3;
const Upload = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().regex(/^(image|video|application)\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  folder: z.string().max(500).default('/'),
  tags: z.array(z.string().max(50)).max(30).default([]),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
});
const List = z.object({
  kind: z.enum(['image', 'video', 'document']).optional(),
  folder: z.string().optional(),
  tag: z.string().optional(),
});

@Controller('media')
@UseGuards(TenantGuard)
export class MediaController {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Post('uploads')
  @RequirePermission('post.edit')
  async start(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    const input = parseInput(Upload, b);
    const kind = input.mimeType.startsWith('image/')
      ? 'image'
      : input.mimeType.startsWith('video/')
        ? 'video'
        : 'document';
    const ext = input.fileName.includes('.') ? input.fileName.split('.').pop() : 'bin';
    const storageKey = `ws/${t.workspaceId}/${randomUUID()}.${ext}`;
    const asset = await withTenant(
      this.db,
      { workspaceId: t.workspaceId, userId: u.userId },
      async (tx) => {
        const [row] = await tx
          .insert(mediaAssets)
          .values({
            workspaceId: t.workspaceId,
            kind,
            mimeType: input.mimeType,
            storageKey,
            originalName: input.fileName,
            sizeBytes: input.sizeBytes,
            folder: input.folder,
            tags: input.tags,
            width: input.width ?? null,
            height: input.height ?? null,
            durationSec: input.durationSec ?? null,
            createdBy: u.userId,
          })
          .returning();
        return row!;
      },
    );
    return { asset, uploadUrl: await this.storage.presignUpload(storageKey, input.mimeType) };
  }

  @Post(':id/complete')
  @RequirePermission('post.edit')
  async complete(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [a] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, id));
      if (!a) throw new NotFoundException({ code: 'media_not_found' });
      const head = await this.storage.head(a.storageKey);
      if (!head)
        throw new BadRequestException({ code: 'upload_missing', message: 'ยังไม่พบไฟล์ที่อัปโหลด' });
      const [row] = await tx
        .update(mediaAssets)
        .set({ status: 'ready', sizeBytes: head.size })
        .where(eq(mediaAssets.id, id))
        .returning();
      await this.audit.record(
        tx,
        {
          workspaceId: t.workspaceId,
          actorUserId: u.userId,
          action: 'media.uploaded',
          targetType: 'media_asset',
          targetId: id,
          after: { kind: a.kind, sizeBytes: head.size },
        },
        { audit: false },
      );
      return row;
    });
  }

  @Get()
  @RequirePermission('report.view')
  async list(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Query() q: unknown) {
    const f = parseInput(List, q);
    const rows = await withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, (tx) =>
      tx
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.status, 'ready'),
            f.kind ? eq(mediaAssets.kind, f.kind) : undefined,
            f.folder ? eq(mediaAssets.folder, f.folder) : undefined,
            f.tag ? arrayContains(mediaAssets.tags, [f.tag]) : undefined,
          ),
        )
        .orderBy(desc(mediaAssets.createdAt))
        .limit(200),
    );
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        previewUrl: await this.storage.presignGet(r.storageKey, 900),
      })),
    );
  }
}
