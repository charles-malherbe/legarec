import { describe, expect, it } from 'vitest';
import { ago, capitalized, dayOf, daysAgo, longMoment, timeOf } from './format';

const at = (text: string) => new Date(text);
// In Paris: 2 pm, winter time.
const now = at('2026-11-25T13:00:00Z');

describe('dates, as one reads them in Paris', () => {
  it.each([
    ['2026-11-25T12:59:30Z', 'à l’instant'],
    ['2026-11-25T13:00:30Z', 'à l’instant'],
    ['2026-11-25T12:48:00Z', 'il y a 12 min'],
    ['2026-11-25T12:00:00Z', 'aujourd’hui à 13:00'],
    ['2026-11-24T23:30:00Z', 'aujourd’hui à 00:30'],
    ['2026-11-24T22:30:00Z', 'hier à 23:30'],
    ['2026-11-23T23:30:00Z', 'hier à 00:30'],
    ['2026-11-18T10:00:00Z', '18 nov.'],
    ['2025-11-18T10:00:00Z', '18 nov. 2025'],
  ])('%s: %s', (date, text) => expect(ago(at(date), now)).toBe(text));

  it('follows the summer time', () => {
    expect(timeOf(at('2026-07-01T10:00:00Z'))).toBe('12:00');
    expect(dayOf(at('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
    expect(daysAgo(at('2026-03-28T22:30:00Z'), at('2026-03-29T10:00:00Z'))).toBe('YESTERDAY');
    expect(daysAgo(at('2026-10-24T21:00:00Z'), at('2026-10-25T22:00:00Z'))).toBe('YESTERDAY');
  });

  it('writes a full date', () => {
    expect(longMoment(at('2026-11-25T13:05:00Z'))).toBe('25 novembre 2026 à 14:05');
    expect(capitalized('il y a')).toBe('Il y a');
    expect(capitalized('')).toBe('');
  });
});
