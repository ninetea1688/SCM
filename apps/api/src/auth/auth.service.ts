import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type Db, sessions, users } from '@scm/db';
import argon2 from 'argon2';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { authenticator } from 'otplib';

// ±1 step (30 s) tolerates normal phone clock skew and step-boundary races.
authenticator.options = { window: 1 };

import { APP_DB } from '../common/core.module';
import { randomToken, sha256, TokenCipher } from '../common/crypto';
import { type AppConfig, CONFIG } from '../config';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AccessClaims {
  sub: string;
  sid: string;
  mfa: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_DB) private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    private readonly cipher: TokenCipher,
  ) {}

  async login(email: string, password: string, totp?: string, meta: SessionMeta = {}) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()));
    // Same error for unknown user / bad password, and still pay the hash cost.
    let valid = false;
    if (user?.passwordHash && !user.disabledAt) {
      valid = await argon2.verify(user.passwordHash, password);
    } else {
      await argon2.hash(password);
    }
    if (!user || !valid) throw new UnauthorizedException({ code: 'invalid_credentials' });

    let mfa = false;
    if (user.totpEnabled) {
      if (!totp) throw new UnauthorizedException({ code: 'mfa_required' });
      if (!this.verifyTotp(user.totpSecretEnc, totp)) {
        throw new UnauthorizedException({ code: 'mfa_invalid' });
      }
      mfa = true;
    }
    return this.issue(user.id, mfa, meta);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const [sid, secret] = refreshToken.split('.');
    if (!sid || !secret) throw new UnauthorizedException({ code: 'invalid_refresh' });
    const [s] = await this.db
      .select()
      .from(sessions)
      .where(
        and(eq(sessions.id, sid), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())),
      );
    if (!s || s.refreshHash !== sha256(secret)) {
      throw new UnauthorizedException({ code: 'invalid_refresh' });
    }
    // Rotate: the old refresh token stops working.
    const next = randomToken();
    await this.db
      .update(sessions)
      .set({ refreshHash: sha256(next) })
      .where(eq(sessions.id, s.id));
    return {
      accessToken: await this.sign({ sub: s.userId, sid: s.id, mfa: s.mfaPassed }),
      refreshToken: `${s.id}.${next}`,
      expiresIn: this.cfg.ACCESS_TOKEN_TTL_SEC,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  }

  /** AUTH-07: kill every session of a user immediately. */
  async revokeAllSessions(userId: string): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  async verifyAccess(token: string) {
    const claims = await this.jwt.verifyAsync<AccessClaims>(token);
    const [row] = await this.db
      .select({ revokedAt: sessions.revokedAt, totpEnabled: users.totpEnabled })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, claims.sid), isNull(users.disabledAt)));
    if (!row || row.revokedAt) throw new UnauthorizedException({ code: 'session_revoked' });
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      mfa: claims.mfa,
      totpEnabled: row.totpEnabled,
    };
  }

  // ── 2FA (AUTH-04) ──────────────────────────────────────────────────────────

  async beginTotpSetup(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException();
    const secret = authenticator.generateSecret();
    await this.db
      .update(users)
      .set({ totpSecretEnc: this.cipher.encrypt(secret), totpEnabled: false })
      .where(eq(users.id, userId));
    return { secret, otpauthUrl: authenticator.keyuri(user.email, 'SCM', secret) };
  }

  /** Confirms setup and upgrades the current session to MFA-verified. */
  async enableTotp(userId: string, sessionId: string, code: string): Promise<TokenPair> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || !this.verifyTotp(user.totpSecretEnc, code)) {
      throw new UnauthorizedException({ code: 'mfa_invalid' });
    }
    await this.db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
    await this.logout(sessionId);
    return this.issue(userId, true, {});
  }

  private verifyTotp(secretEnc: string | null, code: string): boolean {
    if (!secretEnc) return false;
    return authenticator.verify({ token: code, secret: this.cipher.decrypt(secretEnc) });
  }

  private async issue(userId: string, mfa: boolean, meta: SessionMeta): Promise<TokenPair> {
    const secret = randomToken();
    const [s] = await this.db
      .insert(sessions)
      .values({
        userId,
        refreshHash: sha256(secret),
        mfaPassed: mfa,
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_SEC * 1000),
      })
      .returning({ id: sessions.id });
    return {
      accessToken: await this.sign({ sub: userId, sid: s!.id, mfa }),
      refreshToken: `${s!.id}.${secret}`,
      expiresIn: this.cfg.ACCESS_TOKEN_TTL_SEC,
    };
  }

  private sign(claims: AccessClaims) {
    return this.jwt.signAsync(claims, { expiresIn: this.cfg.ACCESS_TOKEN_TTL_SEC });
  }
}

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}
