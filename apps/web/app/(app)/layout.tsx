import { cookies } from 'next/headers';
import Link from 'next/link';
import { load } from '@/lib/load';
import { WORKSPACE } from '@/lib/session';
import { KillSwitchButton } from './kill-switch';

interface Ws {
  id: string;
  name: string;
  role: string;
  killSwitch: boolean;
}

const NAV = [
  { href: '/calendar', label: 'ปฏิทิน' },
  { href: '/posts/new', label: 'สร้างโพสต์' },
  { href: '/media', label: 'คลังสื่อ' },
  { href: '/accounts', label: 'บัญชีโซเชียล' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspaces = await load<Ws[]>('/workspaces', '/calendar');
  const currentId = (await cookies()).get(WORKSPACE)?.value;
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/calendar" className="font-semibold text-brand">
            SCM
          </Link>
          <nav className="flex gap-1 text-sm" aria-label="เมนูหลัก">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-3 py-1.5 hover:bg-line">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {current && <KillSwitchButton active={current.killSwitch} />}
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-md border border-line px-3 py-1.5 text-sm">
                {current?.name ?? 'เลือก Workspace'}
              </summary>
              <ul className="absolute right-0 mt-1 min-w-56 rounded-lg border border-line bg-surface p-1 shadow-lg">
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <form action="/session/workspace" method="post">
                      <input type="hidden" name="id" value={w.id} />
                      <button
                        type="submit"
                        aria-current={w.id === current?.id}
                        className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-line aria-[current=true]:font-semibold"
                      >
                        {w.name}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </details>
            <form action="/session/logout" method="post">
              <button type="submit" className="text-sm text-muted hover:text-ink">
                ออกจากระบบ
              </button>
            </form>
          </div>
        </div>
        {current?.killSwitch && (
          <div role="status" className="bg-danger px-4 py-2 text-center text-sm text-on-danger">
            Kill Switch เปิดอยู่ งานโพสต์ที่ตั้งเวลาไว้ทั้งหมดถูกพัก
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
