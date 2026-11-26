import { describe, expect, it } from 'vitest';
import { capOf, capPeriod } from './contact-rules';

describe('the caps of contacts', () => {
  it('counts a cap over the week from Monday, or the month for letters, and keeps the strict one when unreadable', () => {
    expect(capPeriod('CALL', '2026-11-26')).toEqual(['2026-11-23', '2026-11-29']);
    expect(capPeriod('LETTER', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28']);
    expect(capOf('SMS', () => '3')).toEqual({ cap: 3, unit: 'SMS par semaine' });
    expect(capOf('SMS', () => 'beaucoup').cap).toBe(1);
  });
});
