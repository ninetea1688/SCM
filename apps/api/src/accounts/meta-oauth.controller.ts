/**
 * CONN-01 public OAuth callback: Meta redirects the browser here after consent, so no
 * JWT exists — identity comes from the HMAC-signed state, not the request. Lives outside
 * AccountsController because that one is wrapped in TenantGuard (needs the session).
 */
import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/auth.types';
import { parseInput } from '../common/zod';
import { AccountsService } from './accounts.service';

const Callback = z.object({ code: z.string().min(1), state: z.string().min(1) });

@Public()
@Controller('accounts/meta/oauth')
export class MetaOauthController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('callback')
  @Redirect(undefined, 302)
  async callback(@Query() q: unknown) {
    const { code, state } = parseInput(Callback, q);
    const { redirectUrl } = await this.accounts.metaOAuthCallback(code, state);
    return { url: redirectUrl };
  }
}
