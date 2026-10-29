/**
 * BFF session: tokens live in httpOnly cookies set by this Next server; browser JS never
 * sees them (XSS cannot steal a session). All API calls go through `apiFetch` (server) or
 * `/bff/*` (client).
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
export const ACCESS = 'scm_at';
export const REFRESH = 'scm_rt';
export const WORKSPACE = 'scm_ws';

export const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** 30x with a RELATIVE Location. Absolute URLs built from req.url/req.nextUrl.origin resolve
 * to the server's bind address (https://0.0.0.0:PORT) behind a gateway that does not preserve
 * Host — internal bounces must always stay relative (RFC 7231 allows it; browsers resolve). */
export function bounce(path: string, status: 302 | 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location: path } });
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function callApi(
  path: string,
  init: { method?: string; body?: string; access?: string; workspace?: string } = {},
): Promise<Response> {
  return fetch(`${API_URL}/api${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(init.access ? { authorization: `Bearer ${init.access}` } : {}),
      ...(init.workspace ? { 'x-workspace-id': init.workspace } : {}),
    },
  });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/** Server-component fetch. Throws ApiError; 401 means "go refresh" (see requireJson). */
export async function apiFetch<T>(path: string): Promise<T> {
  const jar = await cookies();
  const res = await callApi(path, {
    access: jar.get(ACCESS)?.value,
    workspace: jar.get(WORKSPACE)?.value,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
