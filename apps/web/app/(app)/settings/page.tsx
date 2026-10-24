/**
 * Settings — PRD §0 (configurable defaults) and the role table ("แอดมินจัดการผู้ใช้
 * สิทธิ์ และการตั้งค่า"): workspace policy, members and the audit trail. Members
 * without member.manage/audit.view (editor/agent/viewer) see the read-only part only.
 */
import type { Role } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';
import { ApiError } from '@/lib/session';
import { BrandKitEditor } from './brand-kit-editor';
import { ModerationEditor, NotificationPrefsEditor } from './settings-extras';
import { AddMemberForm, RevokeButton, SelfApprovalToggle } from './settings-forms';

const ROLE_TH: Record<Role, string> = {
  owner: 'เจ้าของ',
  admin: 'แอดมิน',
  approver: 'ผู้อนุมัติ',
  editor: 'ผู้สร้างคอนเทนต์',
  agent: 'ผู้ตอบแชท',
  viewer: 'ผู้ดูรายการ',
};

interface Current {
  id: string;
  name: string;
  role: Role;
  settings: {
    allowSelfApproval?: boolean;
    moderation?: {
      forbiddenWords?: string[];
      borderlineWords?: string[];
      watchAccounts?: string[];
    };
    brand?: {
      signature?: string;
      defaultHashtags?: string[];
      tone?: string;
      voiceNotes?: string;
      examplePosts?: string[];
    };
  };
}
interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  accountScope: string[] | null;
  totpEnabled: boolean;
  revokedAt: string | null;
}
interface AuditEntry {
  id: number;
  action: string;
  actorUserId: string;
  targetType: string;
  createdAt: string;
}

const thTime = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  dateStyle: 'short',
  timeStyle: 'short',
});

export default async function SettingsPage() {
  const here = '/settings';
  const current = await load<Current>('/workspaces/current', here);
  // member.manage and audit.view are owner/admin — editors and below get read-only.
  const [members, audit] = await Promise.all([
    load<Member[]>('/workspaces/current/members', here).catch((e) =>
      e instanceof ApiError && e.status === 403 ? null : Promise.reject(e),
    ),
    load<AuditEntry[]>('/workspaces/current/audit-log', here).catch((e) =>
      e instanceof ApiError && e.status === 403 ? null : Promise.reject(e),
    ),
  ]);
  const activeMembers = members?.filter((m) => !m.revokedAt) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ตั้งค่า</h1>
        <p className="mt-1 text-sm text-muted">
          Workspace “{current.name}” — สมาชิก นโยบาย และบันทึกระบบ
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">นโยบายการอนุมัติ</h2>
        <SelfApprovalToggle
          initial={current.settings.allowSelfApproval === true}
          canEdit={current.role === 'owner'}
        />
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">การดูแลคอมเมนต์ (MOD-02/03)</h2>
        <p className="text-xs text-muted">
          คำต้องห้าม = ซ่อนอัตโนมัติ · คำก้ำกึ่ง/บัญชีที่เฝ้าระวัง = เข้าคิวให้คนตัดสิน
        </p>
        <ModerationEditor initial={current.settings.moderation ?? {}} />
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">Brand Kit และโทนเสียง (BRAND-01/02)</h2>
        <BrandKitEditor initial={current.settings.brand ?? {}} />
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">การแจ้งเตือนของฉัน (NOTI-03)</h2>
        <p className="text-xs text-muted">เลือกได้ว่าจะรับการแจ้งเตือนประเภทใด ทางช่องทางใด</p>
        <NotificationPrefsEditor />
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">สมาชิก ({activeMembers.length})</h2>
          <Link href="/security" className="text-sm text-brand underline">
            ตั้งค่าความปลอดภัย 2FA ของฉัน
          </Link>
        </div>
        {members ? (
          <>
            <AddMemberForm />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-muted">
                  <tr>
                    <th className="py-2">ชื่อ</th>
                    <th>อีเมล</th>
                    <th>บทบาท</th>
                    <th>2FA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {activeMembers.map((m) => (
                    <tr key={m.userId} className="border-b border-line last:border-0">
                      <td className="py-2">{m.displayName}</td>
                      <td className="text-muted">{m.email}</td>
                      <td>{ROLE_TH[m.role]}</td>
                      <td>{m.totpEnabled ? '✓' : '—'}</td>
                      <td className="text-right">
                        {!(m.role === 'owner' && current.role !== 'owner') && (
                          <RevokeButton userId={m.userId} email={m.email} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activeMembers.filter((m) => m.role === 'owner').length < 2 && (
                <p className="mt-2 text-xs text-warn">
                  AUTH-06: ต้องมีเจ้าของอย่างน้อย 2 คนเสมอ — ระบบจะไม่ให้เพิกถอนเจ้าของจนเหลือน้อยกว่าขั้นต่ำ
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">เฉพาะเจ้าของและแอดมินที่จัดการสมาชิกได้</p>
        )}
      </section>

      {audit && (
        <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 className="font-medium">บันทึกระบบ (ล่าสุด 30 รายการ)</h2>
          <ul className="space-y-1 text-sm">
            {audit.slice(0, 30).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap gap-2 border-b border-line py-1.5 last:border-0"
              >
                <span className="text-muted">{thTime.format(new Date(a.createdAt))}</span>
                <span className="font-medium">{a.action}</span>
                <span className="text-muted">
                  {a.targetType}:{a.actorUserId ? a.actorUserId.slice(0, 8) : 'ระบบ'}
                </span>
              </li>
            ))}
            {audit.length === 0 && <li className="text-muted">ยังไม่มีรายการ</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
