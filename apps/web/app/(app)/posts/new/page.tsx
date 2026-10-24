import { load } from '@/lib/load';
import { type AccountOption, Composer } from './composer';

export default async function NewPostPage() {
  const [accounts, current] = await Promise.all([
    load<(AccountOption & { health: string })[]>('/accounts', '/posts/new'),
    load<{
      settings?: {
        brand?: { signature?: string; defaultHashtags?: string[] };
      };
    }>('/workspaces/current', '/posts/new').catch(() => ({
      settings: { brand: { signature: '', defaultHashtags: [] } },
    })),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold">สร้างโพสต์</h1>
      <Composer
        accounts={accounts.filter((a) => a.health !== 'disconnected')}
        brand={{
          signature: current.settings?.brand?.signature ?? '',
          defaultHashtags: current.settings?.brand?.defaultHashtags ?? [],
        }}
      />
    </div>
  );
}
