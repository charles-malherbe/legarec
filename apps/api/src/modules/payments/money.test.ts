import { allocatePayment } from '@legarec/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accruedInterest, addDays, allocate, indemnities, type InvoiceDue, type Rate, type Terms } from './money';

const RATES: Rate[] = [
  { kind: 'ECB', validFrom: '2026-01-01', rateBp: 215 },
  { kind: 'ECB', validFrom: '2026-07-01', rateBp: 215 },
  { kind: 'LEGAL_INDIVIDUAL', validFrom: '2026-01-01', rateBp: 662 },
  { kind: 'LEGAL_INDIVIDUAL', validFrom: '2026-07-01', rateBp: 662 },
];
const PRO: Terms = { individual: false, mode: { kind: 'ECB_PLUS_TEN' }, formalNoticeOn: null, fixedIndemnity: true };
const PERSON: Terms = { individual: true, mode: { kind: 'ECB_PLUS_TEN' }, formalNoticeOn: null, fixedIndemnity: true };
const invoice = (principal: number, dueOn = '2026-01-31', id = 'a'): InvoiceDue => ({ id, number: id, dueOn, principal });

describe('interest', () => {
  it('runs from the day after the due date, simple, over 365 days', () => {
    // 10 000 € at 12,15 % for 365 days (1 February 2026 to 31 January 2027 has no rate for 2027: stop at 31 December).
    const { total, missing } = accruedInterest([invoice(1_000_000)], [], RATES, PRO, '2026-12-31');
    // 334 days at 12,15 %.
    expect(total).toBe(Math.round((1_000_000 * 1215 * 334) / 3_650_000));
    expect(missing).toEqual([]);
  });

  it('nothing on the due date itself', () => {
    expect(accruedInterest([invoice(1_000_000)], [], RATES, PRO, '2026-01-31').total).toBe(0);
    expect(accruedInterest([invoice(1_000_000)], [], RATES, PRO, '2026-02-01').total).toBe(Math.round((1_000_000 * 1215) / 3_650_000));
  });

  it('follows the rate of the contract', () => {
    const terms: Terms = { ...PRO, mode: { kind: 'CONTRACT', rateBp: 1000 } };
    expect(accruedInterest([invoice(365_000)], [], [], terms, '2026-02-10').total).toBe(1000);
  });

  it('none when the mandate says so', () => {
    expect(accruedInterest([invoice(365_000)], [], RATES, { ...PRO, mode: { kind: 'NONE' } }, '2026-12-31').total).toBe(0);
  });

  it('says which semesters lack a rate, and counts nothing for them', () => {
    const { total, missing } = accruedInterest([invoice(1_000_000, '2025-12-31')], [], RATES.slice(1), PRO, '2026-07-10');
    expect(missing).toEqual(['2026-01-01']);
    expect(total).toBe(Math.round((1_000_000 * 1215 * 10) / 3_650_000));
  });

  it('never for an individual before the formal notice, then at the legal rate', () => {
    expect(accruedInterest([invoice(1_000_000)], [], RATES, PERSON, '2026-12-31').total).toBe(0);
    const after = accruedInterest([invoice(1_000_000)], [], RATES, { ...PERSON, formalNoticeOn: '2026-06-01' }, '2026-06-30');
    expect(after.total).toBe(Math.round((1_000_000 * 662 * 30) / 3_650_000));
  });

  it('stops on what is paid, from the day after the payment', () => {
    const paid = [{ invoiceId: 'a', on: '2026-02-10', amount: 1_000_000 }];
    const until = accruedInterest([invoice(1_000_000)], [], RATES, PRO, '2026-02-10').total;
    expect(accruedInterest([invoice(1_000_000)], paid, RATES, PRO, '2026-12-31').total).toBe(until);
  });

  it('a partial payment halves what follows', () => {
    const paid = [{ invoiceId: 'a', on: '2026-02-28', amount: 500_000 }];
    const { total } = accruedInterest([invoice(1_000_000)], paid, [], { ...PRO, mode: { kind: 'CONTRACT', rateBp: 1000 } }, '2026-03-30');
    expect(total).toBe(Math.round((1_000_000 * 1000 * 28 + 500_000 * 1000 * 30) / 3_650_000));
  });

  it('never decreases with time, whatever the payments', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 400 }), fc.integer({ min: 1, max: 1_000_000 })), { maxLength: 5 }),
        fc.integer({ min: 0, max: 600 }),
        fc.integer({ min: 1, max: 100 }),
        (principal, payments, days, more) => {
          const paid = payments.map(([day, amount]) => ({ invoiceId: 'a', on: addDays('2026-02-01', day), amount }));
          const asOf = addDays('2026-01-31', days);
          const one = accruedInterest([invoice(principal)], paid, RATES, PRO, asOf).total;
          const two = accruedInterest([invoice(principal)], paid, RATES, PRO, addDays(asOf, more)).total;
          return one >= 0 && two >= one;
        },
      ),
    );
  });
});

describe('indemnities', () => {
  it('40 € per invoice past due between professionals, never from an individual', () => {
    const invoices = [invoice(100, '2026-01-31', 'a'), invoice(100, '2026-03-31', 'b')];
    expect([...indemnities(invoices, PRO, '2026-02-15').values()]).toEqual([4000, 0]);
    expect([...indemnities(invoices, PERSON, '2026-12-31').values()]).toEqual([0, 0]);
    expect([...indemnities(invoices, { ...PRO, fixedIndemnity: false }, '2026-12-31').values()]).toEqual([0, 0]);
  });
});

describe('allocation', () => {
  it('interest first, then the oldest principal, then the fees, then an overpayment', () => {
    const owed = {
      interest: 500,
      invoices: [
        { id: 'a', principal: 1000, fees: 4000 },
        { id: 'b', principal: 2000, fees: 4000 },
      ],
    };
    expect(allocate(2000, owed)).toEqual([
      { component: 'INTEREST', invoiceId: null, amount: 500 },
      { component: 'PRINCIPAL', invoiceId: 'a', amount: 1000 },
      { component: 'PRINCIPAL', invoiceId: 'b', amount: 500 },
    ]);
    expect(allocate(20_000, owed).at(-1)).toEqual({ component: 'OVERPAYMENT', invoiceId: null, amount: 8500 });
  });

  it('every cent goes somewhere, in the same totals as the portals show', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2_000_000_000 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 100_000_000 }), fc.constantFrom(0, 4000)), { minLength: 1, maxLength: 8 }),
        (amount, interest, rows) => {
          const invoices = rows.map(([principal, fees], index) => ({ id: String(index), principal, fees }));
          const parts = allocate(amount, { interest, invoices });
          const sum = (component: string) => parts.filter((part) => part.component === component).reduce((total, part) => total + part.amount, 0);
          const portal = allocatePayment(amount, {
            interest,
            principal: invoices.reduce((total, row) => total + row.principal, 0),
            fees: invoices.reduce((total, row) => total + row.fees, 0),
          });
          return (
            parts.every((part) => part.amount > 0) &&
            parts.reduce((total, part) => total + part.amount, 0) === amount &&
            sum('INTEREST') === portal.interest &&
            sum('PRINCIPAL') === portal.principal &&
            sum('FEES') === portal.fees &&
            sum('OVERPAYMENT') === portal.remainder
          );
        },
      ),
    );
  });
});
