import type { Platform } from '@scm/domain';
import { PlatformBadge } from '@/components/badges';
import { load } from '@/lib/load';
import { LineForm } from './connect-forms';
import { QuotaCell, ReconnectButton } from './quota-cell';
import { SandboxForm } from './sandbox-form';

interface Account {
  id: string;
  platform: Platform;
  name: string;
  health: 'ok' | 'expiring' | 'disconnected' | 'error';
  tokenExpiresAt: string | null;
  lastError: string | null;
  scopes: string[] | null;
}

const HEALTH_TH: Record<Account['health'], { label: string; cls: string }> = {
  ok: { label: 'ปกติ', cls: 'text-ok' },
  expiring: { label: 'โทเคนใกล้หมดอายุ', cls: 'text-warn' },
  disconnected: { label: 'หลุดการเชื่อมต่อ', cls: 'text-danger' },
  error: { label: 'ผิดพลาด', cls: 'text-danger' },
};

/** CONN-06 health dashboard, CONN-07 reconnect and CONN-01/02 live connect. */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; added?: string; reason?: string }>;
}) {
  const q = await searchParams;
  const accounts = await load<Account[]>('/accounts', '/accounts');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">บัญชีโซเชียล</h1>
        <p className="mt-1 text-sm text-muted">สถานะ วันหมดอายุโทเคน และโควตาคงเหลือของทุกบัญชีที่เชื่อมต่อ</p>
      </div>
      {q.connected === 'meta' && (
        <p role="status" className="rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok">
          เชื่อมต่อ Facebook/Instagram สำเร็จ
          {q.added ? ` — ได้ ${q.added} บัญชี` : ''}
        </p>
      )}
      {q.connected === 'error' && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {q.reason === 'not_configured'
            ? 'ระบบยังไม่ได้ตั้งค่า META_APP_ID / META_APP_SECRET'
            : q.reason === 'state_expired'
              ? 'หมดเวลายืนยัน กรุณากดเชื่อมต่อใหม่'
              : 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่'}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">ช่องทาง</th>
              <th className="px-4 py-2.5 font-medium">ชื่อ</th>
              <th className="px-4 py-2.5 font-medium">สถานะ</th>
              <th className="px-4 py-2.5 font-medium">โควตาคงเหลือ</th>
              <th className="px-4 py-2.5 font-medium">ข้อผิดพลาดล่าสุด</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const disconnected = a.health === 'disconnected';
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <PlatformBadge platform={a.platform} />
                  </td>
                  <td className="px-4 py-2.5">{a.name}</td>
                  <td className={`px-4 py-2.5 font-medium ${HEALTH_TH[a.health].cls}`}>
                    {HEALTH_TH[a.health].label}
                  </td>
                  <td className="px-4 py-2.5">
                    <QuotaCell id={a.id} disabled={disconnected} />
                  </td>
                  <td
                    className="max-w-64 truncate px-4 py-2.5 text-muted"
                    title={a.lastError ?? ''}
                  >
                    {a.lastError ?? '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {disconnected && (
                      <ReconnectButton
                        platform={a.platform}
                        name={a.name}
                        sandbox={(a.scopes ?? []).includes('sandbox')}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  ยังไม่มีบัญชีที่เชื่อมต่อ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">Facebook / Instagram (Meta)</h2>
          <p className="text-sm text-muted">
            เชื่อมผ่าน Meta Business Manager — ระบบจะดึงเพทั้งหมดและบัญชี Instagram ที่ผูกไว้พร้อมกัน
          </p>
          <a
            href="/session/meta-oauth"
            className="inline-block rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink"
          >
            เชื่อมต่อผ่าน Meta
          </a>
        </div>
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">LINE Official Account</h2>
          <p className="text-sm text-muted">
            ค่าจาก LINE Developers Console (Messaging API) — ระบบจะตรวจโทเคนกับ LINE ทันทีและแสดง
            Webhook URL ให้นำไปตั้งค่า
          </p>
          <LineForm />
        </div>
      </section>
      <div id="connect">
        <SandboxForm />
      </div>
    </div>
  );
}
