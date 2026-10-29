import { cookies } from 'next/headers';
import { ACCESS, bounce, callApi, REFRESH } from '@/lib/session';

export async function POST(req: Request) {
  const access = (await cookies()).get(ACCESS)?.value;
  if (access) await callApi('/auth/logout', { method: 'POST', access }).catch(() => undefined);
  const out = bounce('/login', 303);
  out.cookies.delete(ACCESS);
  out.cookies.delete(REFRESH);
  return out;
}
