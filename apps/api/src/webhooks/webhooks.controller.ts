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
import { parseMetaSignedRequest, verifyLineSignature } from './signatures';

interface LineEvent {
  type: string;
  webhookEventId?: string;
}

@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(SYSTEM_DB) private readonly system: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly cipher: TokenCipher,
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
