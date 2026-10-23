'use client';

export interface ApiFailure {
  status: number;
  code?: string;
  message?: string;
  issues?: { messageTh?: string; message?: string; path?: string }[];
}

/** Browser → /bff → API. Resolves to the JSON body or throws ApiFailure. */
export async function bff<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/bff${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, ...(json ?? {}) } as ApiFailure;
  return json as T;
}

const CODE_TH: Record<string, string> = {
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  self_approval_forbidden: 'ผู้เขียนอนุมัติงานของตัวเองไม่ได้',
  validation_failed: 'ยังมีข้อที่ต้องแก้ก่อนส่งตรวจ',
  kill_switch_active: 'Kill Switch เปิดอยู่ ระบบพักการโพสต์ทั้งหมด',
  invalid_transition: 'ทำรายการนี้ในสถานะปัจจุบันไม่ได้',
  approval_stale: 'เนื้อหาเปลี่ยนหลังอนุมัติ ต้องส่งตรวจใหม่',
  invalid_credentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  mfa_required: 'กรุณากรอกรหัส 6 หลักจากแอปยืนยันตัวตน',
  mfa_invalid: 'รหัสยืนยันตัวตนไม่ถูกต้อง',
  account_out_of_scope: 'คุณไม่มีสิทธิ์ในบัญชีนี้',
};

export function describeError(e: unknown): string {
  const f = e as ApiFailure;
  if (f?.message && /[฀-๿]/.test(f.message)) return f.message;
  return (f?.code && CODE_TH[f.code]) || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}
