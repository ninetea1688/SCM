/**
 * INBOX-01 comment desk: comments on our published posts, filtered per platform/status.
 * Facebook Page comments arrive through the Meta webhook and link back to the post.
 */
import { PLATFORM_LABEL_TH, PLATFORMS, type Platform } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';
import { CommentActions, UnhideButton } from './comment-actions';

interface CommentRow {
  id: string;
  platform: Platform;
  accountName: string;
  postId: string | null;
  postTitle: string | null;
  authorName: string | null;
  text: string;
  status: 'open' | 'replied' | 'hidden' | 'pending';
  replyText: string | null;
  receivedAt: string;
}

const STATUS_TH: Record<CommentRow['status'], { label: string; cls: string }> = {
  open: { label: 'รอตอบ', cls: 'bg-warn/10 text-warn' },
  replied: { label: 'ตอบแล้ว', cls: 'bg-ok/10 text-ok' },
  hidden: { label: 'ซ่อนแล้ว', cls: 'bg-line text-muted' },
  pending: { label: 'รอตัดสิน (MOD-03)', cls: 'bg-brand/10 text-brand' },
};

const thTime = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const TABS = [
  { value: '', label: 'รอดำเนินการ' },
  { value: 'pending', label: 'รอตัดสิน' },
  { value: 'replied', label: 'ตอบแล้ว' },
  { value: 'hidden', label: 'ซ่อนแล้ว' },
  { value: 'all', label: 'ทั้งหมด' },
] as const;

export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; platform?: string }>;
}) {
  const q = await searchParams;
  const status = TABS.some((t) => t.value === q.status) ? q.status! : '';
  const platform = PLATFORMS.includes(q.platform as Platform) ? q.platform! : '';
  const params = new URLSearchParams(
    Object.entries({ status: status === 'all' ? '' : status, platform }).filter(([, v]) => v) as [
      string,
      string,
    ][],
  );
  const query = params.toString();
  const comments = await load<CommentRow[]>(
    `/comments${query ? `?${query}` : ''}`,
    `/comments${query ? `?${query}` : ''}`,
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ศูนย์จัดการคอมเมนต์</h1>
        <p className="mt-1 text-sm text-muted">
          คอมเมนต์บนโพสต์ของเราทุกแพลตฟอร์ม — ตอบใต้คอมเมนต์ได้จากในระบบ พร้อมลิงก์กลับไปที่โพสต์ต้นทาง
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="สถานะคอมเมนต์" className="flex gap-1 border-b border-line text-sm">
          {TABS.map((t) => {
            const p = new URLSearchParams({
              ...(platform ? { platform } : {}),
              ...(t.value ? { status: t.value } : {}),
            });
            return (
              <Link
                key={t.value}
                href={`/comments${p.toString() ? `?${p.toString()}` : ''}`}
                aria-current={status === t.value ? 'page' : undefined}
                className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-ink"
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <nav aria-label="กรองแพลตฟอร์ม" className="flex flex-wrap gap-1.5">
          <Link
            href={`/comments${status && status !== 'all' ? `?status=${status}` : ''}`}
            className={`rounded-full border px-2.5 py-1 text-xs ${platform === '' ? 'border-brand bg-brand/10 font-medium' : 'border-line text-muted'}`}
          >
            ทุกแพลตฟอร์ม
          </Link>
          {PLATFORMS.map((p) => {
            const sp = new URLSearchParams({
              ...(status && status !== 'all' ? { status } : {}),
              platform: p,
            });
            return (
              <Link
                key={p}
                href={`/comments?${sp.toString()}`}
                className={`rounded-full border px-2.5 py-1 text-xs ${platform === p ? 'border-brand bg-brand/10 font-medium' : 'border-line text-muted'}`}
              >
                {PLATFORM_LABEL_TH[p]}
              </Link>
            );
          })}
        </nav>
      </div>

      {comments.length === 0 ? (
        <p className="py-16 text-center text-muted">
          ไม่มีคอมเมนต์ในมุมมองนี้ — คอมเมนต์ใหม่จะเข้ามาเองเมื่อแพลตฟอร์มส่ง webhook
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{c.authorName ?? 'ผู้ใช้'}</span>
                <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">
                  {PLATFORM_LABEL_TH[c.platform]} · {c.accountName}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TH[c.status].cls}`}>
                  {STATUS_TH[c.status].label}
                </span>
                <span className="ml-auto text-xs text-muted">
                  {thTime.format(new Date(c.receivedAt))}
                </span>
              </div>
              <p className="mt-2 text-sm">{c.text}</p>
              {c.replyText && (
                <p className="mt-2 rounded-lg bg-brand/5 px-3 py-2 text-sm">
                  <span className="text-xs text-muted">ตอบแล้ว: </span>
                  {c.replyText}
                </p>
              )}
              {c.postId ? (
                <Link
                  href={`/posts/${c.postId}`}
                  className="mt-1.5 inline-block text-xs text-brand underline"
                >
                  โพสต์: {c.postTitle}
                </Link>
              ) : (
                <p className="mt-1.5 text-xs text-muted">คอมเมนต์บนโพสต์ที่ไม่ได้โพสต์จากระบบนี้</p>
              )}
              <div className="mt-2">
                {c.status === 'hidden' && <UnhideButton id={c.id} />}
                <CommentActions id={c.id} status={c.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
