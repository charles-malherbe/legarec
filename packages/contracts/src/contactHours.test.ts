import { describe, expect, it } from 'vitest';
import { contactHours, hoursProblem, publicHolidays, readHours } from './contactHours';
import { settingProblems, firmGroups } from './settingsCatalogue';

const set = (values: Record<string, string>) => contactHours((field) => values[field] ?? '09:00–19:00');
const defaults = contactHours(() => 'illisible');

describe('the hours a debtor may be contacted (question 160)', () => {
  it('knows the public holidays, Easter Monday and Ascension included', () => {
    const days = publicHolidays(2027);
    expect(days.has('2027-03-29')).toBe(true);
    expect(days.has('2027-05-06')).toBe(true);
    expect(days.has('2027-05-17')).toBe(true);
    expect(days.size).toBe(11);
    expect(publicHolidays(2026).has('2026-04-06')).toBe(true);
  });

  it('refuses Sundays and holidays whatever is set, and keeps the former hours when a value cannot be read', () => {
    expect(defaults.outsideHours('EMAIL', '2026-11-29', '10:00')).toMatch(/^Dimanche/u);
    expect(defaults.outsideHours('LETTER', '2026-12-25', null)).toMatch(/^Jour férié/u);
    expect(defaults.outsideHours('CALL', '2026-11-28', '14:00')).toBe('14:00 : hors des plages autorisées (09:00–12:00)');
    expect(defaults.outsideHours('SMS', '2026-11-28', '14:00')).toBeNull();
    expect(defaults.outsideHours('EMAIL', '2026-11-27', '08:30')).toBe('08:30 : hors des plages autorisées (09:00–19:00)');
    expect(defaults.outsideHours('CALL', '2026-11-27', null)).toBeNull();
    expect(defaults.outsideHours('LETTER', '2026-11-28', null)).toBeNull();
  });

  it('follows the hours set day by day, and no contact on a day left empty', () => {
    const hours = set({ 'call-sat': '09:00–17:00', 'call-mon': '', 'send-wed': '10:30 - 16:00' });
    expect(hours.outsideHours('CALL', '2026-11-28', '15:00')).toBeNull();
    expect(hours.outsideHours('CALL', '2026-11-23', '10:00')).toBe('Lundi : aucun contact ce jour-là');
    expect(hours.outsideHours('EMAIL', '2026-11-23', '10:00')).toBeNull();
    expect(hours.outsideHours('SMS', '2026-11-25', '10:00')).toBe('10:00 : hors des plages autorisées (10:30–16:00)');
    // A letter has no hour.
    expect(hours.outsideHours('LETTER', '2026-11-23', null)).toBeNull();
  });

  it('reads a range, refuses one written wrong or ending before it starts', () => {
    expect(readHours('08:15–18:45')).toEqual(['08:15', '18:45']);
    expect(readHours('  ')).toBe('NONE');
    expect(readHours('19:00–09:00')).toBeNull();
    expect(hoursProblem('')).toBeNull();
    expect(hoursProblem('9h–19h')).toBe('Format attendu : 09:00–19:00, ou vide pour aucun contact ce jour-là.');
    expect(hoursProblem('19:00–09:00')).toBe('L’heure de fin doit suivre l’heure de début.');
    const relances = firmGroups()
      .flatMap((group) => group.items)
      .find((item) => item.id === 'relances')!;
    expect(settingProblems(relances, { 'call-sat': '25:00–26:00', 'send-mon': '', calls: '2' })).toEqual({
      'call-sat': 'Format attendu : 09:00–19:00, ou vide pour aucun contact ce jour-là.',
    });
  });
});
