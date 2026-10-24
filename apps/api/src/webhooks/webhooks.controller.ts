/**
 * Inbound webhooks: verify signature, persist raw, ack fast (PRD §9.2 guidance, SEC-03).
 * Processing into Unified Inbox is P2 (INBOX-01); storing from P1 builds chat history for P4.
 *
 * Account lookup crosses tenants (the request names only an account id), so it uses the
 * system role — the one sanctioned exception in ADR-0006. The write is tenant-scoped.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { type Db, dataDeletionRequests, inboundEvents, socialAccounts, withTenant } from '@scm/db';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/auth.types';
import { APP_DB, SYSTEM_DB } from '../common/core.module';
import { randomToken, TokenCipher } from '../common/crypto';
import { parseInput } from '../common/zod';
import { type AppConfig, CONFIG } from '../config';
import { CommentsService, type MetaFeedChange } from '../inbox/comments.service';
import { InboxService, type LineInboxEvent } from '../inbox/inbox.service';
import {
  parseMetaSignedRequest,
  verifyLineSignature,
  verifyMetaWebhookSignature,
} from './signatures';

interface LineEvent {
  type: string;
  webhookEventId?: string;
}

interface MetaWebhookBody {
  object?: string;
  entry?: { changes?: MetaFeedChange[] }[];
}

@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly cipher: TokenCipher,
    private readonly inbox: InboxService,
    private readonly comments: CommentsService,
  ) {}

  @Post('line/:accountId')
  @HttpCode(200)
  async line(
    @Param('accountId') accountId: string,
    @Headers('x-line-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const [account] = await this.system
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId));
    if (account?.platform !== 'line' || !account.webhookSecretEnc) {
      throw new NotFoundException();
    }
    const secret = this.cipher.decrypt(account.webhookSecretEnc);
    if (!req.rawBody || !signature || !verifyLineSignature(req.rawBody, signature, secret)) {
      throw new UnauthorizedException({ code: 'bad_signature' });
    }
    const body = JSON.parse(req.rawBody.toString('utf8')) as { events?: LineEvent[] };
    const events = body.events ?? [];
    if (events.length === 0) return { ok: true }; // LINE "Verify" button sends no events.

    await withTenant(
      this.db,
      { workspaceId: account.workspaceId },
      (tx) =>
        tx
          .insert(inboundEvents)
          .values(
            events.map((e) => ({
              workspaceId: account.workspaceId,
              socialAccountId: account.id,
              platform: 'line',
              eventType: e.type,
              externalEventId: e.webhookEventId ?? null,
              payload: e,
            })),
          )
          .onConflictDoNothing(), // LINE redelivers; webhookEventId dedupes.
    );
    // INBOX-01: chat messages land on the desk immediately (raw store stays for P4 distillation).
    await this.inbox.upsertFromLine(account, events as LineInboxEvent[]).catch(() => undefined);
    return { ok: true };
  }

  /**
   * INBOX-01: Meta feed events (comments on our Page/IG posts) for one subscribed account.
   * Verified with X-Hub-Signature-256; sandbox accounts may deliver unsigned (dev only).
   */
  @Post('meta/feed/:accountId')
  @HttpCode(200)
  async metaFeed(
    @Param('accountId') accountId: string,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const [account] = await this.system
      .select()
      .from(socialAccounts)
      .where(eq(socialAccounts.id, accountId));
    if (!account || account.platform === 'line') throw new NotFoundException();
    const sandbox = (account.scopes ?? []).includes('sandbox');
    const secret = this.cfg.META_APP_SECRET;
    if (!sandbox) {
      if (!req.rawBody || !verifyMetaWebhookSignature(req.rawBody, signature, secret)) {
        throw new UnauthorizedException({ code: 'bad_signature' });
      }
    } else if (
      secret &&
      req.rawBody &&
      !verifyMetaWebhookSignature(req.rawBody, signature, secret)
    ) {
      // A sandbox account with a configured app still rejects broken signatures.
      throw new UnauthorizedException({ code: 'bad_signature' });
    }
    const body = JSON.parse(req.rawBody?.toString('utf8') ?? '{}') as MetaWebhookBody;
    const changes = (body.entry ?? []).flatMap((e) => e.changes ?? []);
    if (changes.length === 0) return { ok: true };

    await withTenant(this.db, { workspaceId: account.workspaceId }, (tx) =>
      tx
        .insert(inboundEvents)
        .values(
          changes.map((c) => ({
            workspaceId: account.workspaceId,
            socialAccountId: account.id,
            platform: account.platform,
            eventType: `${c.field}:${c.value.item ?? 'unknown'}`,
            externalEventId: c.value.comment_id ?? null,
            payload: c,
          })),
        )
        .onConflictDoNothing(),
    );
    await this.comments.upsertFromMeta(account, changes).catch(() => undefined);
    return { ok: true };
  }

  /** INT-04 / PLAT-01: Meta Data Deletion Request Callback. */
  @Post('meta/data-deletion')
  @HttpCode(200)
  async metaDeletion(@Body() body: unknown) {
    const { signed_request } = parseInput(z.object({ signed_request: z.string() }), body);
    const payload = parseMetaSignedRequest(signed_request, this.cfg.META_APP_SECRET);
    if (!payload?.user_id) throw new UnauthorizedException({ code: 'bad_signature' });
    const code = randomToken(12);
    await this.system.insert(dataDeletionRequests).values({
      platform: 'meta',
      externalUserId: String(payload.user_id),
      confirmationCode: code,
    });
    return {
      url: `${this.cfg.PUBLIC_BASE_URL}/webhooks/meta/data-deletion/status?code=${code}`,
      confirmation_code: code,
    };
  }

  @Get('meta/data-deletion/status')
  async deletionStatus(@Query('code') code: string) {
    const [r] = await this.system
      .select({ status: dataDeletionRequests.status, createdAt: dataDeletionRequests.createdAt })
      .from(dataDeletionRequests)
      .where(eq(dataDeletionRequests.confirmationCode, String(code ?? '')));
    if (!r) throw new NotFoundException();
    return { status: r.status, requestedAt: r.createdAt };
  }
}
