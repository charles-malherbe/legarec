import { litigationData, shellData } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let reference = 70_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });

/** A case of a new creditor, owing `cents`; its mandate asks for the creditor's agreement or not, or there is none. */
const caseOf = async (officer: string | null, name: string, { cents = 120_000, consent = null as boolean | null, status = 'OVERDUE' } = {}) => {
  const [creditor] = await rows<{ id: string }>('INSERT INTO creditors (name) VALUES ($1) RETURNING id', [name]);
  const mandate =
    consent === null
      ? null
      : (
          await rows<{ id: string }>(
            `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
             VALUES ($1, '2026-01-01', 800, 1200, 6, 500, $2, 'NONE', false, 5, 'BUSINESS') RETURNING id`,
            [creditor!.id, consent],
          )
        )[0]!.id;
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('COMPANY', $1) RETURNING id", [`Débiteur ${name}`]);
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, mandate_id, status) VALUES ($1, $2, $3, $4, $5, $6::case_status) RETURNING id',
    [`LGR-2026-${(reference += 1)}`, creditor!.id, debtor!.id, officer, mandate, status],
  );
  if (cents)
    await rows(
      "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-01-01', '2026-02-01', $3, $3)",
      [made!.id, creditor!.id, cents],
    );
  return made!.id;
};
const open = (as: string, ids: string[], consentReceived = false) => call(as, 'POST', '/cases/litigation', { ids, reason: 'Promesses non tenues', consentReceived });
const fileOf = async (as: string, caseId: string) => litigationData.parse((await call(as, 'GET', '/litigation')).body).cases.find((item) => item.caseId === caseId);

beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('litigation in a minimal follow-up', () => {
  it('opens at the formal notice, waits for the agreement of the creditor, then goes one step at a time', async () => {
    const id = await caseOf(test.s.officerA, 'Contentieux Alpha', { consent: true });
    expect((await open('officerA', [id])).status).toBe(204);
    expect(await rows('SELECT status FROM cases WHERE id = $1', [id])).toEqual([{ status: 'LITIGATION' }]);
    let file = (await fileOf('officerA', id))!;
    expect(file).toMatchObject({ stage: 0, consent: 'WAITING', amount: 120_000, balance: 120_000, canAct: true, version: 1 });
    // No step that engages costs before the agreement, nor a jump over a step.
    expect((await call('officerA', 'POST', `/litigation/${file.id}/stage`, { stage: 'PAYMENT_ORDER', version: 1 })).body).toEqual({ code: 'CONSENT_AWAITED' });
    expect((await call('officerA', 'POST', `/litigation/${file.id}/consent`, { version: 1 })).status).toBe(204);
    expect((await call('officerA', 'POST', `/litigation/${file.id}/stage`, { stage: 'ENFORCEABLE_TITLE', version: 2 })).body).toEqual({ code: 'CHANGED' });
    expect((await call('officerA', 'POST', `/litigation/${file.id}/stage`, { stage: 'PAYMENT_ORDER', version: 1 })).body).toEqual({ code: 'CHANGED' });
    expect((await call('officerA', 'POST', `/litigation/${file.id}/stage`, { stage: 'PAYMENT_ORDER', version: 2 })).status).toBe(204);
    expect((await call('officerA', 'PUT', `/litigation/${file.id}`, { court: 'Tribunal de commerce de Lyon', partnerName: 'Me Durieux', version: 3 })).status).toBe(204);
    file = (await fileOf('officerA', id))!;
    expect(file).toMatchObject({ stage: 1, consent: 'RECEIVED', court: 'Tribunal de commerce de Lyon', partnerName: 'Me Durieux', version: 4 });
    expect(file.events.map((event) => event.title)).toEqual(['Passage en contentieux', 'Accord écrit du créancier reçu', 'Contentieux : Injonction de payer']);
    // PostgreSQL notes who ticked the agreement, and when.
    expect(await rows('SELECT consent_noted_by = $2 AS noted, stage_since = current_date AS today FROM litigation_files WHERE case_id = $1', [id, test.s.officerA])).toEqual([
      { noted: true, today: true },
    ]);
    // The creditor reads the steps, never the reason typed by the team, nor the court or the partner.
    expect(await rows('SELECT title FROM case_events WHERE case_id = $1 AND visible_to_creditor ORDER BY occurred_at', [id])).toEqual([
      { title: 'Passage en contentieux' },
      { title: 'Accord écrit du créancier reçu' },
      { title: 'Contentieux : Injonction de payer' },
    ]);
    expect(await rows("SELECT detail FROM case_events WHERE case_id = $1 AND kind = 'LITIGATION_REASON'", [id])).toEqual([{ detail: 'Promesses non tenues' }]);
    expect(await rows("SELECT action, params FROM audit_log WHERE entity_id = $1 AND action LIKE 'LITIGATION%' ORDER BY id", [id])).toEqual([
      { action: 'LITIGATION_OPENED', params: {} },
      { action: 'LITIGATION_CONSENT_NOTED', params: {} },
      { action: 'LITIGATION_STAGE_CHANGED', params: { stage: 2 } },
    ]);
  });

  it('needs no agreement when the mandate does not ask for one, and notes one ticked at the transfer', async () => {
    const free = await caseOf(test.s.officerA, 'Contentieux Libre', { consent: false });
    const ticked = await caseOf(test.s.officerA, 'Contentieux Coché', { consent: true });
    const unknown = await caseOf(test.s.officerA, 'Contentieux Sans Mandat');
    expect((await open('officerA', [free, ticked], true)).status).toBe(204);
    expect((await open('officerA', [unknown])).status).toBe(204);
    expect((await fileOf('officerA', free))!.consent).toBe('NOT_NEEDED');
    expect((await fileOf('officerA', ticked))!.consent).toBe('RECEIVED');
    // Without a mandate, its rule is unknown: the agreement is awaited.
    expect((await fileOf('officerA', unknown))!.consent).toBe('WAITING');
  });

  it('refuses a closed case, one already in litigation, one with a plan being decided, all or nothing', async () => {
    const fresh = await caseOf(test.s.officerA, 'Contentieux Frais');
    const settled = await caseOf(test.s.officerA, 'Contentieux Soldé', { status: 'SETTLED' });
    const planned = await caseOf(test.s.officerA, 'Contentieux Échéancier');
    await rows(
      `INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by)
       SELECT id, creditor_id, 120000, 8, 'TRANSFER', '2026-12-15', 'PENDING_MANAGER', 6, false, $2 FROM cases WHERE id = $1`,
      [planned, test.s.officerA],
    );
    expect((await open('officerA', [fresh, settled])).body).toEqual({ code: 'CASE_CLOSED' });
    expect((await open('officerA', [fresh, planned])).body).toEqual({ code: 'PLAN_IN_PROGRESS' });
    expect(await rows('SELECT status FROM cases WHERE id = $1', [fresh])).toEqual([{ status: 'OVERDUE' }]);
    expect((await open('officerA', [fresh])).status).toBe(204);
    expect((await open('officerA', [fresh])).body).toEqual({ code: 'ALREADY_IN_LITIGATION' });
  });

  it('is read by whoever reads the case, followed only by whoever acts on it', async () => {
    const mine = await caseOf(test.s.officerA, 'Contentieux Cloison', { consent: false });
    const directors = await caseOf(test.s.director, 'Contentieux Direction', { consent: false });
    // Not on a case of another officer, nor on one the Director does not hold.
    expect((await open('officerB', [mine])).status).toBe(404);
    expect((await open('director', [mine])).status).toBe(403);
    expect((await open('director', [directors])).status).toBe(204);
    expect((await open('officerA', [mine])).status).toBe(204);
    const file = (await fileOf('director', mine))!;
    expect(file.canAct).toBe(false);
    expect(await fileOf('officerB', mine)).toBeUndefined();
    expect((await fileOf('manager', mine))!.canAct).toBe(true);
    expect((await call('director', 'POST', `/litigation/${file.id}/stage`, { stage: 'PAYMENT_ORDER', version: 1 })).status).toBe(403);
    expect((await call('officerB', 'PUT', `/litigation/${file.id}`, { court: 'x', partnerName: '', version: 1 })).status).toBe(404);
    expect((await call('developer', 'GET', '/litigation')).status).toBe(403);
    // The rules hold in PostgreSQL too, whoever writes.
    await expect(rows("UPDATE litigation_files SET stage = 'ENFORCEMENT' WHERE id = $1", [file.id])).rejects.toThrow(/one step at a time/u);
  });

  it('closes as settled when nothing is left to pay, as lost otherwise, and nothing moves after', async () => {
    const owing = await caseOf(test.s.officerA, 'Contentieux Perdu', { consent: false });
    const paid = await caseOf(test.s.officerA, 'Contentieux Recouvré', { consent: false, cents: 0 });
    expect((await open('officerA', [owing, paid])).status).toBe(204);
    const lost = (await fileOf('officerA', owing))!;
    expect((await call('officerA', 'POST', `/litigation/${lost.id}/stage`, { stage: 'CLOSED', expectedOutcome: 'SETTLED', version: 1 })).body).toEqual({
      code: 'CHANGED',
    });
    expect((await call('officerA', 'POST', `/litigation/${lost.id}/stage`, { stage: 'CLOSED', expectedOutcome: 'LOST', version: 1 })).status).toBe(204);
    const settled = (await fileOf('officerA', paid))!;
    expect((await call('officerA', 'POST', `/litigation/${settled.id}/stage`, { stage: 'CLOSED', expectedOutcome: 'SETTLED', version: 1 })).status).toBe(204);
    expect(await rows('SELECT status, closed_on IS NOT NULL AS closed FROM cases WHERE id = ANY($1::uuid[]) ORDER BY status', [[owing, paid]])).toEqual([
      { status: 'SETTLED', closed: true },
      { status: 'LOST', closed: true },
    ]);
    expect((await fileOf('officerA', owing))!).toMatchObject({ stage: 4, canAct: false });
    expect((await call('officerA', 'PUT', `/litigation/${lost.id}`, { court: 'x', partnerName: '', version: 2 })).body).toEqual({ code: 'LITIGATION_CLOSED' });
    await expect(rows("UPDATE litigation_files SET court = 'x' WHERE id = $1", [lost.id])).rejects.toThrow(/litigation closed/u);
  });

  it('counts in the menu the agreements one may note', async () => {
    const id = await caseOf(test.s.officerB, 'Contentieux Compteur', { consent: true });
    const before = shellData.parse((await call('officerB', 'GET', '/shell')).body).counts.litigationUrgent;
    expect((await open('officerB', [id])).status).toBe(204);
    expect(shellData.parse((await call('officerB', 'GET', '/shell')).body).counts.litigationUrgent).toBe(before + 1);
    // The Director acts on none of them.
    expect(shellData.parse((await call('director', 'GET', '/shell')).body).counts.litigationUrgent).toBe(0);
  });
});
