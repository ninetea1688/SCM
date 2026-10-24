/**
 * INBOX-01/02: the chat desk (LINE OA today). Left: conversation list with status chips;
 * right: the selected thread with our replies — answering claims the thread (INBOX-02).
 */
import type { Platform } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';
import { ApiError } from '@/lib/session';
import { ConversationActions, PendingReview } from './conversation-actions';

interface Conversation {
  id: string;
  platform: Platform;
  accountName: string;
  externalUserName: string | null;
  status: 'open' | 'claimed' | 'closed';
  assignee: string | null;
  slaDueAt: string | null;
  slaEscalatedAt: string | null;
  replyWindowUntil: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
}
interface Message {
  id: string;
  direction: 'in' | 'out';
  senderName: string | null;
  text: string;
  createdAt: string;
  isInternalNote: boolean;
  isAutoReply: boolean;
  status: 'sent' | 'pending' | 'rejected';
}
interface Profile {
  platform: Platform;
  accountName: string;
  externalUserId: string;
  status: 'open' | 'claimed' | 'closed';
  assignee: string | null;
  createdAt: string;
  lastMessageAt: string;
  stats: { firstContactAt: string; received: number; sent: number; total: number };
  otherThreads: { id: string; accountName: string }[];
}

const STATUS_TH: Record<Conversation['status'], { label: string; cls: string }> = {
  open: { label: 'เปิด', cls: 'bg-warn/10 text-warn' },
  claimed: { label: 'รับเรื่องแล้ว', cls: 'bg-brand/10 text-brand' },
  closed: { label: 'ปิด', cls: 'bg-line text-muted' },
};

const thTime = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const q = await searchParams;
  const conversations = await load<Conversation[]>('/inbox/conversations', '/inbox');
  const selectedId =
    q.c && conversations.some((c) => c.id === q.c) ? q.c : (conversations[0]?.id ?? null);
  const messages = selectedId
    ? await load<Message[]>(
        `/inbox/conversations/${selectedId}/messages`,
        `/inbox?c=${selectedId}`,
      ).catch((e) => (e instanceof ApiError && e.status === 403 ? null : Promise.reject(e)))
    : [];
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const profile = selectedId
    ? await load<Profile>(
        `/inbox/conversations/${selectedId}/profile`,
        `/inbox?c=${selectedId}`,
      ).catch((e) => (e instanceof ApiError && e.status === 403 ? null : Promise.reject(e)))
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ศูนย์ตอบแชท</h1>
        <p className="mt-1 text-sm text-muted">
          ข้อความส่วนตัวจากทุกช่องทางในที่เดียว — ตอบแล้วระบบจะจัด "กำลังตอบโดย…" ให้อัตโนมัติ
        </p>
      </div>

      {conversations.length === 0 ? (
        <p className="py-16 text-center text-muted">
          ยังไม่มีบทสนทนา — ข้อความจะเข้ามาเองเมื่อมีผู้ใช้ทักผ่านช่องทางที่เชื่อมต่อ
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <ul className="space-y-2" aria-label="รายการบทสนทนา">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/inbox?c=${c.id}`}
                  className={`block rounded-xl border p-3 transition-colors hover:border-brand ${
                    c.id === selectedId ? 'border-brand bg-brand/5' : 'border-line bg-surface'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.externalUserName ?? 'ผู้ใช้ LINE'}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_TH[c.status].cls}`}
                    >
                      {STATUS_TH[c.status].label}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-1 block text-xs text-muted">
                    {c.lastMessagePreview ?? '—'}
                  </span>
                  <span className="mt-1 flex justify-between text-[11px] text-muted">
                    <span>{c.accountName}</span>
                    <span>{thTime.format(new Date(c.lastMessageAt))}</span>
                  </span>
                  {c.slaDueAt && c.status !== 'closed' && (
                    <span
                      className={`mt-1 block text-[11px] ${c.slaEscalatedAt ? 'text-danger' : 'text-warn'}`}
                    >
                      {c.slaEscalatedAt
                        ? '⚠ เกิน SLA — รอการตอบ'
                        : `ตอบภายใน ${thTime.format(new Date(c.slaDueAt))}`}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {selected && (
            <section className="flex flex-col rounded-xl border border-line bg-surface">
              <header className="flex flex-wrap items-center gap-2 border-b border-line p-4">
                <h2 className="font-medium">{selected.externalUserName ?? 'ผู้ใช้ LINE'}</h2>
                <span className="text-sm text-muted">· {selected.accountName}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${STATUS_TH[selected.status].cls}`}
                >
                  {STATUS_TH[selected.status].label}
                </span>
                {selected.assignee && (
                  <span className="ml-auto text-xs text-muted">กำลังตอบโดย {selected.assignee}</span>
                )}
              </header>
              {profile && (
                <p
                  className="border-b border-line px-4 py-2 text-xs text-muted"
                  title="โปรไฟล์ผู้ติดต่อ (CRM-01)"
                >
                  CRM: ติดต่อครั้งแรก {thTime.format(new Date(profile.stats.firstContactAt))} · รับ{' '}
                  {profile.stats.received.toLocaleString('th-TH')} / ส่ง{' '}
                  {profile.stats.sent.toLocaleString('th-TH')} ข้อความ
                  {profile.otherThreads.length > 1 &&
                    ` · พบผู้ใช้เดียวกันในอีก ${profile.otherThreads.length - 1} บัญชี`}
                </p>
              )}
              <ul className="flex-1 space-y-2 overflow-y-auto p-4" aria-label="ข้อความ">
                {(messages ?? []).map((m) => {
                  if (m.status === 'pending' || m.status === 'rejected') {
                    return (
                      <li
                        key={m.id}
                        className={`ml-auto max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                          m.status === 'pending'
                            ? 'bg-warn/10 ring-1 ring-warn'
                            : 'bg-danger/5 ring-1 ring-danger/40'
                        }`}
                      >
                        {m.text}
                        <span className="mt-0.5 block text-[10px] text-warn">
                          {m.status === 'pending'
                            ? '⏳ รอหัวหน้าอนุมัติ (เนื้อหาอ่อนไหว) — ยังไม่ได้ส่งถึงลูกค้า'
                            : '✕ ถูกตีกลับ กรุณาร่างใหม่'}
                        </span>
                        <span className="block text-[10px] opacity-70">
                          {thTime.format(new Date(m.createdAt))}
                        </span>
                        <div className="mt-1.5">
                          <PendingReview messageId={m.id} />
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li
                      key={m.id}
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                        m.direction === 'in'
                          ? m.isAutoReply
                            ? 'ml-auto bg-line/70 text-muted italic'
                            : 'bg-line text-ink'
                          : 'ml-auto bg-brand text-brand-ink'
                      }`}
                    >
                      {m.isAutoReply && (
                        <span className="block text-[10px] opacity-70">
                          ตอบอัตโนมัติ (นอกเวลาทำการ)
                        </span>
                      )}
                      {m.text}
                      <span className="mt-0.5 block text-[10px] opacity-70">
                        {thTime.format(new Date(m.createdAt))}
                      </span>
                    </li>
                  );
                })}
                {(messages ?? []).length === 0 && (
                  <li className="text-center text-sm text-muted">ยังไม่มีข้อความในบทสนทนานี้</li>
                )}
              </ul>
              <div className="border-t border-line p-4">
                <ConversationActions id={selected.id} status={selected.status} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
