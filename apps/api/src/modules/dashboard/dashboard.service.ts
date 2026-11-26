import { formatCents, type CaseStatus, type Dashboard } from '@legarec/contracts';
import type { StaffActor } from '../account/account.service';

type StaffRole = StaffActor['role'];
import { Inject, Injectable } from '@nestjs/common';
import { Database } from '../../platform/database/database';
import { notFound } from '../../platform/errors/api-error';
import { dayOf, timeOf } from '../../platform/format';
import { STATUS_LABELS } from '../cases/labels';
import { lateDays } from '../creditors/late';
import { SettingValues } from '../settings/values';

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
const AGES: [string, number, number][] = [
  ['0 – 30 j', 0, 30],
  ['31 – 60 j', 31, 60],
  ['61 – 90 j', 61, 90],
  ['Plus de 90 j', 91, Number.POSITIVE_INFINITY],
];
const CLOSED: CaseStatus[] = ['SETTLED', 'LOST'];
const plural = (count: number, word: string) => `${count.toLocaleString('fr-FR')} ${word}${count > 1 ? 's' : ''}`;
const euros = (cents: string) => Math.round(Number(cents.replace(/\s/gu, '').replace(',', '.')) * 100) || 0;

type Priority = Dashboard['priorities'][number];
/** What waits for someone, from the state of the cases: nothing is typed by hand. */
const TASKS: Partial<Record<CaseStatus, Omit<Priority, 'id' | 'title' | 'meta' | 'href' | 'done' | 'tone'> & { kind: string }>> = {
  NEW: { kind: 'first-letter', tag: 'Premier courrier', icon: 'mail', cta: 'Ouvrir' },
  PROMISE: { kind: 'promise', tag: 'Promesse', icon: 'euro', cta: 'Vérifier' },
  DISPUTE: { kind: 'dispute', tag: 'Litige', icon: 'alert', cta: 'Traiter' },
  OVERDUE: { kind: 'call', tag: 'À appeler', icon: 'phone', cta: 'Appeler' },
  FORMAL_NOTICE: { kind: 'formal-notice', tag: 'Mise en demeure', icon: 'scale', cta: 'Suivre' },
};
const FEED: Record<string, Dashboard['feed'][number]['kind']> = { PAYMENT: 'PAYMENT', CALL: 'CALL', MESSAGE: 'MESSAGE', PLAN: 'APPROVAL' };

/** The dashboard of the team. PostgreSQL decides which cases each one reads: nothing here filters by role. */
@Injectable()
export class DashboardService {
  constructor(@Inject(Database) private readonly database: Database) {}

  async read(role: StaffRole, userId: string, creditor: string): Promise<Dashboard> {
    const { tx } = this.database;
    const today = dayOf(new Date());
    const cases = await tx.case.findMany({
      where: creditor === 'all' ? {} : { creditorId: creditor },
      select: {
        id: true,
        reference: true,
        status: true,
        openedOn: true,
        closedOn: true,
        officerId: true,
        debtorSiret: true,
        depositedName: true,
        creditor: { select: { id: true, name: true, siren: true, sector: true } },
        debtor: { select: { id: true, name: true } },
        invoices: { select: { principalCents: true, principalPaidCents: true, dueOn: true } },
        payments: { select: { amountCents: true, status: true, receivedOn: true } },
      },
    });
    const left = (row: (typeof cases)[number]) => row.invoices.reduce((sum, invoice) => sum + invoice.principalCents - invoice.principalPaidCents, 0);
    const oldest = (row: (typeof cases)[number]) =>
      row.invoices
        .filter((invoice) => invoice.principalPaidCents < invoice.principalCents)
        .reduce<Date | null>((min, invoice) => (!min || invoice.dueOn < min ? invoice.dueOn : min), null);
    const open = cases.filter((row) => !CLOSED.includes(row.status) && left(row) > 0);
    const payments = cases.flatMap((row) =>
      row.payments.filter((payment) => payment.status !== 'BOUNCED').map((payment) => ({ ...payment, day: dayOf(payment.receivedOn) })),
    );
    const recoveredSince = (day: string) => payments.filter((payment) => payment.day >= day).reduce((sum, payment) => sum + payment.amountCents, 0);
    const settings = await SettingValues.read(tx);
    const monthlyTarget = euros(settings.text('firm', 'regles', 'monthly-goal'));
    const callTarget = Number.parseInt(settings.text('firm', 'regles', 'call-goal'), 10) || 0;

    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const starts = { week: dayOf(monday), month: `${today.slice(0, 7)}-01`, year: `${today.slice(0, 4)}-01-01` };
    const ratio = (amount: number, target: number) => (target ? Math.min(100, Math.round((amount / target) * 100)) : null);
    const period = (name: keyof typeof starts, note: string, target: number) => {
      const recovered = recoveredSince(starts[name]);
      const count = payments.filter((payment) => payment.day >= starts[name]).length;
      return { note, recovered, recoveredSub: plural(count, 'paiement'), targetRatio: ratio(recovered, target) };
    };

    const allInvoices = cases.flatMap((row) => row.invoices);
    const ages = open.map((row) => ({ row, days: lateDays(oldest(row), today) ?? 0, amount: left(row) }));
    const outstanding = ages.reduce((sum, item) => sum + item.amount, 0);
    const settled = cases.filter((row) => row.status === 'SETTLED' && row.closedOn);
    const dso = settled.length
      ? Math.round(settled.reduce((sum, row) => sum + (row.closedOn!.getTime() - row.openedOn.getTime()) / 86_400_000, 0) / settled.length)
      : 0;

    const name = (row: (typeof cases)[number]) => row.depositedName ?? row.debtor.name;
    const marks = new Set((await tx.taskMark.findMany({ where: { userId }, select: { key: true } })).map((mark) => mark.key));
    const priorities = open
      .filter((row) => TASKS[row.status] && (role !== 'DIRECTOR' || row.officerId === userId) && (role !== 'CLAIMS_OFFICER' || row.officerId === userId))
      .sort((a, b) => (lateDays(oldest(b), today) ?? 0) - (lateDays(oldest(a), today) ?? 0))
      .slice(0, 8)
      .map((row) => {
        const { kind, ...task } = TASKS[row.status]!;
        const id = `${kind}:${row.id}`;
        const days = lateDays(oldest(row), today);
        return {
          ...task,
          id,
          title: name(row),
          meta: `${row.reference} · ${formatCents(left(row))}${days ? ` · ${plural(days, 'jour')} de retard` : ''}`,
          tone: row.status,
          href: `/dossiers/${row.id}`,
          done: marks.has(id),
        };
      });

    const events = await tx.caseEvent.findMany({
      where: creditor === 'all' ? {} : { creditorId: creditor },
      orderBy: { occurredAt: 'desc' },
      take: 8,
      select: { id: true, kind: true, title: true, actorLabel: true, occurredAt: true, case: { select: { reference: true } } },
    });
    const now = new Date(`${today}T12:00:00Z`);
    const months = Array.from({ length: 6 }, (_, index) => {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
      const key = at.toISOString().slice(0, 7);
      return {
        label: MONTHS[at.getUTCMonth()]!,
        amount: payments.filter((payment) => payment.day.startsWith(key)).reduce((sum, payment) => sum + payment.amountCents, 0),
      };
    });

    const byCreditor = new Map<string, (typeof cases)[number][]>();
    for (const row of cases) byCreditor.set(row.creditor.id, [...(byCreditor.get(row.creditor.id) ?? []), row]);
    const team =
      role === 'CLAIMS_OFFICER'
        ? []
        : (
            await tx.user.findMany({
              where: { role: { in: ['CLAIMS_OFFICER', 'COLLECTION_MANAGER'] }, status: 'ACTIVE' },
              orderBy: { lastName: 'asc' },
              select: { id: true, firstName: true, lastName: true },
            })
          ).map((user) => ({
            id: user.id,
            name: `${user.firstName} ${user.lastName}`,
            // Presence and calls come with the telephony (lot T).
            presence: 'away' as const,
            calls: null,
            target: callTarget,
          }));

    return {
      scope: role === 'DIRECTOR' ? 'GLOBAL' : role === 'COLLECTION_MANAGER' ? 'TEAM' : 'PERSONAL',
      date: today,
      outstanding,
      debtors: new Set(open.map((row) => row.debtor.id)).size,
      invoices: open.reduce((sum, row) => sum + row.invoices.filter((invoice) => invoice.principalPaidCents < invoice.principalCents).length, 0),
      overdue30: ages.filter((item) => item.days > 30).reduce((sum, item) => sum + item.amount, 0),
      overdue30Sub: plural(ages.filter((item) => item.days > 30).length, 'dossier'),
      periods: {
        week: period('week', 'Cette semaine', monthlyTarget ? Math.round(monthlyTarget / 4) : 0),
        month: period('month', 'Ce mois-ci', monthlyTarget),
        year: period('year', 'Cette année', monthlyTarget * 12),
      },
      invoicesRecovered: allInvoices.filter((invoice) => invoice.principalPaidCents >= invoice.principalCents).length,
      invoicesEntrusted: allInvoices.length,
      dsoDays: dso,
      dsoSub: settled.length ? `sur ${plural(settled.length, 'dossier')} réglé${settled.length > 1 ? 's' : ''}` : 'aucun dossier réglé',
      priorities,
      feed: events.map((event) => ({
        id: event.id,
        kind: FEED[event.kind.split('_')[0]!] ?? 'SYSTEM',
        text: event.title,
        meta: `${event.case.reference} · ${event.actorLabel}`,
        time: dayOf(event.occurredAt) === today ? timeOf(event.occurredAt) : `${dayOf(event.occurredAt).slice(8, 10)}/${dayOf(event.occurredAt).slice(5, 7)}`,
      })),
      monthlyTarget,
      months,
      aging: AGES.map(([label, from, to]) => {
        const amount = ages.filter((item) => item.days >= from && item.days <= to).reduce((sum, item) => sum + item.amount, 0);
        return { label, amount, percent: outstanding ? Math.round((amount / outstanding) * 100) : 0 };
      }),
      creditors: [...byCreditor.values()].map((rows) => {
        const first = rows[0]!.creditor;
        const entrusted = rows.reduce((sum, row) => sum + row.invoices.reduce((all, invoice) => all + invoice.principalCents, 0), 0);
        const recovered = rows.reduce(
          (sum, row) => sum + row.payments.filter((payment) => payment.status !== 'BOUNCED').reduce((all, payment) => all + payment.amountCents, 0),
          0,
        );
        return {
          id: first.id,
          name: first.name,
          siren: first.siren ?? '',
          sector: first.sector ?? '',
          debtors: new Set(rows.map((row) => row.debtor.id)).size,
          invoices: rows.reduce((sum, row) => sum + row.invoices.length, 0),
          outstanding: rows.filter((row) => !CLOSED.includes(row.status)).reduce((sum, row) => sum + left(row), 0),
          recovered,
          rate: entrusted ? Math.round((recovered / entrusted) * 100) : 0,
        };
      }),
      topDebtors: [...ages]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(({ row, days, amount }) => ({
          id: row.id,
          name: name(row),
          siret: row.debtorSiret ?? '',
          creditor: row.creditor.name,
          amount,
          daysLate: days,
          status: row.status,
          statusLabel: STATUS_LABELS[row.status],
        })),
      team,
    };
  }

  /** Marked done for the person only; a key of a case they no longer read is refused. */
  async mark(role: StaffRole, userId: string, id: string, done: boolean): Promise<void> {
    const { tx } = this.database;
    const match = /^([a-z-]{1,32}):([0-9a-f-]{36})$/u.exec(id);
    // The Director has priorities on their own cases only, as in `read()`.
    const own = role === 'DIRECTOR' ? { officerId: userId } : {};
    if (!match || !(await tx.case.findFirst({ where: { id: match[2], ...own }, select: { id: true } }))) throw notFound();
    if (done) await tx.taskMark.upsert({ where: { userId_key: { userId, key: id } }, create: { userId, key: id }, update: {}, select: { key: true } });
    else await tx.taskMark.deleteMany({ where: { userId, key: id } });
  }
}
