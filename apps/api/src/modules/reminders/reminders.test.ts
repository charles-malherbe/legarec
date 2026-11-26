import { agenda, reminderPlanned } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { publicHolidays } from './contact-rules';

let test: TestApp;
let reference = 50_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
/** A Thursday of next week or later, never a public holiday: inside the agenda, inside the hours. */
const THURSDAY = (() => {
  let day = Date.now() + 7 * 86_400_000;
  const iso = () => new Date(day).toISOString().slice(0, 10);
  while (new Date(day).getUTCDay() !== 4 || publicHolidays(Number(iso().slice(0, 4))).has(iso())) day += 86_400_000;
  return iso();
})();
const FRIDAY = new Date(Date.parse(`${THURSDAY}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const caseOf = async (debtor: string, officer: string, name: string) => {
  const [creditor] = await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [name]);
  const [made] = await rows<{ id: string }>('INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ($1, $2, $3, $4) RETURNING id', [
    `LGR-2026-${(reference += 1)}`,
    creditor!.id,
    debtor,
    officer,
  ]);
  return made!.id;
};
const plan = (as: string, caseId: string, type: string, time = '10:00', date = THURSDAY) =>
  call(as, 'POST', '/reminders', { caseId, type, date, time, title: 'Relance' });

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('the agenda of the reminders', () => {
  it('warns over the cap of the debtor, counted whatever the creditor, and outside the hours', async () => {
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', 'Bâtiplus Agenda') RETURNING id");
    const mine = await caseOf(debtor!.id, test.s.officerA, 'Agenda Alpha');
    const theirs = await caseOf(debtor!.id, test.s.officerB, 'Agenda Beta');
    // One text a week by default: the one planned by a colleague on another creditor counts.
    expect(reminderPlanned.parse((await plan('officerB', theirs, 'SMS')).body).limit).toBeNull();
    expect(reminderPlanned.parse((await plan('officerA', mine, 'SMS')).body).limit).toBe('Plafond atteint : 1 SMS par semaine pour ce débiteur');
    expect(reminderPlanned.parse((await plan('officerA', mine, 'CALL', '20:00')).body).limit).toBe('20:00 : hors des plages autorisées (09:00–19:00)');
    // Not on a case of another, nor in the past.
    expect((await plan('officerA', theirs, 'CALL')).status).toBe(404);
    expect((await plan('officerA', mine, 'CALL', '10:00', '2020-01-02')).body).toEqual({ code: 'PAST_DATE' });
    expect((await plan('officerA', mine, 'CALL', '10:00', '9999-01-07')).body).toEqual({ code: 'TOO_FAR' });
    // Each reads the reminders of the cases they read.
    const shown = agenda.parse((await call('officerA', 'GET', '/reminders')).body);
    expect(shown.items.filter((item) => item.debtor === 'Bâtiplus Agenda').map((item) => item.type)).toEqual(['SMS', 'CALL']);
  });

  it('is marked done, moved and removed by whoever acts on the case; a done one stays', async () => {
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', 'Studio Agenda') RETURNING id");
    const mine = await caseOf(debtor!.id, test.s.officerA, 'Agenda Gamma');
    const { id } = reminderPlanned.parse((await plan('officerA', mine, 'EMAIL')).body);
    expect((await call('officerB', 'PUT', `/reminders/${id}`, { done: true })).status).toBe(404);
    expect((await call('director', 'PUT', `/reminders/${id}`, { done: true })).status).toBe(403);
    expect((await call('officerA', 'PUT', `/reminders/${id}`, { date: FRIDAY, time: '11:00' })).status).toBe(204);
    expect((await call('officerA', 'PUT', `/reminders/${id}`, { done: true })).status).toBe(204);
    expect((await call('officerA', 'DELETE', `/reminders/${id}`)).status).toBe(403);
    // Done, it stays: neither undone, nor moved, nor removed, even straight in PostgreSQL.
    expect((await call('officerA', 'PUT', `/reminders/${id}`, { done: false })).body).toEqual({ code: 'DONE' });
    expect((await call('officerA', 'PUT', `/reminders/${id}`, { done: true })).status).toBe(204);
    await expect(rows('UPDATE planned_reminders SET done_at = NULL WHERE id = $1', [id])).rejects.toThrow(/reminder done/u);
    expect(await rows("SELECT title FROM case_events WHERE case_id = $1 AND kind LIKE 'REMINDER_%' ORDER BY occurred_at", [mine])).toEqual([
      { title: 'Relance planifiée' },
      { title: 'Relance déplacée' },
      { title: 'Relance faite' },
    ]);
    expect(await rows('SELECT due_on::text, due_time, done_at IS NOT NULL AS done FROM planned_reminders WHERE id = $1', [id])).toEqual([
      { due_on: FRIDAY, due_time: '11:00', done: true },
    ]);
  });

  it('offers only the open cases one acts on', async () => {
    const director = (await call('director', 'GET', '/reminders/targets')).body as { items: { id: string }[] };
    const held = await rows<{ id: string }>('SELECT id FROM cases WHERE officer_id = $1 AND closed_on IS NULL', [test.s.director]);
    expect(director.items.map((item) => item.id).sort()).toEqual(held.map((row) => row.id).sort());
    expect((await call('developer', 'GET', '/reminders')).status).toBe(403);
  });
});
