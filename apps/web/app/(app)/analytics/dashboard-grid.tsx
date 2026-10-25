'use client';

/** ANA-05: the 8-layer monitoring dashboard — layers with live data render real
 * aggregates; layers awaiting integrations state so explicitly. */
import { describeError } from '@/lib/client';

export interface Summary {
  content: {
    posts: number;
    reach: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
    engagementRate: number | null;
  };
  conversations: {
    total: number;
    open: number;
    claimed: number;
    closed: number;
    received: number;
    sent: number;
  };
  workflow: { inReview: number; scheduled: number; published: number; failed: number };
  system: { publishSuccessRate: number | null; publishFailed: number; tokenExpiring: number };
  cost: {
    lineMessages: { used: number; limit: number } | null;
    storageBytes: number;
  };
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function Card({
  n,
  title,
  rows,
  unavailable,
}: {
  n: number;
  title: string;
  rows?: [string, string][];
  unavailable?: boolean;
}) {
  return (
    <section className="space-y-1 rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium">
        {n}. {title}
      </h3>
      {unavailable ? (
        <p className="text-xs text-muted">ยังไม่มีแหล่งข้อมูล — จะเปิดใช้พร้อมระบบที่เกี่ยวข้อง</p>
      ) : (
        (rows ?? []).map(([k, v]) => (
          <p key={k} className="flex justify-between text-xs">
            <span className="text-muted">{k}</span>
            <span className="font-medium">{v}</span>
          </p>
        ))
      )}
    </section>
  );
}

const fmt = (n: number) => n.toLocaleString('th-TH');

export function DashboardGrid({ s }: { s: Summary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        n={1}
        title="ผลงานคอนเทนต์"
        rows={[
          ['โพสต์ที่มีข้อมูล', fmt(s.content.posts)],
          ['ผู้เข้าถึงรวม', fmt(s.content.reach)],
          ['การมีส่วนร่วม', `${fmt(s.content.engagement)} (${s.content.engagementRate ?? '—'}%)`],
        ]}
      />
      <Card n={2} title="ผู้ติดตาม" unavailable />
      <Card
        n={3}
        title="การสนทนาและบริการ"
        rows={[
          ['บทสนทนาทั้งหมด', fmt(s.conversations.total)],
          ['รับ / ส่งข้อความ', `${fmt(s.conversations.received)} / ${fmt(s.conversations.sent)}`],
          [
            'เปิด / รับเรื่อง / ปิด',
            `${fmt(s.conversations.open)} / ${fmt(s.conversations.claimed)} / ${fmt(s.conversations.closed)}`,
          ],
        ]}
      />
      <Card n={4} title="บอทและคลังความรู้" unavailable />
      <Card n={5} title="พันธมิตรและข่าว" unavailable />
      <Card
        n={6}
        title="ทีมและ Workflow"
        rows={[
          ['รออนุมัติ', fmt(s.workflow.inReview)],
          ['ตั้งเวลาไว้', fmt(s.workflow.scheduled)],
          ['เผยแพร่แล้ว', fmt(s.workflow.published)],
        ]}
      />
      <Card
        n={7}
        title="ระบบ"
        rows={[
          [
            'โพสต์สำเร็จ',
            s.system.publishSuccessRate === null ? '—' : `${s.system.publishSuccessRate}%`,
          ],
          ['โพสต์ที่ล้มเหลว', fmt(s.system.publishFailed)],
          ['โทเคนใกล้หมดอายุ', fmt(s.system.tokenExpiring)],
        ]}
      />
      <Card
        n={8}
        title="ต้นทุน"
        rows={[
          [
            'LINE โควตาเดือนนี้',
            s.cost.lineMessages
              ? `${fmt(s.cost.lineMessages.used)}/${fmt(s.cost.lineMessages.limit)}`
              : '—',
          ],
          ['Storage ใช้ไป', gb(s.cost.storageBytes)],
        ]}
      />
    </div>
  );
}

export function dashboardError(e: unknown): string {
  return describeError(e);
}
