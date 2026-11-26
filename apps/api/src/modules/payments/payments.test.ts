import { caseDetail, interestRates, plansData, planSimulation } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Database, type Transaction } from '../../platform/database/database';
import { dayOf } from '../../platform/format';
import { addDays } from './money';
import { installmentStates } from './plans';

let test: TestApp;
let creditor: string;
let mandate: string;
const today = dayOf(new Date());
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
let reference = 70_000;
/** A case under a mandate at 10 % with the 40 € indemnity, one invoice per amount, the oldest first. */
const makeCase = async (officer: string | null, amounts: number[], kind: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY', dueOn = addDays(today, -73)) => {
  const [debtor] = await rows<{ id: string }>('INSERT INTO debtors (kind, name, siren) VALUES ($1, $2, $3) RETURNING id', [
    kind,
    `Débiteur ${reference}`,
    kind === 'INDIVIDUAL' ? null : String(100_000_000 + reference),
  ]);
  reference += 1;
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, mandate_id, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [`LGR-2026-${reference}`, creditor, debtor!.id, officer, mandate, 'OVERDUE'],
  );
  for (const [index, amount] of amounts.entries()) {
    await rows(
      `INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [made!.id, creditor, `F-${index + 1}`, addDays(dueOn, index - 30), addDays(dueOn, index), amount],
    );
  }
  return made!.id;
};
const detail = async (as: string, id: string) => caseDetail.parse((await call(as, 'GET', `/cases/${id}`)).body);
let chequeNumber = 2_000_000;
const cheque = (amount: number, receivedOn = today) => ({
  method: 'CHEQUE',
  amount,
  chequeNumber: String((chequeNumber += 1)),
  bank: 'Banque Rhône',
  receivedOn,
  depositedOn: null,
});
const pay = async (as: string, id: string, body: unknown, status = 204) => {
  const answer = await call(as, 'POST', `/cases/${id}/payments`, body);
  expect(answer.status, JSON.stringify(answer.body)).toBe(status);
};
const paymentsOf = async (id: string) => rows<{ id: string; status: string }>('SELECT id, status FROM payments WHERE case_id = $1 ORDER BY created_at', [id]);
const versionOf = async (paymentId: string) => (await rows<{ version: number }>('SELECT version FROM payments WHERE id = $1', [paymentId]))[0]!.version;
const set = async (as: string, id: string, paymentId: string, status: string, version?: number) =>
  (await call(as, 'PUT', `/cases/${id}/payments/${paymentId}`, { status, version: version ?? (await versionOf(paymentId)) })).status;
const officer = () => ({ kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] }) as const;
/** As the officer, with their rights in PostgreSQL and nothing of the API. */
const asOfficer = <T>(work: (tx: Transaction) => Promise<T>) => test.app.get(Database).run(officer(), work);

beforeAll(async () => {
  test = await startApp();
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Matériaux Delta') RETURNING id"))[0]!.id;
  mandate = (
    await rows<{ id: string }>(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent,
         interest_mode, contract_rate_bp, fixed_indemnity, reporting_day, scenario)
       VALUES ($1, '2026-01-01', 800, 1200, 6, 500, true, 'CONTRACT', 1000, true, 5, 'BUSINESS') RETURNING id`,
      [creditor],
    )
  )[0]!.id;
});
afterAll(() => test.stop());

describe('a payment', () => {
  it('goes to the interest, then the oldest principal, then the indemnities', async () => {
    const id = await makeCase(test.s.officerA, [100_000, 50_000]);
    const before = await detail('officerA', id);
    // 10 % over 73 and 72 days.
    expect(before.interest).toBe(Math.round((100_000 * 1000 * 73) / 3_650_000) + Math.round((50_000 * 1000 * 72) / 3_650_000));
    expect(before.fees).toBe(8000);
    await pay('officerA', id, cheque(before.interest + 120_000));
    const after = await detail('officerA', id);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ status: 'RECEIVED', allocation: { interest: before.interest, principal: 120_000, fees: 0 } });
    expect(after.principal).toBe(30_000);
    expect(after.interest).toBe(0);
    expect(after.fees).toBe(8000);
    expect(await rows('SELECT number, principal_paid_cents, state FROM case_invoices WHERE case_id = $1 ORDER BY number', [id])).toEqual([
      { number: 'F-1', principal_paid_cents: 100_000, state: 'PAID' },
      { number: 'F-2', principal_paid_cents: 20_000, state: 'PARTIAL' },
    ]);
    // In the history, which the creditor reads.
    expect(await rows('SELECT kind, visible_to_creditor FROM case_events WHERE case_id = $1', [id])).toContainEqual({
      kind: 'PAYMENT_RECORDED',
      visible_to_creditor: true,
    });
  });

  it('never charges an individual interest before the formal notice, nor the 40 €', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    expect(await detail('officerA', id)).toMatchObject({ principal: 100_000, interest: 0, fees: 0 });
  });

  it('a bounced cheque makes everything owed again, exactly, without erasing anything', async () => {
    const id = await makeCase(test.s.officerA, [100_000, 50_000]);
    const before = await detail('officerA', id);
    await pay('officerA', id, cheque(200_000));
    const [payment] = await paymentsOf(id);
    expect(await set('officerA', id, payment!.id, 'BOUNCED')).toBe(204);
    const after = await detail('officerA', id);
    expect({ principal: after.principal, interest: after.interest, fees: after.fees }).toEqual({
      principal: before.principal,
      interest: before.interest,
      fees: before.fees,
    });
    expect(after.payments[0]?.status).toBe('BOUNCED');
    const entries = await rows<{ amount_cents: number }>('SELECT amount_cents FROM payment_allocations WHERE case_id = $1', [id]);
    expect(entries.reduce((sum, entry) => sum + entry.amount_cents, 0)).toBe(0);
    expect(entries.filter((entry) => entry.amount_cents < 0)).toHaveLength(entries.length / 2);
    expect(await rows('SELECT count(*)::int AS n FROM case_invoices WHERE case_id = $1 AND principal_paid_cents = 0 AND state = $2', [id, 'UNPAID'])).toEqual([
      { n: 2 },
    ]);
    // Once only.
    expect(await set('officerA', id, payment!.id, 'BOUNCED')).toBe(409);
    await expect(rows('UPDATE payment_allocations SET amount_cents = 1 WHERE case_id = $1', [id])).rejects.toThrow(/append-only/u);
  });

  it('settles the case when nothing is left, and a bounce reopens it', async () => {
    const id = await makeCase(test.s.officerA, [10_000], 'INDIVIDUAL');
    await pay('officerA', id, cheque(10_000));
    expect(await rows('SELECT status, closed_on IS NOT NULL AS closed FROM cases WHERE id = $1', [id])).toEqual([{ status: 'SETTLED', closed: true }]);
    const [payment] = await paymentsOf(id);
    expect(await set('officerA', id, payment!.id, 'BOUNCED')).toBe(204);
    expect(await rows('SELECT status, closed_on FROM cases WHERE id = $1', [id])).toEqual([{ status: 'OVERDUE', closed_on: null }]);
  });

  it('a cashed cheque gets a receipt numbered without any gap', async () => {
    const id = await makeCase(test.s.officerA, [100_000]);
    await pay('officerA', id, cheque(1000));
    await pay('officerA', id, { method: 'TRANSFER', amount: 2000, receivedOn: today, label: 'VIR SEPA BATIPLUS', reconciled: false });
    const [first, second] = await paymentsOf(id);
    expect(await set('officerA', id, first!.id, 'RECONCILED')).toBe(409);
    expect(await set('officerA', id, first!.id, 'CASHED', 2)).toBe(409);
    expect(await set('officerA', id, first!.id, 'CASHED')).toBe(204);
    expect(await set('officerA', id, first!.id, 'CASHED')).toBe(409);
    expect(await set('officerA', id, second!.id, 'CASHED')).toBe(409);
    expect(await set('officerA', id, second!.id, 'RECONCILED')).toBe(204);
    const numbers = (await rows<{ number: string }>('SELECT number FROM receipts WHERE case_id = $1 ORDER BY number', [id])).map((row) => row.number);
    expect(numbers).toHaveLength(2);
    expect(numbers[0]).toMatch(/^Q-\d{4}-\d{5}$/u);
    expect(Number(numbers[1]!.slice(-5)) - Number(numbers[0]!.slice(-5))).toBe(1);
    expect((await detail('officerA', id)).payments.every((payment) => payment.receiptId)).toBe(true);
  });

  it('hides an IBAN typed in the label of a transfer, but from the Director', async () => {
    const id = await makeCase(test.s.director, [100_000]);
    await pay('director', id, {
      method: 'TRANSFER',
      amount: 1000,
      receivedOn: today,
      label: 'VIR FR76 3000 6000 0112 3456 7890 189 BATIPLUS',
      reconciled: true,
    });
    expect((await detail('director', id)).payments[0]?.label).toContain('FR76 3000 6000 0112 3456 7890 189');
    const shown = await rows<{ id: string }>("SELECT id FROM users WHERE role = 'COLLECTION_MANAGER'");
    expect(shown).toHaveLength(1);
    await rows('UPDATE cases SET officer_id = NULL WHERE id = $1', [id]);
    const label = (await detail('manager', id)).payments[0]?.label ?? '';
    expect(label).not.toMatch(/3456|7890/u);
    expect(label).toContain('•••• 0189');
  });

  it('is refused on a day still to come, and to whoever does not act on the case', async () => {
    const id = await makeCase(test.s.officerA, [100_000]);
    await pay('officerA', id, cheque(1000, addDays(today, 1)), 422);
    await pay('officerB', id, cheque(1000), 404);
    await pay('director', id, cheque(1000), 403);
    expect(await paymentsOf(id)).toEqual([]);
  });

  it('two payments typed at the same time are allocated one after the other', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    await Promise.all([pay('officerA', id, cheque(70_000)), pay('officerA', id, cheque(70_000))]);
    expect(await rows('SELECT principal_paid_cents FROM case_invoices WHERE case_id = $1', [id])).toEqual([{ principal_paid_cents: 100_000 }]);
    expect(await rows("SELECT sum(amount_cents)::int AS over FROM payment_allocations WHERE case_id = $1 AND component = 'OVERPAYMENT'", [id])).toEqual([
      { over: 40_000 },
    ]);
  });

  it('an allocation that does not add up is refused by PostgreSQL', async () => {
    const id = await makeCase(test.s.officerA, [100_000]);
    await expect(
      rows(
        `WITH p AS (INSERT INTO payments (case_id, creditor_id, method, amount_cents, status, received_on, cheque_number, bank, recorded_by)
           VALUES ($1, $2, 'CHEQUE', 1000, 'RECEIVED', $3, '7654321', 'Banque', $4) RETURNING id)
         INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) SELECT $1, $2, p.id, 'OVERPAYMENT', 999 FROM p`,
        [id, creditor, today, test.s.officerA],
      ),
    ).rejects.toThrow(/do not add up/u);
  });
});

describe('the money, written straight into PostgreSQL by a colleague', () => {
  it('is never written by hand: payments, allocations, receipts, plans, approvals, installments', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    await pay('officerA', id, cheque(1000));
    const [payment] = await paymentsOf(id);
    for (const statement of [
      (tx: Transaction) => tx.$executeRaw`UPDATE payments SET status = 'CASHED', settled_at = now() WHERE id = ${payment!.id}::uuid`,
      (tx: Transaction) =>
        tx.$executeRaw`INSERT INTO payment_allocations (case_id, creditor_id, payment_id, component, amount_cents) VALUES (${id}::uuid, ${creditor}::uuid, ${payment!.id}::uuid, 'OVERPAYMENT', 1)`,
      (tx: Transaction) =>
        tx.$executeRaw`INSERT INTO receipts (case_id, creditor_id, payment_id, number) VALUES (${id}::uuid, ${creditor}::uuid, ${payment!.id}::uuid, 'Q-2026-99999')`,
      (tx: Transaction) =>
        tx.$executeRaw`INSERT INTO payment_plans (case_id, creditor_id, total_cents, months, method, first_due_on, status, threshold_months, owned_by_director, requested_by)
          VALUES (${id}::uuid, ${creditor}::uuid, 1000, 36, 'TRANSFER', '2027-01-15', 'WAITING_DEBTOR', 60, true, ${test.s.officerA}::uuid)`,
    ]) {
      await expect(asOfficer(statement)).rejects.toThrow(/permission denied/u);
    }
    expect(await paymentsOf(id)).toEqual([{ id: payment!.id, status: 'RECEIVED' }]);
  });

  it('a long plan asked by the function always waits for its approvals, and is never changed by hand', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    const dates = Array.from({ length: 36 }, (_, index) => addDays(today, 30 * (index + 1)));
    const amounts = [...Array.from({ length: 35 }, () => 2800), 2000];
    const plan = await asOfficer(
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app.ask_plan(${id}::uuid, 'TRANSFER', 100000, ${amounts}::integer[], ${dates}::date[]) AS id`,
    );
    expect(await rows('SELECT status, owned_by_director, threshold_months FROM payment_plans WHERE id = $1', [plan[0]!.id])).toEqual([
      { status: 'PENDING_MANAGER', owned_by_director: false, threshold_months: 6 },
    ]);
    await expect(asOfficer((tx) => tx.$executeRaw`UPDATE payment_plans SET status = 'ACTIVE' WHERE case_id = ${id}::uuid`)).rejects.toThrow(
      /permission denied/u,
    );
    await expect(
      asOfficer(
        (tx) =>
          tx.$executeRaw`INSERT INTO installments (case_id, creditor_id, plan_id, number, due_on, amount_cents) VALUES (${id}::uuid, ${creditor}::uuid, ${plan[0]!.id}::uuid, 60, '2030-01-15', 1)`,
      ),
    ).rejects.toThrow(/permission denied/u);
    // Amounts that do not add up, or dates out of order.
    await expect(
      asOfficer((tx) => tx.$queryRaw`SELECT app.ask_plan(${id}::uuid, 'TRANSFER', 100000, ${[50_000, 40_000]}::integer[], ${dates.slice(0, 2)}::date[])`),
    ).rejects.toThrow();
  });

  it('refuses an allocation out of order: the principal of the oldest invoice first, then the indemnities', async () => {
    const id = await makeCase(test.s.officerA, [100_000, 50_000]);
    const [newer] = await rows<{ id: string }>("SELECT id FROM case_invoices WHERE case_id = $1 AND number = 'F-2'", [id]);
    const record = (parts: unknown[]) =>
      asOfficer(
        (tx) =>
          tx.$queryRaw`SELECT app.record_payment(${id}::uuid, 'TRANSFER', 1000, ${today}::date, NULL, NULL, NULL, 'VIR', false, ${JSON.stringify(parts)}::jsonb)`,
      );
    await expect(record([{ component: 'PRINCIPAL', invoice: newer!.id, amount: 1000 }])).rejects.toThrow();
    await expect(record([{ component: 'OVERPAYMENT', invoice: null, amount: 1000 }])).rejects.toThrow();
    await expect(record([{ component: 'FEES', invoice: newer!.id, amount: 1000 }])).rejects.toThrow();
    expect(await paymentsOf(id)).toEqual([]);
  });

  it('nothing in the future, nothing for someone else', async () => {
    const id = await makeCase(test.s.officerB, [100_000]);
    await expect(
      asOfficer((tx) => tx.$queryRaw`SELECT app.record_payment(${id}::uuid, 'TRANSFER', 1000, ${today}::date, NULL, NULL, NULL, 'VIR', false, '[]'::jsonb)`),
    ).rejects.toThrow();
    const mine = await makeCase(test.s.officerA, [100_000]);
    await expect(
      asOfficer(
        (tx) =>
          tx.$queryRaw`SELECT app.record_payment(${mine}::uuid, 'TRANSFER', 1000, ${addDays(today, 2)}::date, NULL, NULL, NULL, 'VIR', false, '[{"component":"INTEREST","invoice":null,"amount":1000}]'::jsonb)`,
      ),
    ).rejects.toThrow();
  });
});

describe('interest rates', () => {
  it('typed by the Director or the manager on their behalf, and used for the ECB rate', async () => {
    const put = (as: string, body: object) => call(as, 'PUT', '/interest-rates', { kind: 'ECB', validFrom: '2026-07-01', ...body });
    expect((await put('officerA', { rateBp: 215, expected: null })).status).toBe(403);
    expect((await put('manager', { rateBp: 200, expected: null })).status).toBe(204);
    // Changed since it was shown.
    expect((await put('director', { rateBp: 215, expected: null })).status).toBe(409);
    expect((await put('director', { rateBp: 215, expected: 200 })).status).toBe(204);
    expect((await put('director', { validFrom: '2026-08-01', rateBp: 215, expected: null })).status).toBe(422);
    const listed = interestRates.parse((await call('officerA', 'GET', '/interest-rates')).body);
    expect(listed.items).toContainEqual(expect.objectContaining({ kind: 'ECB', validFrom: '2026-07-01', rateBp: 215 }));
    expect(listed.canEdit).toBe(false);
    expect(await rows("SELECT action FROM audit_log WHERE action = 'ECB_RATE_SAVED'")).toHaveLength(2);
  });
});

describe('payment plans', () => {
  const plans = async (as: string) => plansData.parse((await call(as, 'GET', '/payment-plans')).body);

  it('a short plan goes to the debtor, in installments rounded to the euro', async () => {
    const id = await makeCase(test.s.officerA, [100_050], 'INDIVIDUAL');
    const shown = planSimulation.parse((await call('officerA', 'GET', `/payment-plans/simulation/${id}`)).body);
    expect(shown).toMatchObject({ balance: 100_050, ownedByDirector: false });
    expect((await call('officerA', 'POST', '/payment-plans', { caseId: id, months: 3, method: 'TRANSFER', expected: 99_000 })).status).toBe(409);
    expect((await call('officerA', 'POST', '/payment-plans', { caseId: id, months: 3, method: 'TRANSFER', expected: 100_050 })).status).toBe(204);
    expect((await call('officerA', 'POST', '/payment-plans', { caseId: id, months: 3, method: 'TRANSFER', expected: 100_050 })).status).toBe(409);
    const plan = (await plans('officerA')).plans.find((item) => item.caseId === id)!;
    expect(plan).toMatchObject({ state: 'WAITING_DEBTOR', total: 100_050, canAct: true });
    expect(plan.installments.map((row) => row.amount)).toEqual([33_400, 33_400, 33_250]);
    expect(plan.installments[0]?.date.slice(8)).toBe('15');
    expect(plan.installments[0]!.date > today).toBe(true);
    expect((await plans('officerB')).plans.some((item) => item.caseId === id)).toBe(false);
  });

  it('a long plan waits for the manager, who is the only one to decide, then for the creditor', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    expect((await call('officerA', 'POST', '/payment-plans', { caseId: id, months: 8, method: 'CHEQUE', expected: 100_000 })).status).toBe(204);
    expect((await plans('officerA')).requests).toEqual([]);
    const request = (await plans('manager')).requests.find((item) => item.debtor.startsWith('Débiteur'))!;
    expect(request).toMatchObject({ flag: 'Au-delà de 6 mois', version: 1 });
    expect((await call('officerA', 'PUT', `/payment-plans/requests/${request.id}`, { decision: 'APPROVED', version: 1 })).status).toBe(403);
    expect((await call('manager', 'PUT', `/payment-plans/requests/${request.id}`, { decision: 'APPROVED', version: 2 })).status).toBe(409);
    expect((await call('manager', 'PUT', `/payment-plans/requests/${request.id}`, { decision: 'APPROVED', version: 1 })).status).toBe(204);
    expect((await call('manager', 'PUT', `/payment-plans/requests/${request.id}`, { decision: 'REFUSED', version: 2 })).status).toBe(409);
    expect((await plans('officerA')).plans.find((item) => item.caseId === id)?.state).toBe('WAITING_CREDITOR');
    expect(await rows("SELECT kind, plan_id FROM notifications WHERE user_id = $1 AND kind = 'PLAN_DECIDED'", [test.s.officerA])).toEqual([
      { kind: 'PLAN_DECIDED', plan_id: request.id },
    ]);
    expect(await rows("SELECT params FROM audit_log WHERE action = 'PLAN_APPROVED'")).toEqual([{ params: { months: 8 } }]);
    const told = (await call('officerA', 'GET', '/notifications')).body as { text: string; href: string }[] | { items: { text: string }[] };
    expect(JSON.stringify(told)).toContain('a validé l’échéancier de Débiteur');
  });

  it('a long plan on a case of the Director goes to the creditor at once', async () => {
    const id = await makeCase(test.s.director, [100_000], 'INDIVIDUAL');
    expect((await call('director', 'POST', '/payment-plans', { caseId: id, months: 12, method: 'TRANSFER', expected: 100_000 })).status).toBe(204);
    expect(await rows('SELECT status, owned_by_director FROM payment_plans WHERE case_id = $1', [id])).toEqual([
      { status: 'WAITING_CREDITOR', owned_by_director: true },
    ]);
    expect(await rows('SELECT step FROM plan_approvals p JOIN payment_plans x ON x.id = p.plan_id WHERE x.case_id = $1 ORDER BY step', [id])).toEqual([
      { step: 'CREDITOR' },
      { step: 'DEBTOR' },
    ]);
  });

  it('nobody else simulates nor asks on a case they do not act on', async () => {
    const id = await makeCase(test.s.officerA, [100_000], 'INDIVIDUAL');
    expect((await call('officerB', 'GET', `/payment-plans/simulation/${id}`)).status).toBe(404);
    expect((await call('director', 'GET', `/payment-plans/simulation/${id}`)).status).toBe(403);
    expect((await call('officerB', 'POST', '/payment-plans', { caseId: id, months: 3, method: 'TRANSFER', expected: 100_000 })).status).toBe(404);
  });
});

describe('installments', () => {
  const rowsOf = (count: number) => Array.from({ length: count }, (_, index) => ({ number: index + 1, dueOn: `2026-0${index + 1}-15`, amount: 1000 }));
  it('are filled in order by what was paid; two missed make a default', () => {
    expect(installmentStates(rowsOf(4), 1500, '2026-03-20')).toMatchObject({
      installments: [{ state: 'PAID' }, { state: 'MISSED' }, { state: 'MISSED' }, { state: 'UPCOMING' }],
      missed: 2,
      left: 2500,
    });
    expect(installmentStates(rowsOf(2), 0, '2026-01-15').installments.map((row) => row.state)).toEqual(['UPCOMING', 'UPCOMING']);
  });
});
