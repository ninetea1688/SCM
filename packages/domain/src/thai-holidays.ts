/**
 * Thai government holidays — PRD CAL-03 (P1).
 *
 * Structure: fixed-date holidays are computed for any year with the official
 * weekend-observation rule (Sat → Mon, Sun → Mon). Moveable Buddhist days and
 * cabinet-decreed special/observed dates change every year, so they live in the
 * curated ANNUAL table below — re-verify each year against the cabinet
 * resolution (ค่าเริ่มต้นตามหลัก PRD §0: ข้อมูลมีแหล่งอ้างอิงเสมอ).
 *
 * Source (2569/2026): มติ ครม. กำหนดวันหยุดราชการประจำปี พ.ศ. 2569
 * https://calendar.kapook.com/2569/holiday — verified 2026-10-23.
 * Observances (พืชมงคล) are shown in the UI but are NOT holidays.
 */

export type HolidayKind = 'holiday' | 'observed' | 'special' | 'observance';

export interface ThaiHoliday {
  nameTh: string;
  kind: HolidayKind;
}

interface FixedHoliday {
  month: number; // 1–12
  day: number;
  nameTh: string;
}

const OBSERVED = (nameTh: string): ThaiHoliday => ({ nameTh, kind: 'observed' });

/** Same date every year (พ.ศ./ค.ศ. irrelevant). */
const FIXED: readonly FixedHoliday[] = [
  { month: 1, day: 1, nameTh: 'วันขึ้นปีใหม่' },
  { month: 4, day: 6, nameTh: 'วันจักรี' },
  { month: 4, day: 13, nameTh: 'วันสงกรานต์' },
  { month: 4, day: 14, nameTh: 'วันสงกรานต์' },
  { month: 4, day: 15, nameTh: 'วันสงกรานต์' },
  { month: 5, day: 1, nameTh: 'วันแรงงานแห่งชาติ' },
  { month: 5, day: 4, nameTh: 'วันฉัตรมงคล' },
  { month: 7, day: 28, nameTh: 'วันเฉลิมพระชนมพรรษา ร.10' },
  { month: 8, day: 12, nameTh: 'วันแม่แห่งชาติ (วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ)' },
  { month: 10, day: 13, nameTh: 'วันคล้ายวันสวรรคต ร.9' },
  { month: 10, day: 23, nameTh: 'วันปิยมหาราช' },
  { month: 12, day: 5, nameTh: 'วันพ่อแห่งชาติ (วันคล้ายวันพระบรมราชสมภพ ร.9)' },
  { month: 12, day: 10, nameTh: 'วันรัฐธรรมนูญ' },
  { month: 12, day: 31, nameTh: 'วันสิ้นปี' },
];

/**
 * Moveable + decree days, keyed 'MM-DD'. Kept per calendar year so the map can
 * be re-verified annually; falls back to FIXED-only for years not listed.
 */
const ANNUAL: Readonly<Record<number, Readonly<Record<string, ThaiHoliday>>>> = {
  // พ.ศ. 2569 / ค.ศ. 2026
  2026: {
    '01-02': { nameTh: 'วันหยุดพิเศษ (มติ ครม.)', kind: 'special' },
    '03-03': { nameTh: 'วันมาฆบูชา', kind: 'holiday' },
    '05-13': { nameTh: 'วันพืชมงคล', kind: 'observance' },
    '05-31': { nameTh: 'วันวิสาขบูชา', kind: 'holiday' },
    '06-01': OBSERVED('วันหยุดชดเชยวันวิสาขบูชา'),
    '06-03': { nameTh: 'วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี', kind: 'holiday' },
    '07-29': { nameTh: 'วันอาสาฬหบูชา', kind: 'holiday' },
    '07-30': { nameTh: 'วันเข้าพรรษา', kind: 'holiday' },
    '12-07': OBSERVED('วันหยุดชดเชยวันพ่อแห่งชาติ'),
  },
};

const key = (month: number, day: number) =>
  `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Day of week for a plain calendar date (0=Sun … 6=Sat), timezone-independent. */
const weekday = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/**
 * Holidays for one calendar year, keyed 'MM-DD'. A fixed holiday falling on a
 * weekend adds the following Monday as an `observed` day (official rule),
 * unless the annual table already covers that date.
 */
export function thaiHolidays(year: number): Map<string, ThaiHoliday> {
  const out = new Map<string, ThaiHoliday>();
  const annual = ANNUAL[year] ?? {};
  for (const h of FIXED) {
    out.set(key(h.month, h.day), { nameTh: h.nameTh, kind: 'holiday' });
    const wd = weekday(year, h.month, h.day);
    if (wd === 0 || wd === 6) {
      const monday = new Date(Date.UTC(year, h.month - 1, h.day + (wd === 6 ? 2 : 1)));
      const k = key(monday.getUTCMonth() + 1, monday.getUTCDate());
      if (!annual[k]) out.set(k, OBSERVED(`วันหยุดชดเชย${h.nameTh}`));
    }
  }
  for (const [k, v] of Object.entries(annual)) out.set(k, v);
  return out;
}

/** Lookup for a plain date. Returns undefined on working days. */
export function thaiHolidayOn(year: number, month: number, day: number): ThaiHoliday | undefined {
  return thaiHolidays(year).get(key(month, day));
}

/** True when the date blocks government work (observances do not). */
export function isThaiHoliday(year: number, month: number, day: number): boolean {
  const h = thaiHolidayOn(year, month, day);
  return h !== undefined && h.kind !== 'observance';
}
