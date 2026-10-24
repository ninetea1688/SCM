/**
 * ANA-01/02 skeleton: engagement per post × platform — one row per (post, platform) from
 * its newest snapshot, sorted by engagement rate. Platform chips split the view.
 */
import { PLATFORM_LABEL_TH, PLATFORMS, type Platform } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';

interface Row {
  postId: string;
  postTitle: string;
  platform: Platform;
  accountName: string;
  capturedAt: string;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
  engagementRate: number | null;
}

const thTime = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const q = await searchParams;
  const platform = PLATFORMS.includes(q.platform as Platform) ? q.platform! : '';
  const rows = await load<Row[]>(
    `/analytics/posts${platform ? `?platform=${platform}` : ''}`,
    `/analytics${platform ? `?platform=${platform}` : ''}`,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">วิเคราะห์คอนเทนต์</h1>
        <p className="mt-1 text-sm text-muted">
          ยอดเข้าถึงและการมีส่วนร่วม แยกตามโพสต์และแพลตฟอร์ม — เรียงจากอัตราการมีส่วนร่วมสูงสุด
        </p>
      </div>

      <nav aria-label="กรองแพลตฟอร์ม" className="flex flex-wrap gap-1.5">
        <Link
          href="/analytics"
          className={`rounded-full border px-2.5 py-1 text-xs ${platform === '' ? 'border-brand bg-brand/10 font-medium' : 'border-line text-muted'}`}
        >
          ทุกแพลตฟอร์ม
        </Link>
        {PLATFORMS.map((p) => (
          <Link
            key={p}
            href={`/analytics?platform=${p}`}
            className={`rounded-full border px-2.5 py-1 text-xs ${platform === p ? 'border-brand bg-brand/10 font-medium' : 'border-line text-muted'}`}
          >
            {PLATFORM_LABEL_TH[p]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-muted">
          ยังไม่มีข้อมูล — ระบบเก็บสถิติอัตโนมัติหลังโพสต์เผยแพร่สำเร็จ (รอบละชั่วโมง)
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="p-3">โพสต์</th>
                <th>ช่องทาง</th>
                <th className="text-right">เข้าถึง</th>
                <th className="text-right">ถูกใจ</th>
                <th className="text-right">คอมเมนต์</th>
                <th className="text-right">แชร์</th>
                <th className="text-right">อัตรามีส่วนร่วม</th>
                <th className="text-right">เก็บเมื่อ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.postId}:${r.platform}`}
                  className="border-b border-line last:border-0"
                >
                  <td className="max-w-64 truncate p-3">
                    <Link href={`/posts/${r.postId}`} className="hover:text-brand hover:underline">
                      {r.postTitle}
                    </Link>
                  </td>
                  <td className="text-muted">
                    {PLATFORM_LABEL_TH[r.platform]} · {r.accountName}
                  </td>
                  <td className="text-right">{r.reach.toLocaleString('th-TH')}</td>
                  <td className="text-right">{r.likes.toLocaleString('th-TH')}</td>
                  <td className="text-right">{r.comments.toLocaleString('th-TH')}</td>
                  <td className="text-right">{r.shares.toLocaleString('th-TH')}</td>
                  <td className="text-right font-medium">
                    {r.engagementRate === null
                      ? '—'
                      : `${r.engagementRate.toLocaleString('th-TH')}%`}
                  </td>
                  <td className="text-right text-muted">{thTime.format(new Date(r.capturedAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
