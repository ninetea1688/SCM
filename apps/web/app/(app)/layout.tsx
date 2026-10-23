import { cookies } from 'next/headers';
import { Shell, type ShellWorkspace } from '@/components/shell';
import { load } from '@/lib/load';
import { WORKSPACE } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspaces = await load<ShellWorkspace[]>('/workspaces', '/calendar');
  const currentId = (await cookies()).get(WORKSPACE)?.value;
  const current = workspaces.find((w) => w.id === currentId) ?? workspaces[0];

  return (
    <Shell workspaces={workspaces} current={current}>
      {children}
    </Shell>
  );
}
