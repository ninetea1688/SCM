/** Server components redirect here on 401; we refresh and bounce back (or to /login). */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS, callApi, cookieOpts, REFRESH, type TokenPair } from '@/lib/session';

export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get('next') ?? '/calendar';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/calendar';
  const rt = (await cookies()).get(REFRESH)?.value;
  if (rt) {
    const r = await callApi('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (r.ok) {
      const t = (await r.json()) as TokenPair;
      const out = NextResponse.redirect(new URL(safeNext, req.url));
      out.cookies.set(ACCESS, t.accessToken, cookieOpts);
      out.cookies.set(REFRESH, t.refreshToken, { ...cookieOpts, maxAge: 14 * 86400 });
      return out;
    }
  }
  return NextResponse.redirect(new URL('/login', req.url));
}
