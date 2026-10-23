import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { parseInput } from '../common/zod';
import { AuthService } from './auth.service';
import { type AppRequest, type AuthUser, CurrentUser, Public } from './auth.types';

const Login = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().length(6).optional(),
});
const Refresh = z.object({ refreshToken: z.string().min(10) });
const Code = z.object({ code: z.string().length(6) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: AppRequest) {
    const { email, password, totp } = parseInput(Login, body);
    return this.auth.login(email, password, totp, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parseInput(Refresh, body).refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser) {
    await this.auth.logout(user.sessionId);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('2fa/setup')
  setup(@CurrentUser() user: AuthUser) {
    return this.auth.beginTotpSetup(user.userId);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.auth.enableTotp(user.userId, user.sessionId, parseInput(Code, body).code);
  }
}
