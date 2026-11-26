import { formatCents, type reportsData } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Database } from '../../platform/database/database';
import { forbidden } from '../../platform/errors/api-error';
import { capitalized, dayOf } from '../../platform/format';

type Data = z.infer<typeof reportsData>;
type Report = Data['periods']['month'];
type Kpi = Report['kpis'][number];
interface Daily {
  day: string;
  amount: number;
  count: number;
}
interface Read {
  role: 'DIRECTOR' | 'COLLECTION_MANAGER' | 'CLAIMS_OFFICER' | 'DEVELOPER' | null;
  payments: Daily[];
  entrusted: Daily[];
  /** Settled cases by the day they closed: `amount` is the sum of the days they stayed open. */
  settled: Daily[];
  lost: { count: number; left: number };
  totals: { entrusted: number; recovered: number; invoices: number; invoicesSettled: number };
  outcomes: { settled: number; partial: number; lost: number };
  team: { id: string; name: string; cases: number; entrusted: number; recovered: number }[];
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const SCOPES = { DIRECTOR: 'GLOBAL', COLLECTION_MANAGER: 'TEAM', CLAIMS_OFFICER: 'PERSONAL' } as const;
const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });
const plural = (count: number, one: string, many: string) => `${count.toLocaleString('fr-FR')} ${count > 1 ? many : one}`;
const two = (value: number) => String(value).padStart(2, '0');
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
/** Last day of a month, 1 to 12. */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const kpi = (label: string, value: string, delta: string, tone: Kpi['tone'] = 'neutral'): Kpi => ({ label, value, delta, tone });

/**
 * The screen « Rapports ». PostgreSQL decides which cases each one reads (policies of `cases`, `case_invoices` and
 * `payments`): every figure is an aggregate of those rows, nothing here filters by role, and a creditor the person reads no
 * case of answers as one that has none. What the base does not hold is not shown: calls and promises come with the
 * telephony (lot T), scheduled reports with the sendings (lots Q and R).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async read(creditor: string): Promise<Data> {
    const today = dayOf(new Date());
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const only = creditor === 'all' ? null : creditor;
    const from = `${year}-01-01`;
    const [{ data }] = (await this.database.tx.$queryRaw<{ data: Read }[]>`
      WITH seen AS (
        SELECT c.id, c.officer_id, c.status, c.opened_on, c.closed_on FROM cases c WHERE ${only}::uuid IS NULL OR c.creditor_id = ${only}::uuid
      ), inv AS (
        SELECT i.case_id, sum(i.principal_cents) AS entrusted, sum(i.principal_cents - i.principal_paid_cents) AS left_cents, count(*) AS invoices,
          count(*) FILTER (WHERE i.principal_paid_cents >= i.principal_cents) AS settled
        FROM case_invoices i WHERE i.case_id IN (SELECT s.id FROM seen s) GROUP BY i.case_id
      ), pay AS (
        SELECT p.case_id, sum(p.amount_cents) AS recovered FROM payments p
        WHERE p.status <> 'BOUNCED' AND p.case_id IN (SELECT s.id FROM seen s) GROUP BY p.case_id
      )
      SELECT jsonb_build_object(
        'role', app.staff_role(),
        'payments', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'amount', d.amount, 'count', d.count)), '[]') FROM (
          SELECT p.received_on AS day, sum(p.amount_cents) AS amount, count(*) AS count FROM payments p
          WHERE p.status <> 'BOUNCED' AND p.received_on >= ${from}::date AND p.received_on <= ${today}::date AND p.case_id IN (SELECT s.id FROM seen s)
          GROUP BY p.received_on) d),
        'entrusted', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'amount', d.amount, 'count', d.count)), '[]') FROM (
          SELECT (i.created_at AT TIME ZONE 'Europe/Paris')::date AS day, sum(i.principal_cents) AS amount, count(*) AS count FROM case_invoices i
          WHERE (i.created_at AT TIME ZONE 'Europe/Paris')::date >= ${from}::date AND (i.created_at AT TIME ZONE 'Europe/Paris')::date <= ${today}::date
            AND i.case_id IN (SELECT s.id FROM seen s)
          GROUP BY 1) d),
        'settled', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'amount', d.amount, 'count', d.count)), '[]') FROM (
          SELECT s.closed_on AS day, sum(s.closed_on - s.opened_on) AS amount, count(*) AS count FROM seen s
          WHERE s.status = 'SETTLED' AND s.closed_on >= ${from}::date AND s.closed_on <= ${today}::date GROUP BY s.closed_on) d),
        'lost', (SELECT jsonb_build_object('count', count(*), 'left', coalesce(sum(inv.left_cents), 0)) FROM seen s LEFT JOIN inv ON inv.case_id = s.id
          WHERE s.status = 'LOST' AND s.closed_on >= ${from}::date AND s.closed_on <= ${today}::date),
        'totals', jsonb_build_object(
          'entrusted', (SELECT coalesce(sum(inv.entrusted), 0) FROM inv),
          'recovered', (SELECT coalesce(sum(pay.recovered), 0) FROM pay),
          'invoices', (SELECT coalesce(sum(inv.invoices), 0) FROM inv),
          'invoicesSettled', (SELECT coalesce(sum(inv.settled), 0) FROM inv)),
        'outcomes', (SELECT jsonb_build_object(
            'settled', count(*) FILTER (WHERE s.status = 'SETTLED'),
            'partial', count(*) FILTER (WHERE s.status = 'LOST' AND coalesce(pay.recovered, 0) > 0),
            'lost', count(*) FILTER (WHERE s.status = 'LOST' AND coalesce(pay.recovered, 0) = 0))
          FROM seen s LEFT JOIN pay ON pay.case_id = s.id WHERE s.closed_on IS NOT NULL),
        -- Whoever holds a case the person reads, and the active members who may hold some; an officer: themselves alone;
        -- anyone else (the Developer, refused below): nobody.
        'team', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.first_name || ' ' || u.last_name, 'cases', coalesce(t.open, 0),
            'entrusted', coalesce(t.entrusted, 0), 'recovered', coalesce(t.recovered, 0)) ORDER BY u.last_name, u.first_name, u.id), '[]')
          FROM users u LEFT JOIN (
            SELECT s.officer_id, count(*) FILTER (WHERE s.closed_on IS NULL) AS open, coalesce(sum(inv.entrusted), 0) AS entrusted,
              coalesce(sum(pay.recovered), 0) AS recovered
            FROM seen s LEFT JOIN inv ON inv.case_id = s.id LEFT JOIN pay ON pay.case_id = s.id WHERE s.officer_id IS NOT NULL GROUP BY s.officer_id
          ) t ON t.officer_id = u.id
          WHERE CASE WHEN app.staff_role() = 'CLAIMS_OFFICER' THEN u.id = app.user_id()
            WHEN app.staff_role() IN ('DIRECTOR', 'COLLECTION_MANAGER')
              THEN t.officer_id IS NOT NULL OR (u.status = 'ACTIVE' AND u.role IN ('CLAIMS_OFFICER', 'COLLECTION_MANAGER'))
            ELSE false END)
      ) AS data`) as [{ data: Read }];
    // The role as PostgreSQL knows it: the one that decided what was read.
    const scope = data.role && data.role !== 'DEVELOPER' ? SCOPES[data.role] : null;
    if (!scope) throw forbidden();

    const between = (rows: Daily[], start: string, end: string) =>
      rows
        .filter((row) => row.day >= start && row.day <= end)
        .reduce((sum, row) => ({ amount: sum.amount + row.amount, count: sum.count + row.count }), { amount: 0, count: 0 });
    const upTo = `au ${today.slice(8, 10)}/${today.slice(5, 7)}`;
    const closed = data.outcomes.settled + data.outcomes.partial + data.outcomes.lost;
    const { totals } = data;
    const report = (text: string, start: string, bars: [label: string, start: string, end: string][], more: Kpi[] = []): Report => {
      const recovered = between(data.payments, start, today);
      const entrusted = between(data.entrusted, start, today);
      const settled = between(data.settled, start, today);
      return {
        text: `${text} (${upTo})`,
        kpis: [
          kpi('Recouvré', formatCents(recovered.amount), plural(recovered.count, 'paiement', 'paiements')),
          kpi('Nouvelles créances confiées', formatCents(entrusted.amount), plural(entrusted.count, 'facture', 'factures')),
          // Of all that was entrusted, whatever the period: the rate of the dashboard.
          kpi(
            'Taux de recouvrement',
            totals.entrusted ? `${percent(totals.recovered, totals.entrusted)} %` : '—',
            `${plural(totals.invoicesSettled, 'facture soldée', 'factures soldées')} sur ${totals.invoices.toLocaleString('fr-FR')}`,
          ),
          kpi(
            'DSO moyen',
            settled.count ? `${Math.round(settled.amount / settled.count)} j` : '—',
            settled.count ? `sur ${plural(settled.count, 'dossier réglé', 'dossiers réglés')}` : 'aucun dossier réglé',
          ),
          ...more,
        ],
        bars: bars.map(([label, first, last]) => ({
          label,
          entrusted: between(data.entrusted, first, last).amount,
          recovered: between(data.payments, first, last).amount,
        })),
      };
    };
    const monthBar = (index: number, label: string): [string, string, string] => [
      label,
      `${year}-${two(index)}-01`,
      `${year}-${two(index)}-${two(lastDay(year, index))}`,
    ];
    const prefix = `${year}-${two(month)}`;
    const quarter = Math.floor((month - 1) / 3);
    const quarterMonths = [1, 2, 3].map((offset) => quarter * 3 + offset);
    const long = (index: number) => capitalized(monthName.format(new Date(Date.UTC(year, index - 1, 1))));

    return {
      scope,
      periods: {
        month: report(`${long(month)} ${year}`, `${prefix}-01`, [
          ['1–7', `${prefix}-01`, `${prefix}-07`],
          ['8–14', `${prefix}-08`, `${prefix}-14`],
          ['15–21', `${prefix}-15`, `${prefix}-21`],
          [`22–${lastDay(year, month)}`, `${prefix}-22`, `${prefix}-${two(lastDay(year, month))}`],
        ]),
        quarter: report(
          `${quarter === 0 ? '1er' : `${quarter + 1}e`} trimestre ${year}`,
          `${year}-${two(quarterMonths[0]!)}-01`,
          quarterMonths.map((index) => monthBar(index, long(index))),
        ),
        year: report(
          `Année ${year}`,
          from,
          MONTHS.map((label, index) => monthBar(index + 1, label)),
          [kpi('Irrécouvrable', formatCents(data.lost.left), plural(data.lost.count, 'dossier', 'dossiers'), data.lost.count ? 'bad' : 'neutral')],
        ),
      },
      // Of the closed cases the person reads. A case closes settled or lost: no other issue is recorded.
      outcomes: [
        { label: 'Recouvré intégralement', percent: percent(data.outcomes.settled, closed), tone: 'success' },
        { label: 'Recouvré partiellement', percent: percent(data.outcomes.partial, closed), tone: 'teal' },
        { label: 'Irrécouvrable', percent: percent(data.outcomes.lost, closed), tone: 'danger' },
      ],
      // Nothing records a promise nor what became of it: with the telephony (lot T).
      promisesKept: null,
      team: data.team.map((row) => ({
        id: row.id,
        name: row.name,
        cases: row.cases,
        calls: null,
        promises: null,
        recovered: row.recovered,
        rate: percent(row.recovered, row.entrusted),
      })),
      // No report is sent yet (lots Q and R): none is listed, so none looks switched on.
      scheduled: [],
    };
  }

  /** The Director and the manager, as PostgreSQL knows them; no scheduled report exists yet, so none is found. */
  async mayToggle(): Promise<boolean> {
    const [{ role }] = (await this.database.tx.$queryRaw<{ role: string | null }[]>`SELECT app.staff_role()::text AS role`) as [{ role: string | null }];
    return role === 'DIRECTOR' || role === 'COLLECTION_MANAGER';
  }
}
