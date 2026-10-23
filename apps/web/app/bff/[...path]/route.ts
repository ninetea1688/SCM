/** Client → API proxy that attaches the session and refreshes it once on 401. */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS, callApi, cookieOpts, REFRESH, type TokenPair, WORKSPACE } from '@/lib/session';

type Ctx = { params: Promise<{ path: string[] }> };

/**
 * Browser JS must never see access/refresh tokens (non-negotiable #5). Login/refresh are
 * server-side only (use /session/*); any other auth response is stripped of token fields.
 */
const TOKEN_FIELDS = ['accessToken', 'refreshToken'] as const;

function sanitizeAuth(base: string, body: string | null): string | null {
  if (!body || !base.startsWith('auth/')) return body;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    for (const f of TOKEN_FIELDS) delete json[f];
    for (const v of Object.values(json)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const f of TOKEN_FIELDS) delete (v as Record<string, unknown>)[f];
      }
    }
    return JSON.stringify(json);
  } catch {
    return body;
  }
}

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const base = path.join('/');
  if (base === 'auth/login' || base === 'auth/refresh') {
    return new NextResponse(null, { status: 404 });
  }
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

  const out = new NextResponse(res.status === 204 ? null : sanitizeAuth(base, await res.text()), {
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
