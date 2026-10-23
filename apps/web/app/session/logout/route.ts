import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ACCESS, callApi, REFRESH } from '@/lib/session';

export async function POST(req: Request) {
  const access = (await cookies()).get(ACCESS)?.value;
  if (access) await callApi('/auth/logout', { method: 'POST', access }).catch(() => undefined);
  const out = NextResponse.redirect(new URL('/login', req.url), 303);
  out.cookies.delete(ACCESS);
  out.cookies.delete(REFRESH);
  return out;
}
