/** CONN-01: sends the browser to the Meta consent dialog. Server-only (has the cookies). */
import { NextResponse } from 'next/server';
import { ApiError, apiFetch, bounce } from '@/lib/session';

export async function GET() {
  try {
    const { redirectUrl } = await apiFetch<{ redirectUrl: string }>('/accounts/meta/oauth/start');
    return NextResponse.redirect(redirectUrl, 302);
  } catch (e) {
    const reason = e instanceof ApiError && e.status === 400 ? 'not_configured' : 'failed';
    return bounce(`/accounts?connected=error&reason=${reason}`, 302);
  }
}
