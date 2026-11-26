import { describe, expect, it } from 'vitest';
import { capOf, capPeriod, outsideHours, publicHolidays } from './contact-rules';

describe('the hours a debtor may be contacted', () => {
  it('knows the public holidays, Easter Monday and Ascension included', () => {
    const days = publicHolidays(2027);
    expect(days.has('2027-03-29')).toBe(true);
    expect(days.has('2027-05-06')).toBe(true);
    expect(days.has('2027-05-17')).toBe(true);
    expect(days.size).toBe(11);
  });

  it('refuses Sundays, holidays and hours outside 9:00–19:00, Saturday afternoon for calls', () => {
    expect(outsideHours('EMAIL', '2026-11-29', '10:00')).toMatch(/^Dimanche/u);
    expect(outsideHours('LETTER', '2026-12-25', null)).toMatch(/^Jour férié/u);
    expect(outsideHours('CALL', '2026-11-28', '14:00')).toBe('14:00 : hors des plages autorisées (09:00–12:00)');
    expect(outsideHours('SMS', '2026-11-28', '14:00')).toBeNull();
    expect(outsideHours('EMAIL', '2026-11-27', '08:30')).toMatch(/^08:30/u);
    expect(outsideHours('CALL', '2026-11-27', null)).toBeNull();
  });

  it('counts a cap over the week from Monday, or the month for letters, and keeps the strict one when unreadable', () => {
    expect(capPeriod('CALL', '2026-11-26')).toEqual(['2026-11-23', '2026-11-29']);
    expect(capPeriod('LETTER', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28']);
    expect(capOf('SMS', () => '3')).toEqual({ cap: 3, unit: 'SMS par semaine' });
    expect(capOf('SMS', () => 'beaucoup').cap).toBe(1);
  });
});
