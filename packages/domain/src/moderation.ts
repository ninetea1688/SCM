/**
 * MOD-01..03 comment moderation — PRD §6.11.
 * MOD-02: every list is workspace-configurable (settings.moderation) — these are defaults.
 * Classification: a forbidden word hides the comment automatically; a borderline word puts
 * it in the human-decision queue (MOD-03); staff can unhide anything.
 */

export interface ModerationConfig {
  /** Auto-hide (MOD-01): spam, dangerous links, profanity. */
  forbiddenWords: string[];
  /** MOD-03: borderline phrasing → human decision queue instead of auto-hide. */
  borderlineWords: string[];
  /** MOD-02: accounts whose comments always go to the review queue. */
  watchAccounts: string[];
}

export const DEFAULT_MODERATION: ModerationConfig = {
  forbiddenWords: ['bit.ly', 'tinyurl', 'คาสิโน', 'พนัน', 'หื่น'],
  borderlineWords: ['ห่วย', 'ไร้สมรรถนะ', 'ขอความเป็นธรรม', 'เมิน'],
  watchAccounts: [],
};

export type CommentVerdict = 'clean' | 'forbidden' | 'borderline';

/** MOD-02/03: decide what to do with an inbound comment before storing it. */
export function classifyComment(
  text: string,
  authorName: string | null,
  config: ModerationConfig,
): CommentVerdict {
  const haystack = `${text}\n${authorName ?? ''}`.toLowerCase();
  if (config.forbiddenWords.some((w) => w.length > 0 && haystack.includes(w.toLowerCase()))) {
    return 'forbidden';
  }
  if (config.borderlineWords.some((w) => w.length > 0 && haystack.includes(w.toLowerCase()))) {
    return 'borderline';
  }
  if (authorName && config.watchAccounts.some((a) => a.length > 0 && authorName.includes(a))) {
    return 'borderline';
  }
  return 'clean';
}
