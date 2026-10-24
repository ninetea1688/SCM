/**
 * Inbox desk rules — INBOX-07/08/09.
 * All thresholds are defaults (PRD §0): workspaces override them via settings.
 * Timezone is the workspace's (Asia/Bangkok — no DST, fixed +7).
 */

export interface WorkingHours {
  /** 'HH:MM' in workspace time. */
  start: string;
  end: string;
  /** ISO weekdays (1 = Monday … 7 = Sunday) counted as working days. Empty = never open. */
  workdays: number[];
}

/** Thai government office hours. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  start: '08:30',
  end: '16:30',
  workdays: [1, 2, 3, 4, 5],
};

/** INBOX-07: is `at` inside the configured working hours (Bangkok wall clock)? */
export function isWithinWorkingHours(
  at: Date,
  hours: WorkingHours = DEFAULT_WORKING_HOURS,
): boolean {
  const bangkok = new Date(at.getTime() + 7 * 3600_000);
  const day = bangkok.getUTCDay();
  if (!hours.workdays.includes(day)) return false;
  const minutes = bangkok.getUTCHours() * 60 + bangkok.getUTCMinutes();
  const [sh, sm] = hours.start.split(':').map(Number);
  const [eh, em] = hours.end.split(':').map(Number);
  return minutes >= sh! * 60 + sm! && minutes < eh! * 60 + em!;
}

/** INBOX-07: a short polite auto-reply for out-of-hours contacts. */
export function autoReplyText(hours: WorkingHours = DEFAULT_WORKING_HOURS): string {
  return (
    `ขอบคุณสำหรับข้อความครับ/ค่ะ ขณะนี้อยู่นอกเวลาทำการ ` +
    `(เปิดให้บริการ ${hours.start}–${hours.end} น. วันจันทร์–ศุกร์) ` +
    `เจ้าหน้าที่จะตอบกลับโดยเร็วในเวลาทำการครับ/ค่ะ`
  );
}

/**
 * INBOX-08: how long after a contact's inbound message the human agent may still reply
 * (platform policy), in hours; null = unlimited (LINE OA push has no window).
 * Docs (verify before changing): https://developers.facebook.com/docs/messenger-platform/policy/policy-overview
 */
/** INBOX-08: platform reply windows — hours after an inbound message (null = unlimited). */
export const REPLY_WINDOW_HOURS = {
  line: null,
  facebook: 24,
  instagram: 24,
  tiktok: null, // DM API is P5; no published window yet
  youtube: null,
  /** Source for the numbers above (never inline a limit elsewhere — non-negotiable #6). */
  source: 'https://developers.facebook.com/docs/messenger-platform/policy/policy-overview',
  verifiedAt: 'unverified',
} satisfies Record<string, number | null | string>;

/** INBOX-08: platform reply windows — hours after an inbound message (null = unlimited). */
const REPLY_WINDOW_TABLE = {
  line: null,
  facebook: 24,
  instagram: 24,
  tiktok: null, // DM API is P5; no published window yet
  youtube: null,
} satisfies Record<string, number | null>;

export function replyWindowHours(platform: string): number | null {
  return REPLY_WINDOW_TABLE[platform as keyof typeof REPLY_WINDOW_TABLE] ?? null;
}

/** Deadline for replying to an inbound message, or null when the channel has no window. */
export function replyWindowUntil(platform: string, inboundAt: Date): Date | null {
  const h = replyWindowHours(platform);
  return h === null ? null : new Date(inboundAt.getTime() + h * 3600_000);
}

/** INBOX-08: warn the desk this long before the window closes. */
export const REPLY_WINDOW_WARN_MIN = 120;

/**
 * INBOX-09: keywords that mark a reply as sensitive — agents draft, a supervisor approves
 * before it goes out. Workspace settings may replace/extend this list (MOD-02 companion).
 */
export const DEFAULT_SENSITIVE_KEYWORDS = [
  'ฟ้อง',
  'ร้องเรียน',
  'ร้องทุกข์',
  'ทนาย',
  'กฎหมาย',
  'สื่อมวลชน',
  'ข่าว',
  'จ่ายเงิน',
  'ชดเชย',
  'อนุมัติงบ',
  'ความลับ',
  'ข้อมูลส่วนบุคคล',
];

export function isSensitiveReply(text: string, keywords: readonly string[]): boolean {
  return keywords.some((k) => k.length > 0 && text.toLowerCase().includes(k.toLowerCase()));
}

/** NOTI-02/03: the types staff can toggle per user/channel (P1 subset + system alerts). */
export const NOTIFICATION_TYPES = [
  'publish_failed',
  'account_disconnected',
  'approval_requested',
  'approval_reminder',
  'token_expiring',
  'system_alert',
] as const;
