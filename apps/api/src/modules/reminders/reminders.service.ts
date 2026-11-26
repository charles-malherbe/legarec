import type { agenda, newReminder, Reminder, reminderBody, reminderPlanned, reminderTargets } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Database } from '../../platform/database/database';
import { ApiError, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import type { StaffActor } from '../account/account.service';
import { SettingValues } from '../settings/values';
import { capOf, capPeriod, outsideHours, type Channel } from './contact-rules';

const DAY_MS = 86_400_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const asTime = (time: string) => time || null;
/** What the agenda shows: a month back, three months ahead. */
const WINDOW = { back: 30, ahead: 92 };

/** The agenda of the reminders. PostgreSQL decides which cases each one reads and acts on: nothing here filters by role. */
@Injectable()
export class RemindersService {
  constructor(@Inject(Database) private readonly database: Database) {}

  private canAct = (actor: StaffActor, officerId: string | null) => actor.role !== 'DIRECTOR' || officerId === actor.userId;

  async agenda(actor: StaffActor): Promise<z.infer<typeof agenda>> {
    const { tx } = this.database;
    const today = dayOf(new Date());
    const range = { gte: new Date(`${shift(today, -WINDOW.back)}T00:00:00Z`), lte: new Date(`${shift(today, WINDOW.ahead)}T00:00:00Z`) };
    const caseOf = {
      select: { id: true, officerId: true, creditorId: true, depositedName: true, debtor: { select: { name: true } }, creditor: { select: { name: true } } },
    };
    const [planned, installments] = await Promise.all([
      tx.plannedReminder.findMany({
        where: { dueOn: range },
        orderBy: [{ dueOn: 'asc' }, { dueTime: 'asc' }],
        take: 1000,
        select: { id: true, kind: true, dueOn: true, dueTime: true, title: true, warning: true, doneAt: true, case: caseOf },
      }),
      // The installments of the plans in force: shown, never planned nor removed here.
      tx.installment.findMany({
        where: { dueOn: range, plan: { status: 'ACTIVE' } },
        orderBy: { dueOn: 'asc' },
        take: 1000,
        select: { id: true, number: true, dueOn: true, amountCents: true, case: caseOf },
      }),
    ]);
    const named = (row: (typeof planned)[number]['case']) => row.depositedName ?? row.debtor.name;
    const items: Reminder[] = [
      ...planned.map((row) => ({
        id: row.id,
        date: dayOf(row.dueOn),
        time: row.dueTime,
        type: row.kind,
        debtor: named(row.case),
        caseId: row.case.id,
        creditorId: row.case.creditorId,
        creditor: row.case.creditor.name,
        title: row.title,
        done: row.doneAt !== null,
        automatic: false,
        officerId: row.case.officerId,
        canAct: this.canAct(actor, row.case.officerId),
        limit: row.warning,
      })),
      ...installments.map((row) => ({
        id: `installment:${row.id}`,
        date: dayOf(row.dueOn),
        time: null,
        type: 'INSTALLMENT' as const,
        debtor: named(row.case),
        caseId: row.case.id,
        creditorId: row.case.creditorId,
        creditor: row.case.creditor.name,
        title: `Échéance n° ${row.number}`,
        done: false,
        automatic: true,
        officerId: row.case.officerId,
        canAct: false,
        limit: null,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
    // What has left this week: with the sendings of lot Q.
    return { today, items, weekly: { emails: 0, sms: 0, letters: 0 } };
  }

  /** The cases one may plan a reminder on: those one acts on. */
  async targets(actor: StaffActor): Promise<z.infer<typeof reminderTargets>> {
    const rows = await this.database.tx.case.findMany({
      where: { closedOn: null, ...(actor.role === 'DIRECTOR' ? { officerId: actor.userId } : {}) },
      orderBy: { reference: 'asc' },
      take: 2000,
      select: { id: true, depositedName: true, debtor: { select: { name: true } }, creditor: { select: { name: true } } },
    });
    return { items: rows.map((row) => ({ id: row.id, name: row.depositedName ?? row.debtor.name, creditor: row.creditor.name })) };
  }

  /** Over a cap of the debtor, whatever the creditor, or outside the hours: planned all the same, with the warning. */
  private async warning(caseId: string, channel: Channel, day: string, time: string | null): Promise<string | null> {
    const { tx } = this.database;
    const hours = outsideHours(channel, day, time);
    if (hours) return hours;
    const settings = await SettingValues.read(tx);
    const { cap, unit } = capOf(channel, (field) => settings.text('firm', 'relances', field));
    const [from, to] = capPeriod(channel, day);
    const [row] = await tx.$queryRaw<
      { count: number }[]
    >`SELECT app.planned_contacts(${caseId}::uuid, ${channel}::planned_kind, ${from}::date, ${to}::date) AS count`;
    return (row?.count ?? 0) >= cap ? `Plafond atteint : ${cap} ${unit} pour ce débiteur` : null;
  }

  async plan(actor: StaffActor, body: z.infer<typeof newReminder>): Promise<z.infer<typeof reminderPlanned>> {
    const { tx } = this.database;
    if (body.date < dayOf(new Date())) throw new ApiError(422, 'PAST_DATE');
    const found = await tx.case.findFirst({ where: { id: body.caseId, closedOn: null }, select: { id: true, creditorId: true, officerId: true } });
    if (!found) throw notFound();
    if (!this.canAct(actor, found.officerId)) throw new ApiError(403, 'FORBIDDEN');
    const limit = await this.warning(found.id, body.type, body.date, body.time || null);
    const { id } = await tx.plannedReminder.create({
      data: {
        caseId: found.id,
        creditorId: found.creditorId,
        kind: body.type,
        dueOn: new Date(`${body.date}T00:00:00Z`),
        dueTime: asTime(body.time),
        title: body.title,
        warning: limit,
      },
      select: { id: true },
    });
    return { id, limit };
  }

  async change(actor: StaffActor, id: string, body: z.infer<typeof reminderBody>): Promise<void> {
    const { tx } = this.database;
    const found = await tx.plannedReminder.findFirst({ where: { id }, select: { id: true, doneAt: true, case: { select: { officerId: true } } } });
    if (!found) throw notFound();
    if (!this.canAct(actor, found.case.officerId)) throw new ApiError(403, 'FORBIDDEN');
    if (body.date !== undefined && body.date < dayOf(new Date()) && body.done !== true) throw new ApiError(422, 'PAST_DATE');
    await tx.plannedReminder.update({
      where: { id },
      data: {
        ...(body.date !== undefined ? { dueOn: new Date(`${body.date}T00:00:00Z`) } : {}),
        ...(body.time !== undefined ? { dueTime: asTime(body.time) } : {}),
        ...(body.done !== undefined ? { doneAt: body.done ? (found.doneAt ?? new Date()) : null } : {}),
      },
      select: { id: true },
    });
  }

  /** Only a reminder planned by hand and not done: never an installment. */
  async remove(actor: StaffActor, id: string): Promise<void> {
    const { tx } = this.database;
    const found = await tx.plannedReminder.findFirst({ where: { id }, select: { doneAt: true, case: { select: { officerId: true } } } });
    if (!found) throw notFound();
    if (!this.canAct(actor, found.case.officerId) || found.doneAt) throw new ApiError(403, 'FORBIDDEN');
    await tx.plannedReminder.delete({ where: { id }, select: { id: true } });
  }
}
