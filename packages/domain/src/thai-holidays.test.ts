/** CAL-03: Thai government holidays — fixed dates, weekend observation, annual table. */
import { describe, expect, it } from 'vitest';
import { isThaiHoliday, thaiHolidayOn, thaiHolidays } from './thai-holidays';

describe('thaiHolidays (CAL-03)', () => {
  it('fixed holidays land on their date in any year', () => {
    expect(thaiHolidayOn(2027, 12, 10)?.nameTh).toBe('วันรัฐธรรมนูญ');
    expect(thaiHolidayOn(2026, 10, 23)?.nameTh).toBe('วันปิยมหาราช'); // today's date
    expect(thaiHolidayOn(2026, 4, 15)?.nameTh).toBe('วันสงกรานต์');
  });

  it('a fixed holiday on a weekend observes the following Monday', () => {
    // 5 Dec 2026 is a Saturday → Monday 7 Dec is covered by the annual table.
    expect(thaiHolidayOn(2026, 12, 5)?.kind).toBe('holiday');
    expect(thaiHolidayOn(2026, 12, 7)?.kind).toBe('observed');
    // 31 Dec 2029 is a Monday — no observation needed; วันสงกรานต์ 13 เม.ย. 2029 (ศุกร์) none.
    expect(thaiHolidayOn(2029, 12, 31)?.nameTh).toBe('วันสิ้นปี');
    expect(thaiHolidays(2029).has('12-31')).toBe(true);
  });

  it('the annual table carries moveable Buddhist days for 2026', () => {
    expect(thaiHolidayOn(2026, 3, 3)?.nameTh).toBe('วันมาฆบูชา');
    expect(thaiHolidayOn(2026, 7, 29)?.nameTh).toBe('วันอาสาฬหบูชา');
    expect(thaiHolidayOn(2026, 7, 30)?.nameTh).toBe('วันเข้าพรรษา');
    expect(thaiHolidayOn(2026, 6, 1)?.kind).toBe('observed'); // วิสาขบูชา 31 พ.ค. (อาทิตย์)
  });

  it('observances are listed but are not holidays', () => {
    expect(thaiHolidayOn(2026, 5, 13)?.kind).toBe('observance'); // วันพืชมงคล
    expect(isThaiHoliday(2026, 5, 13)).toBe(false);
    expect(isThaiHoliday(2026, 5, 12)).toBe(false); // ordinary Wednesday
    expect(isThaiHoliday(2026, 1, 1)).toBe(true);
  });

  it('years outside the curated table still work with fixed dates only', () => {
    expect(thaiHolidayOn(2035, 1, 1)?.nameTh).toBe('วันขึ้นปีใหม่');
    expect(thaiHolidayOn(2035, 3, 3)).toBeUndefined();
  });
});
