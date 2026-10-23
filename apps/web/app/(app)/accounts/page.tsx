import type { Platform } from '@scm/domain';
import { PlatformBadge } from '@/components/badges';
import { load } from '@/lib/load';
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

/** CONN-06 health dashboard + CONN-07 reconnect. */
export default async function AccountsPage() {
  const accounts = await load<Account[]>('/accounts', '/accounts');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">บัญชีโซเชียล</h1>
        <p className="mt-1 text-sm text-muted">สถานะ วันหมดอายุโทเคน และโควตาคงเหลือของทุกบัญชีที่เชื่อมต่อ</p>
      </div>
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
      <div id="connect">
        <SandboxForm />
      </div>
    </div>
  );
}
