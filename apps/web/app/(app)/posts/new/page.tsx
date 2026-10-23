import { load } from '@/lib/load';
import { type AccountOption, Composer } from './composer';

export default async function NewPostPage() {
  const accounts = await load<(AccountOption & { health: string })[]>('/accounts', '/posts/new');
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold">สร้างโพสต์</h1>
      <Composer accounts={accounts.filter((a) => a.health !== 'disconnected')} />
    </div>
  );
}
