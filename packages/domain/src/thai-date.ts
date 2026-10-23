/** Date display rules — PRD CAL-03, NFR-08: Asia/Bangkok, Buddhist Era alongside CE. */

export const TZ = 'Asia/Bangkok';
const BE_OFFSET = 543;

const dateFmt = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const ceYearFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric' });

/** e.g. "23 ต.ค. 2569" */
export function formatThaiDate(d: Date): string {
  return dateFmt.format(d);
}

/** e.g. "23 ต.ค. 2569 (2026) 14:05 น." */
export function formatThaiDateTime(d: Date, withCe = true): string {
  const ce = withCe ? ` (${ceYearFmt.format(d)})` : '';
  return `${dateFmt.format(d)}${ce} ${timeFmt.format(d)} น.`;
}

export function toBuddhistYear(ceYear: number): number {
  return ceYear + BE_OFFSET;
}

export function toCommonEraYear(beYear: number): number {
  return beYear - BE_OFFSET;
}
