/**
 * Role-based access — PRD §3.2, amended by ADR-0005:
 * - "หัวหน้า" (supervisor) in INBOX-09 maps to Approver (or above).
 * - Topic Owner is an additive, topic-scoped grant (P4), not a role.
 * - System Admin is a platform-level flag on the user, outside any workspace.
 */

export const ROLES = ['owner', 'admin', 'approver', 'editor', 'agent', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL_TH: Record<Role, string> = {
  owner: 'เจ้าของ',
  admin: 'แอดมิน',
  approver: 'ผู้อนุมัติ',
  editor: 'ผู้สร้างคอนเทนต์',
  agent: 'ผู้ตอบแชท',
  viewer: 'ผู้ดูรายงาน',
};

export const PERMISSIONS = [
  'account.connect',
  'member.manage',
  'post.edit',
  'post.approve',
  'post.schedule',
  'inbox.reply',
  'inbox.reply_sensitive',
  'inbox.draft_sensitive',
  'kb.edit',
  'kb.propose',
  'report.view',
  'report.view_own',
  'audit.view',
  'killswitch.toggle',
  'workspace.policy',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_CONTENT: Permission[] = [
  'post.edit',
  'post.approve',
  'post.schedule',
  'inbox.reply',
  'inbox.reply_sensitive',
  'inbox.draft_sensitive',
  'kb.edit',
  'kb.propose',
  'report.view',
  'killswitch.toggle',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...ALL_CONTENT, 'account.connect', 'member.manage', 'audit.view', 'workspace.policy'],
  admin: [...ALL_CONTENT, 'account.connect', 'member.manage', 'audit.view'],
  approver: ALL_CONTENT,
  editor: ['post.edit', 'report.view'],
  agent: ['inbox.reply', 'inbox.draft_sensitive', 'kb.propose', 'report.view_own'],
  viewer: ['report.view'],
};

/** Roles that require 2FA (PRD AUTH-04). */
export const ROLES_REQUIRING_2FA: readonly Role[] = ['owner', 'admin'];

/** Minimum owners per workspace (PRD AUTH-06). */
export const MIN_OWNERS = 2;

export interface Scope {
  /** Empty/undefined = all accounts in the workspace (PRD AUTH-03). */
  socialAccountIds?: readonly string[];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canOnAccount(
  role: Role,
  permission: Permission,
  scope: Scope,
  socialAccountId: string,
): boolean {
  if (!can(role, permission)) return false;
  const ids = scope.socialAccountIds;
  return !ids || ids.length === 0 || ids.includes(socialAccountId);
}

/**
 * AUTH-06: can this membership change be applied without dropping below MIN_OWNERS?
 * A brand-new workspace starts with one owner and is flagged until a second is added;
 * what is forbidden is *reducing* the count when already at or below the minimum.
 */
export function ownerChangeAllowed(currentOwnerCount: number, delta: number): boolean {
  if (delta >= 0) return true;
  return currentOwnerCount + delta >= MIN_OWNERS;
}
