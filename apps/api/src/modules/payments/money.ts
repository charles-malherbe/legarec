/**
 * Interest, indemnities and allocation of a payment (question 75, decisions of 25/11/2026). Pure functions, without any
 * database: what the payments module stores and shows comes from here only.
 *
 * - Professionals: rate of the mandate, otherwise the ECB rate of the semester plus 10 points, from the day after the due date.
 * - Individuals: legal rate of the semester, from the formal notice only (question 98); never the 40 € indemnity.
 * - Simple interest over 365 days, per invoice, on what is left of its principal each day; a payment received on a day
 *   still bears interest that day.
 * - A payment goes to the interest of the whole case, then to the principal from the oldest invoice to the most recent,
 *   then to the indemnities in the same order; the rest is an overpayment.
 */

export type Day = string; // YYYY-MM-DD
export type InterestMode = { kind: 'ECB_PLUS_TEN' } | { kind: 'CONTRACT'; rateBp: number } | { kind: 'NONE' };
export interface Rate {
  kind: 'ECB' | 'LEGAL_INDIVIDUAL';
  validFrom: Day;
  rateBp: number;
}
export interface InvoiceDue {
  id: string;
  number: string;
  dueOn: Day;
  principal: number;
}
/** What was allocated so far, cancelled entries included (a bounced cheque counts for nothing, from its first day). */
export interface PrincipalPaid {
  invoiceId: string;
  /** Day the money was received. */
  on: Day;
  amount: number;
}
export interface Terms {
  individual: boolean;
  mode: InterestMode;
  /** Individuals: delivery of the formal notice, failing that its sending. Null: no interest yet. */
  formalNoticeOn: Day | null;
  /** The 40 € of article L441-10, when the mandate claims it. */
  fixedIndemnity: boolean;
}

export const INDEMNITY_CENTS = 4000;
const TEN_POINTS = 1000;
const DAY_MS = 86_400_000;

const toTime = (day: Day) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time: number): Day => new Date(time).toISOString().slice(0, 10);
export const addDays = (day: Day, days: number): Day => toDay(toTime(day) + days * DAY_MS);
const semesterOf = (day: Day): Day => `${day.slice(0, 4)}-${Number(day.slice(5, 7)) <= 6 ? '01' : '07'}-01`;
const nextSemester = (semester: Day): Day => (semester.slice(5, 7) === '01' ? `${semester.slice(0, 4)}-07-01` : `${Number(semester.slice(0, 4)) + 1}-01-01`);

/** The rate of each semester, or null when it was not typed: those days bear nothing, and are said so. */
function rateOf(terms: Terms, rates: Rate[], semester: Day): number | null {
  if (terms.individual) return rates.find((rate) => rate.kind === 'LEGAL_INDIVIDUAL' && rate.validFrom === semester)?.rateBp ?? null;
  if (terms.mode.kind === 'NONE') return 0;
  if (terms.mode.kind === 'CONTRACT') return terms.mode.rateBp;
  const ecb = rates.find((rate) => rate.kind === 'ECB' && rate.validFrom === semester);
  return ecb ? ecb.rateBp + TEN_POINTS : null;
}

export interface Accrued {
  /** Interest of the case, in cents, rounded once per invoice. */
  total: number;
  /** Per invoice, same rounding. */
  byInvoice: Map<string, number>;
  /** Semesters without any rate typed, during which interest ran. */
  missing: Day[];
}

/** Interest accrued up to `asOf` included. */
export function accruedInterest(invoices: InvoiceDue[], paid: PrincipalPaid[], rates: Rate[], terms: Terms, asOf: Day): Accrued {
  const byInvoice = new Map<string, number>();
  const missing = new Set<Day>();
  let total = 0;
  for (const invoice of invoices) {
    let start = addDays(invoice.dueOn, 1);
    if (terms.individual) {
      if (!terms.formalNoticeOn) {
        byInvoice.set(invoice.id, 0);
        continue;
      }
      if (terms.formalNoticeOn > start) start = terms.formalNoticeOn;
    }
    // Days on which the principal left changes: the day after each payment.
    const changes = paid
      .filter((entry) => entry.invoiceId === invoice.id)
      .map((entry) => ({ from: addDays(entry.on, 1), amount: entry.amount }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    let weighted = 0n; // cents × basis points × days
    let day = start;
    while (day <= asOf) {
      const left = invoice.principal - changes.filter((change) => change.from <= day).reduce((sum, change) => sum + change.amount, 0);
      if (left <= 0 && changes.every((change) => change.from <= day)) break;
      const semester = semesterOf(day);
      const nextChange = changes.find((change) => change.from > day)?.from;
      const ends = [nextSemester(semester), addDays(asOf, 1), ...(nextChange ? [nextChange] : [])].sort()[0]!;
      const days = Math.round((toTime(ends) - toTime(day)) / DAY_MS);
      const rate = rateOf(terms, rates, semester);
      if (rate === null) {
        if (left > 0) missing.add(semester);
      } else if (left > 0) {
        weighted += BigInt(left) * BigInt(rate) * BigInt(days);
      }
      day = ends;
    }
    const cents = Number((weighted * 2n + 10_000n * 365n) / (2n * 10_000n * 365n));
    byInvoice.set(invoice.id, cents);
    total += cents;
  }
  return { total, byInvoice, missing: [...missing].sort() };
}

/** Indemnity due for each invoice on a given day: past due, between professionals, if the mandate claims it. */
export function indemnities(invoices: InvoiceDue[], terms: Terms, on: Day): Map<string, number> {
  return new Map(invoices.map((invoice) => [invoice.id, !terms.individual && terms.fixedIndemnity && invoice.dueOn < on ? INDEMNITY_CENTS : 0]));
}

export interface Owed {
  interest: number;
  /** Oldest first. */
  invoices: { id: string; principal: number; fees: number }[];
}
export interface Allocation {
  component: 'INTEREST' | 'PRINCIPAL' | 'FEES' | 'OVERPAYMENT';
  invoiceId: string | null;
  amount: number;
}

/** Splits a payment over what is owed, in the order of the rules; every cent goes somewhere. */
export function allocate(amount: number, owed: Owed): Allocation[] {
  const out: Allocation[] = [];
  let left = amount;
  const take = (component: Allocation['component'], invoiceId: string | null, due: number) => {
    const part = Math.min(left, Math.max(due, 0));
    if (part > 0) {
      out.push({ component, invoiceId, amount: part });
      left -= part;
    }
  };
  take('INTEREST', null, owed.interest);
  for (const invoice of owed.invoices) take('PRINCIPAL', invoice.id, invoice.principal);
  for (const invoice of owed.invoices) take('FEES', invoice.id, invoice.fees);
  if (left > 0) out.push({ component: 'OVERPAYMENT', invoiceId: null, amount: left });
  return out;
}

/** Oldest due date first, then the number. */
export const byAge = <T extends { dueOn: Day; number: string }>(a: T, b: T) =>
  a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.number.localeCompare(b.number, 'fr');
