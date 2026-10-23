/**
 * OPS-04: the worker's system-health watch alerts admins (in-app rows + one team
 * LINE push) when a component is down, and announces recovery. The service runs in
 * the worker process; here it is constructed directly from the app context (same
 * pattern as the data-deletion e2e).
 */
import type { INestApplication } from '@nestjs/common';
import { createDb, createPool, notifications } from '@scm/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_DB, SYSTEM_DB } from '../common/db-tokens';
import { CONFIG } from '../config';
import { StorageService } from '../media/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { PublishQueue } from '../publishing/queue';
import { bootApp, createWorld, OWNER_URL } from '../test/harness';
import { StatusWatchService } from './status-watch.service';

let app: INestApplication;
let w: Awaited<ReturnType<typeof createWorld>>;
const ownerPool = createPool(OWNER_URL, 1);
const ownerDb = createDb(ownerPool);

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'watch');
});

afterAll(async () => {
  await ownerPool.end();
  await app.close();
});

/** Real service with a stubbed queue so thresholds are reachable without waiting. */
function watchWith(
  counts: {
    waiting: number;
    delayed: number;
    active: number;
    failed: number;
  } | null,
) {
  const queue = {
    counts: async () => {
      if (!counts) throw new Error('redis down');
      return counts;
    },
  } as unknown as PublishQueue;
  return new StatusWatchService(
    app.get(APP_DB),
    app.get(SYSTEM_DB),
    app.get(CONFIG),
    app.get(StorageService),
    queue,
    app.get(NotificationService),
  );
}

const rowsFor = async () =>
  ownerDb.select().from(notifications).where(eq(notifications.type, 'system_alert'));

describe('StatusWatch (OPS-04)', () => {
  it('alerts every workspace’s owners/admins once when a component goes down, then announces recovery', async () => {
    const cfg = app.get(CONFIG);
    let counts: {
      waiting: number;
      delayed: number;
      active: number;
      failed: number;
    } | null = null; // null = queue unreachable
    const queue = {
      counts: async () => {
        if (!counts) throw new Error('redis down');
        return counts;
      },
    } as unknown as PublishQueue;
    const watch = new StatusWatchService(
      app.get(APP_DB),
      app.get(SYSTEM_DB),
      cfg,
      app.get(StorageService),
      queue,
      app.get(NotificationService),
    );

    await expect(watch.tick()).resolves.toEqual({ bad: true, reason: 'คิวงานเชื่อมต่อไม่ได้' });

    const alerts = (await rowsFor()).filter((n) => n.workspaceId === w.workspaceId);
    expect(alerts.length).toBeGreaterThanOrEqual(2); // owner + admin
    expect(alerts[0]!.title).toContain('คิวงานเชื่อมต่อไม่ได้');

    // Still bad → no duplicate rows.
    await watch.tick();
    const again = (await rowsFor()).filter((n) => n.workspaceId === w.workspaceId);
    expect(again.length).toBe(alerts.length);

    // Recovery notice on the next healthy tick.
    counts = { waiting: 0, delayed: 0, active: 0, failed: 0 };
    await watch.tick();
    const rows = (await rowsFor()).filter((n) => n.workspaceId === w.workspaceId);
    expect(rows.some((n) => n.title.includes('กลับมาปกติ'))).toBe(true);
  });

  it('a queue backlog above the threshold counts as degraded', async () => {
    const cfg = app.get(CONFIG);
    const watch = watchWith({
      waiting: cfg.STATUS_QUEUE_BACKLOG_ALERT + 1,
      delayed: 0,
      active: 0,
      failed: 0,
    });
    const r = await watch.tick();
    expect(r.bad).toBe(true);
    expect(r.reason).toContain('คิวค้าง');

    const ok = watchWith({ waiting: 1, delayed: 0, active: 0, failed: 0 });
    await expect(ok.tick()).resolves.toEqual({ bad: false, reason: null });
  });
});
