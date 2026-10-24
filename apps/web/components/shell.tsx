'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KillSwitchButton } from '@/app/(app)/kill-switch';

export interface ShellWorkspace {
  id: string;
  name: string;
  killSwitch: boolean;
}

const NAV = [
  {
    href: '/calendar',
    label: 'ปฏิทิน',
    icon: 'M4 8h16M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M8 3v3M16 3v3',
  },
  { href: '/posts/new', label: 'สร้างโพสต์', icon: 'M12 5v14M5 12h14' },
  { href: '/media', label: 'คลังสื่อ', icon: 'M4 6h10M4 12h16M4 18h7M17 15l4 3-4 3' },
  {
    href: '/inbox',
    label: 'ตอบแชท',
    icon: 'M8 10h8M8 14h4M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z',
  },
  {
    href: '/comments',
    label: 'คอมเมนต์',
    icon: 'M7 8h10M7 12h6M21 12c0 4.4-4 8-9 8a10 10 0 0 1-2.9-.4L3 21l1.6-4.4A7.4 7.4 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8Z',
  },
  {
    href: '/analytics',
    label: 'วิเคราะห์',
    icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  },
  {
    href: '/accounts',
    label: 'บัญชีโซเชียล',
    icon: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  },
  {
    href: '/settings',
    label: 'ตั้งค่า',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5 shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Responsive app shell (NHSO CI): brand sidebar on desktop, drawer + top bar on mobile.
 * Content area stays white; navigation lives on น้ำเงินเข้ม with a เขียว active accent.
 */
export function Shell({
  workspaces,
  current,
  children,
}: {
  workspaces: ShellWorkspace[];
  current: ShellWorkspace | undefined;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the drawer on navigation (pathname drives the effect; setOpen is stable).
  useEffect(() => {
    if (pathname) setOpen(false);
  }, [pathname]);

  const nav = (
    <nav aria-label="เมนูหลัก" className="flex-1 space-y-1 px-3 py-4">
      {NAV.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-white/15 text-white shadow-[inset_3px_0_0_0_var(--color-brand-2)]'
                : 'text-white/75 hover:bg-white/10 hover:text-white'
            }`}
          >
            <NavIcon d={n.icon} />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 px-5 py-5">
      {/* biome-ignore lint/performance/noImgElement: static asset; plain img keeps the shell client-only simple */}
      <img src="/nhso-icon.png" alt="ตราสัญลักษณ์ สปสช." className="size-11" />
      <div className="leading-tight">
        <p className="text-base font-semibold text-white">SCM</p>
        <p className="text-xs text-white/70">ศูนย์บริหารคอนเทนต์ สปสช.</p>
      </div>
    </div>
  );

  const footer = (
    <div className="space-y-3 border-t border-white/15 px-5 py-4">
      {workspaces.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/15">
            <span className="min-w-0 truncate">{current?.name ?? 'เลือก Workspace'}</span>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-4 shrink-0 text-white/60 group-open:rotate-180"
            >
              <path
                d="m6 9 6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </summary>
          <ul className="mt-1 space-y-0.5">
            {workspaces.map((w) => (
              <li key={w.id}>
                <form action="/session/workspace" method="post">
                  <input type="hidden" name="id" value={w.id} />
                  <button
                    type="submit"
                    aria-current={w.id === current?.id}
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-white/80 hover:bg-white/10 hover:text-white aria-[current=true]:font-semibold aria-[current=true]:text-white"
                  >
                    {w.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}
      {current && <KillSwitchButton active={current.killSwitch} />}
      <form action="/session/logout" method="post">
        <button
          type="submit"
          className="w-full rounded-lg px-3 py-2 text-left text-sm text-white/75 hover:bg-white/10 hover:text-white"
        >
          ออกจากระบบ
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="เปิดเมนู"
          aria-expanded={open}
          className="rounded-md p-2 text-ink hover:bg-line"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {/* biome-ignore lint/performance/noImgElement: static asset */}
        <img src="/nhso-icon.png" alt="" className="size-8" />
        <p className="text-sm font-semibold">
          SCM <span className="font-normal text-muted">สปสช.</span>
        </p>
        {current?.killSwitch && (
          <span className="ml-auto rounded-full bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
            Kill Switch
          </span>
        )}
      </header>

      {/* Sidebar: static on desktop, slide-in drawer on mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-brand-hero transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="ปิดเมนู"
          className="absolute top-4 right-3 rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
            <path
              d="M6 6l12 12M18 6 6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {brand}
        {nav}
        {footer}
      </aside>
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="ปิดเมนู"
          className="fixed inset-0 z-30 cursor-default bg-black/40 lg:hidden"
        />
      )}

      <div className="min-w-0 flex-1">
        {current?.killSwitch && (
          <div role="status" className="bg-danger px-4 py-2 text-center text-sm text-on-danger">
            Kill Switch เปิดอยู่ งานโพสต์ที่ตั้งเวลาไว้ทั้งหมดถูกพัก
          </div>
        )}
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
