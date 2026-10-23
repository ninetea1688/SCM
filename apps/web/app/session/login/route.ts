import { NextResponse } from 'next/server';
import { ACCESS, callApi, cookieOpts, REFRESH, type TokenPair, WORKSPACE } from '@/lib/session';

export async function POST(req: Request) {
  const body = await req.text();
  const res = await callApi('/auth/login', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(json, { status: res.status });

  const tokens = json as TokenPair;
  const ws = await callApi('/workspaces', { access: tokens.accessToken });
  const list = ((await ws.json().catch(() => [])) as { id: string }[]) ?? [];

  const out = NextResponse.json({ ok: true, workspaces: list.length });
  out.cookies.set(ACCESS, tokens.accessToken, cookieOpts);
  out.cookies.set(REFRESH, tokens.refreshToken, { ...cookieOpts, maxAge: 14 * 86400 });
  if (list[0]) out.cookies.set(WORKSPACE, list[0].id, { ...cookieOpts, maxAge: 365 * 86400 });
  return out;
}
