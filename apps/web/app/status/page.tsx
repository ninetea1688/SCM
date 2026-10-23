/**
 * OPS-04: public system-status page for users (outside the login wall so staff
 * can check during an incident). Server-renders from the API's /status endpoint.
 */
export const revalidate = 30; // seconds

interface StatusBody {
  status: string;
  components: Record<string, string>;
  queue: { waiting: number | null; active: number | null };
  time: string;
}

const COMPONENT_TH: Record<string, string> = {
  db: 'ฐานข้อมูล',
  storage: 'คลังไฟล์สื่อ',
  queue: 'คิวงานโพสต์',
};

async function loadStatus(): Promise<StatusBody | null> {
  try {
    const base = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    const res = await fetch(`${base}/status`, {
      next: { revalidate },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? ((await res.json()) as StatusBody) : null;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const s = await loadStatus();
  const ok = s?.status === 'ok';
  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-16">
      {/* biome-ignore lint/performance/noImgElement: static asset */}
      <img src="/nhso-icon.png" alt="ตราสัญลักษณ์ สปสช." className="mx-auto size-14" />
      <div className="space-y-2 text-center">
        <h1 className="text-xl font-semibold">สถานะระบบ SCM สปสช.</h1>
        <p
          className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
            ok ? 'bg-ok/10 text-ok' : s ? 'bg-warn/15 text-warn' : 'bg-danger/10 text-danger'
          }`}
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-current" />
          {!s ? 'ไม่สามารถติดต่อระบบได้' : ok ? 'ทุกบริการทำงานปกติ' : 'บางบริการขัดข้อง'}
        </p>
      </div>

      {s && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm shadow-sm">
          {Object.entries(s.components).map(([key, state]) => (
            <li key={key} className="flex items-center justify-between px-5 py-3.5">
              <span>{COMPONENT_TH[key] ?? key}</span>
              <span className={state === 'ok' ? 'font-medium text-ok' : 'font-medium text-danger'}>
                {state === 'ok' ? 'ปกติ' : 'ขัดข้อง'}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between px-5 py-3.5 text-muted">
            <span>งานโพสต์รอคิว</span>
            <span>{s.queue.waiting ?? '—'} รายการ</span>
          </li>
          <li className="flex items-center justify-between px-5 py-3.5 text-muted">
            <span>ตรวจเมื่อ</span>
            <span>{new Date(s.time).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })} น.</span>
          </li>
        </ul>
      )}
      <p className="text-center text-xs text-muted">
        ข้อมูลอัปเดตทุก 30 วินาที · หากขัดข้องติดต่อผู้ดูแลระบบภายใน
      </p>
    </main>
  );
}
