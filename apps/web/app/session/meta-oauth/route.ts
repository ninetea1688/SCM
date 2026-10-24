/** CONN-01: sends the browser to the Meta consent dialog. Server-only (has the cookies). */
import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/session';

export async function GET(req: NextRequest) {
  const back = (path: string) => new URL(path, req.nextUrl.origin);
  try {
    const { redirectUrl } = await apiFetch<{ redirectUrl: string }>('/accounts/meta/oauth/start');
    return NextResponse.redirect(redirectUrl, 302);
  } catch (e) {
    const reason = e instanceof ApiError && e.status === 400 ? 'not_configured' : 'failed';
    return NextResponse.redirect(back(`/accounts?connected=error&reason=${reason}`), 302);
  }
}
