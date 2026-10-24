/**
 * MEDIA-01/02/03/06: presigned direct upload → complete → worker verifies + renders → list.
 * Dimensions/duration come from the worker's probe of the real file, never from the client.
 * Upload safety rules: ADR-0008.
 */
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type Db, mediaAssets, withTenant } from '@scm/db';
import { ACCEPTED_MIME_TYPES, mediaType } from '@scm/domain';
import { and, arrayContains, count, desc, eq, gte, ilike, inArray, lte, sql } from 'drizzle-orm';
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
import { type AppConfig, CONFIG } from '../config';
import { TenantGuard } from '../tenancy/tenant.guard';
import { MediaQueue } from './media-queue';
import { StorageService } from './storage.service';

const List = z.object({
  kind: z.enum(['image', 'video', 'document']).optional(),
  folder: z.string().optional(),
  tag: z.string().optional(),
  /** MEDIA-02: free-text search over the original file name. */
  q: z.string().max(200).optional(),
  /** MEDIA-02: orientation bucket derived from width×height. */
  aspect: z.enum(['square', 'portrait', 'landscape']).optional(),
  /** MEDIA-02: video length window in seconds. */
  minDurationSec: z.coerce.number().min(0).optional(),
  maxDurationSec: z.coerce.number().min(0).optional(),
  /** Default: everything past upload (processing, ready, failed) so users see progress. */
  status: z.enum(['processing', 'ready', 'failed']).optional(),
});

/** Orientation bucket as SQL — ratio is what the team picks media by (MEDIA-02).
 *  Square tolerates a 5% width/height difference (real files are rarely exact). */
function aspectSql(aspect: 'square' | 'portrait' | 'landscape') {
  const w = mediaAssets.width;
  const h = mediaAssets.height;
  if (aspect === 'square') return sql`abs(${w} - ${h}) * 20 <= greatest(${w}, ${h})`;
  return aspect === 'portrait' ? sql`${h} > ${w}` : sql`${w} > ${h}`;
}

type Asset = typeof mediaAssets.$inferSelect;

@Controller('media')
@UseGuards(TenantGuard)
export class MediaController {
  private readonly Upload;
  private readonly Rights;

  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly queue: MediaQueue,
  ) {
    this.Upload = z.object({
      fileName: z.string().min(1).max(255),
      mimeType: z.enum(ACCEPTED_MIME_TYPES as [string, ...string[]], {
        message: 'ชนิดไฟล์นี้ไม่รองรับ',
      }),
      sizeBytes: z.number().int().positive().max(cfg.MEDIA_MAX_BYTES),
      folder: z.string().max(500).default('/'),
      tags: z.array(z.string().max(50)).max(30).default([]),
      /** MEDIA-07 usage rights, known at upload time (editable later via PATCH /:id/rights). */
      source: z.string().max(300).optional(),
      license: z.string().max(200).optional(),
      rightsExpireAt: z.coerce.date().optional(),
      consentOnFile: z.boolean().optional(),
    });
    this.Rights = z
      .object({
        source: z.string().max(300).nullable().optional(),
        license: z.string().max(200).nullable().optional(),
        rightsExpireAt: z.coerce.date().nullable().optional(),
        consentOnFile: z.boolean().optional(),
      })
      .refine((r) => Object.keys(r).length > 0, { message: 'ต้องระบุอย่างน้อยหนึ่งฟิลด์' });
  }

  @Post('uploads')
  @RequirePermission('post.edit')
  async start(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    const input = parseInput(this.Upload, b);
    const type = mediaType(input.mimeType)!;
    // The key never contains user text; the extension comes from the verified type (ADR-0008).
    const storageKey = `ws/${t.workspaceId}/uploads/${randomUUID()}.${type.ext}`;
    const asset = await withTenant(
      this.db,
      { workspaceId: t.workspaceId, userId: u.userId },
      async (tx) => {
        const [inflight] = await tx
          .select({ n: count() })
          .from(mediaAssets)
          .where(inArray(mediaAssets.status, ['uploading', 'processing']));
        if ((inflight?.n ?? 0) >= this.cfg.MEDIA_MAX_INFLIGHT_PER_WORKSPACE) {
          throw new HttpException(
            { code: 'too_many_uploads', message: 'มีไฟล์รอประมวลผลมากเกินไป กรุณารอสักครู่แล้วลองใหม่' },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const [row] = await tx
          .insert(mediaAssets)
          .values({
            workspaceId: t.workspaceId,
            kind: type.kind,
            mimeType: input.mimeType,
            storageKey,
            originalName: input.fileName,
            sizeBytes: input.sizeBytes,
            folder: input.folder,
            tags: input.tags,
            source: input.source ?? null,
            license: input.license ?? null,
            rightsExpireAt: input.rightsExpireAt ?? null,
            consentOnFile: input.consentOnFile ?? false,
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
  async complete(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    let removeObject: string | null = null;
    const row = await withTenant(
      this.db,
      { workspaceId: t.workspaceId, userId: u.userId },
      async (tx) => {
        const [a] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)).for('update');
        if (!a) throw new NotFoundException({ code: 'media_not_found' });
        if (a.status !== 'uploading') return a; // idempotent; processing gets re-enqueued below
        const head = await this.storage.head(a.storageKey);
        if (!head) {
          throw new HttpException(
            { code: 'upload_missing', message: 'ยังไม่พบไฟล์ที่อัปโหลด' },
            HttpStatus.BAD_REQUEST,
          );
        }
        // The bytes must be what was declared (and within limits) — ADR-0008.
        const sizeOk = head.size === a.sizeBytes && head.size <= this.cfg.MEDIA_MAX_BYTES;
        const [updated] = await tx
          .update(mediaAssets)
          .set(
            sizeOk
              ? { status: 'processing', processingStartedAt: new Date() }
              : {
                  status: 'failed',
                  processingError: 'ขนาดไฟล์ไม่ตรงกับที่แจ้งไว้ กรุณาอัปโหลดใหม่',
                  processedAt: new Date(),
                },
          )
          .where(eq(mediaAssets.id, id))
          .returning();
        if (!sizeOk) removeObject = a.storageKey;
        await this.audit.record(
          tx,
          {
            workspaceId: t.workspaceId,
            actorUserId: u.userId,
            action: sizeOk ? 'media.uploaded' : 'media.upload_rejected',
            targetType: 'media_asset',
            targetId: id,
            after: { kind: a.kind, declared: a.sizeBytes, actual: head.size },
          },
          { audit: false },
        );
        return updated!;
      },
    );
    // After commit: the worker must never see an asset that is still `uploading`.
    if (removeObject) await this.storage.delete(removeObject).catch(() => undefined);
    if (row.status === 'processing') {
      await this.queue.enqueue({ mediaAssetId: row.id, workspaceId: t.workspaceId });
    }
    return this.view(row, { original: false });
  }

  /** MEDIA-02: folders + tags for the filter UI (facets over the current library). */
  @Get('facets')
  @RequirePermission('report.view')
  async facets(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const rows = await tx
        .select({ folder: mediaAssets.folder, tags: mediaAssets.tags })
        .from(mediaAssets)
        .where(inArray(mediaAssets.status, ['processing', 'ready', 'failed']));
      const folders = [...new Set(rows.map((r) => r.folder))].sort();
      const tagCounts = new Map<string, number>();
      for (const { tags } of rows)
        for (const tag of tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      const tags = [...tagCounts.entries()]
        .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
        .map(([tag, n]) => ({ tag, count: n }));
      return { folders, tags };
    });
  }

  @Get(':id')
  @RequirePermission('report.view')
  async get(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const [row] = await withTenant(
      this.db,
      { workspaceId: t.workspaceId, userId: u.userId },
      (tx) => tx.select().from(mediaAssets).where(eq(mediaAssets.id, id)),
    );
    if (!row) throw new NotFoundException({ code: 'media_not_found' });
    return this.view(row, { original: true });
  }

  /** MEDIA-07: record/adjust usage rights; every change is audited. */
  @Patch(':id/rights')
  @RequirePermission('post.edit')
  async updateRights(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    const patch = parseInput(this.Rights, b);
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const [before] = await tx
        .select({
          source: mediaAssets.source,
          license: mediaAssets.license,
          rightsExpireAt: mediaAssets.rightsExpireAt,
          consentOnFile: mediaAssets.consentOnFile,
        })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id));
      if (!before) throw new NotFoundException({ code: 'media_not_found' });
      const [row] = await tx
        .update(mediaAssets)
        .set({
          ...(patch.source !== undefined ? { source: patch.source } : {}),
          ...(patch.license !== undefined ? { license: patch.license } : {}),
          ...(patch.rightsExpireAt !== undefined ? { rightsExpireAt: patch.rightsExpireAt } : {}),
          ...(patch.consentOnFile !== undefined ? { consentOnFile: patch.consentOnFile } : {}),
        })
        .where(eq(mediaAssets.id, id))
        .returning();
      await this.audit.record(tx, {
        workspaceId: t.workspaceId,
        actorUserId: u.userId,
        action: 'media.rights',
        targetType: 'media_asset',
        targetId: id,
        before,
        after: {
          source: row!.source,
          license: row!.license,
          rightsExpireAt: row!.rightsExpireAt,
          consentOnFile: row!.consentOnFile,
        },
      });
      return this.view(row!, { original: false });
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
            f.status
              ? eq(mediaAssets.status, f.status)
              : inArray(mediaAssets.status, ['processing', 'ready', 'failed']),
            f.kind ? eq(mediaAssets.kind, f.kind) : undefined,
            f.folder ? eq(mediaAssets.folder, f.folder) : undefined,
            f.tag ? arrayContains(mediaAssets.tags, [f.tag]) : undefined,
            f.q ? ilike(mediaAssets.originalName, `%${f.q}%`) : undefined,
            f.aspect ? aspectSql(f.aspect) : undefined,
            f.minDurationSec !== undefined
              ? gte(mediaAssets.durationSec, f.minDurationSec)
              : undefined,
            f.maxDurationSec !== undefined
              ? lte(mediaAssets.durationSec, f.maxDurationSec)
              : undefined,
          ),
        )
        .orderBy(desc(mediaAssets.createdAt))
        .limit(200),
    );
    return Promise.all(rows.map((r) => this.view(r, { original: false })));
  }

  /**
   * Short-lived URLs for the renditions (MEDIA-03). The original is signed only on the single-item
   * read and always as a download, so uploaded files never render as active content.
   */
  private async view(a: Asset, opts: { original: boolean }) {
    const ttlSec = this.cfg.PREVIEW_URL_TTL_SEC;
    const sign = (key: string | null) => (key ? this.storage.presignGet(key, { ttlSec }) : null);
    // MEDIA-05: signed URLs per aspect ratio (undefined entries stay absent).
    const crops: Record<string, string> = {};
    for (const [ratio, key] of Object.entries(a.crops ?? {})) {
      const url = await sign(key);
      if (url) crops[ratio] = url;
    }
    return {
      ...a,
      thumbnailUrl: await sign(a.thumbnailKey),
      previewUrl: await sign(a.previewKey),
      crops,
      /** The converted file platforms will receive (MEDIA-04); shown so staff can check it. */
      publishUrl: await sign(a.publishKey),
      originalUrl:
        opts.original && a.status === 'ready'
          ? await this.storage.presignGet(a.storageKey, {
              ttlSec,
              download: { fileName: a.originalName, contentType: a.mimeType },
            })
          : null,
    };
  }
}
