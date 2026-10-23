import type { Platform } from '@scm/domain';
import { PlatformBadge } from '@/components/badges';
import { load } from '@/lib/load';
import { SandboxForm } from './sandbox-form';

interface Account {
  id: string;
  platform: Platform;
  name: string;
  health: 'ok' | 'expiring' | 'disconnected' | 'error';
  tokenExpiresAt: string | null;
  lastError: string | null;
}

const HEALTH_TH: Record<Account['health'], { label: string; cls: string }> = {
  ok: { label: 'ปกติ', cls: 'text-ok' },
  expiring: { label: 'โทเคนใกล้หมดอายุ', cls: 'text-warn' },
  disconnected: { label: 'หลุดการเชื่อมต่อ', cls: 'text-danger' },
  error: { label: 'ผิดพลาด', cls: 'text-danger' },
};

/** CONN-06 health dashboard. */
export default async function AccountsPage() {
  const accounts = await load<Account[]>('/accounts', '/accounts');
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">บัญชีโซเชียล</h1>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">ช่องทาง</th>
              <th className="px-4 py-2 font-medium">ชื่อ</th>
              <th className="px-4 py-2 font-medium">สถานะ</th>
              <th className="px-4 py-2 font-medium">ข้อผิดพลาดล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  <PlatformBadge platform={a.platform} />
                </td>
                <td className="px-4 py-2">{a.name}</td>
                <td className={`px-4 py-2 font-medium ${HEALTH_TH[a.health].cls}`}>
                  {HEALTH_TH[a.health].label}
                </td>
                <td className="px-4 py-2 text-muted">{a.lastError ?? '-'}</td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  ยังไม่มีบัญชีที่เชื่อมต่อ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <SandboxForm />
    </div>
  );
}
