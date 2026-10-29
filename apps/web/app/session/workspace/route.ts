import { NextResponse } from 'next/server';
import { bounce, cookieOpts, WORKSPACE } from '@/lib/session';

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get('id') ?? '');
  const out = bounce('/calendar', 303);
  if (UUID.test(id)) out.cookies.set(WORKSPACE, id, { ...cookieOpts, maxAge: 365 * 86400 });
  return out;
}
