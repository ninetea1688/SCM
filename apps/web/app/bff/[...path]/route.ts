/** Client → API proxy that attaches the session and refreshes it once on 401. */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS, callApi, cookieOpts, REFRESH, type TokenPair, WORKSPACE } from '@/lib/session';

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const target = `/${path.join('/')}${req.nextUrl.search}`;
  const jar = await cookies();
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();
  const workspace = jar.get(WORKSPACE)?.value;

  let res = await callApi(target, {
    method: req.method,
    body,
    access: jar.get(ACCESS)?.value,
    workspace,
  });
  let refreshed: TokenPair | null = null;
  const rt = jar.get(REFRESH)?.value;
  if (res.status === 401 && rt) {
    const r = await callApi('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (r.ok) {
      refreshed = (await r.json()) as TokenPair;
      res = await callApi(target, {
        method: req.method,
        body,
        access: refreshed.accessToken,
        workspace,
      });
    }
  }

  const out = new NextResponse(res.status === 204 ? null : await res.text(), {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
  if (refreshed) {
    out.cookies.set(ACCESS, refreshed.accessToken, cookieOpts);
    out.cookies.set(REFRESH, refreshed.refreshToken, { ...cookieOpts, maxAge: 14 * 86400 });
  }
  return out;
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };
