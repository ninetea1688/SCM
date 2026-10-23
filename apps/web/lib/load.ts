import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './session';

/** Server-side load with session handling: 401 → refresh round-trip, no workspace → picker. */
export async function load<T>(path: string, here: string): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      redirect(`/session/refresh?next=${encodeURIComponent(here)}`);
    }
    if (e instanceof ApiError && e.status === 403) {
      const code = (e.body as { code?: string } | null)?.code;
      if (code === 'mfa_required_for_role') redirect('/security');
      if (code === 'workspace_required' || code === 'not_a_member') redirect('/workspaces');
    }
    throw e;
  }
}
