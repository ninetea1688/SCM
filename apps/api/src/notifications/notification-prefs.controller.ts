/**
 * NOTI-03/INBOX-11: per-user notification preferences. Opt-out model — a missing row
 * means "on". The NotificationService filters recipients through these prefs; this
 * controller exposes the current user's own toggles.
 */
import { Body, Controller, Get, HttpCode, Inject, Put, UseGuards } from '@nestjs/common';
import { type Db, notificationPrefs, withTenant } from '@scm/db';
import { NOTIFICATION_TYPES } from '@scm/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { type AuthUser, CurrentUser, Tenant, type TenantInfo } from '../auth/auth.types';
import { APP_DB } from '../common/db-tokens';
import { parseInput } from '../common/zod';
import { TenantGuard } from '../tenancy/tenant.guard';

const Pref = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(['in_app', 'email']),
  enabled: z.boolean(),
});
const Bulk = z.object({ prefs: z.array(Pref).max(40) });

/** User-visible notification types (NOTI-02 P1 subset + system alerts). */
@Controller('notifications')
@UseGuards(TenantGuard)
export class NotificationPrefsController {
  constructor(@Inject(APP_DB) private readonly db: Db) {}

  @Get('prefs')
  async mine(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      const rows = await tx
        .select()
        .from(notificationPrefs)
        .where(eq(notificationPrefs.userId, u.userId));
      // Opt-out model: every type/channel defaults to on.
      const all: { type: string; channel: string; enabled: boolean }[] = [];
      for (const type of NOTIFICATION_TYPES) {
        for (const channel of ['in_app', 'email'] as const) {
          const row = rows.find((r) => r.notificationType === type && r.channel === channel);
          all.push({ type, channel, enabled: row ? row.enabled : true });
        }
      }
      return all;
    });
  }

  @Put('prefs')
  @HttpCode(200)
  async update(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    const { prefs } = parseInput(Bulk, b);
    return withTenant(this.db, { workspaceId: t.workspaceId, userId: u.userId }, async (tx) => {
      for (const p of prefs) {
        await tx
          .insert(notificationPrefs)
          .values({
            userId: u.userId,
            notificationType: p.type,
            channel: p.channel,
            enabled: p.enabled,
          })
          .onConflictDoUpdate({
            target: [
              notificationPrefs.userId,
              notificationPrefs.notificationType,
              notificationPrefs.channel,
            ],
            set: { enabled: p.enabled, updatedAt: new Date() },
          });
      }
      return { saved: prefs.length };
    });
  }
}
