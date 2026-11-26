import {
  formatSiren,
  formatSiret,
  LITIGATION_STAGES,
  type LitigationCase,
  type litigationBody,
  type litigationConsentBody,
  type litigationData,
  type litigationFileBody,
  type LitigationStage,
  type litigationStageBody,
} from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { ApiError, conflict, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import type { StaffActor } from '../account/account.service';
import { balanceOf, Ledgers } from '../payments/ledger';

const CODES: readonly LitigationStage[] = LITIGATION_STAGES.map((stage) => stage.code);
const labelOf = (stage: LitigationStage) => LITIGATION_STAGES[CODES.indexOf(stage)]!.label;
/** A plan still being decided or in force: the case is not sent to litigation behind it. */
const OPEN_PLANS = ['PENDING_MANAGER', 'WAITING_CREDITOR', 'WAITING_DEBTOR', 'ACTIVE'] as const;
/** The history lines that tell the procedure, shown on the screen. */
const STEPS = ['LITIGATION_OPENED', 'LITIGATION_STAGE', 'LITIGATION_CONSENT', 'LITIGATION_CLOSED'];
/** The cases shown at most: the screen reads them all at once. */
const SHOWN = 2000;

/**
 * Litigation in a minimal follow-up (question 163): the stage, the court and the partner. PostgreSQL decides which cases each
 * one reads and acts on, and keeps the rules of the stages (`app.litigation_rules`): nothing here filters by role.
 */
@Injectable()
export class LitigationService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Ledgers) private readonly ledgers: Ledgers,
  ) {}

  private canAct = (actor: StaffActor, officerId: string | null) => actor.role !== 'DIRECTOR' || officerId === actor.userId;

  private async event(caseId: string, kind: string, title: string, detail: string | null, tone: 'info' | 'success' | 'danger', toCreditor: boolean) {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, ${kind}, ${title}, ${detail}, ${tone}::event_tone, ${toCreditor})`;
  }

  async list(actor: StaffActor): Promise<z.infer<typeof litigationData>> {
    const { tx } = this.database;
    const files = await tx.litigationFile.findMany({
      orderBy: [{ stageSince: 'asc' }, { id: 'asc' }],
      take: SHOWN,
      select: {
        id: true,
        stage: true,
        stageSince: true,
        court: true,
        partnerName: true,
        consent: true,
        titleOn: true,
        version: true,
        case: {
          select: {
            id: true,
            officerId: true,
            creditorId: true,
            debtorSiret: true,
            depositedName: true,
            debtor: { select: { name: true, kind: true, siren: true } },
            creditor: { select: { name: true } },
            invoices: { select: { principalCents: true, principalPaidCents: true } },
            events: {
              where: { kind: { in: STEPS } },
              orderBy: { occurredAt: 'asc' },
              take: 20,
              select: { title: true, occurredAt: true, actorLabel: true },
            },
          },
        },
      },
    });
    const today = dayOf(new Date());
    const cases: LitigationCase[] = [];
    for (const file of files) {
      const row = file.case;
      const amount = row.invoices.reduce((sum, invoice) => sum + invoice.principalCents - invoice.principalPaidCents, 0);
      // What closing compares to zero: all that is owed today, interest and fees included.
      const ledger = file.stage === 'CLOSED' ? null : await this.ledgers.read(row.id, today, actor.role === 'DIRECTOR');
      cases.push({
        id: file.id,
        caseId: row.id,
        stage: CODES.indexOf(file.stage),
        stageSince: dayOf(file.stageSince),
        debtor: row.depositedName ?? row.debtor.name,
        identifier:
          row.debtor.kind === 'INDIVIDUAL'
            ? 'Particulier'
            : row.debtorSiret
              ? `SIRET ${formatSiret(row.debtorSiret)}`
              : `SIREN ${formatSiren(row.debtor.siren ?? '')}`,
        creditorId: row.creditorId,
        creditor: row.creditor.name,
        amount,
        balance: ledger ? balanceOf(ledger) : 0,
        court: file.court ?? '',
        partnerName: file.partnerName ?? '',
        consent: file.consent,
        events: row.events.map((event) => ({ title: event.title, date: dayOf(event.occurredAt), who: event.actorLabel })),
        version: file.version,
        canAct: file.stage !== 'CLOSED' && this.canAct(actor, row.officerId),
      });
    }
    const open = cases.filter((item) => item.stage < CODES.indexOf('CLOSED'));
    const year = today.slice(0, 4);
    return {
      cases,
      stageTotals: CODES.map((_, index) => {
        const list = cases.filter((item) => item.stage === index);
        return { count: list.length, amount: list.reduce((sum, item) => sum + item.amount, 0) };
      }),
      stats: {
        amount: open.reduce((sum, item) => sum + item.amount, 0),
        count: open.length,
        titles: files.filter((file) => file.titleOn && dayOf(file.titleOn).startsWith(year)).length,
        waiting: open.filter((item) => item.consent === 'WAITING').length,
      },
    };
  }

  /** The cases awaiting the agreement of their creditor that this person may note: the counter of the menu. */
  async waiting(actor: StaffActor): Promise<number> {
    return this.database.tx.litigationFile.count({
      where: { consent: 'WAITING', stage: { not: 'CLOSED' }, ...(actor.role === 'DIRECTOR' ? { case: { officerId: actor.userId } } : {}) },
    });
  }

  /** All or nothing: each case read, acted on, open, without a plan being decided or in force. */
  async open(actor: StaffActor, body: z.infer<typeof litigationBody>): Promise<void> {
    const { tx } = this.database;
    const ids = [...new Set(body.ids)];
    const found = await tx.case.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        creditorId: true,
        officerId: true,
        status: true,
        version: true,
        mandate: { select: { litigationNeedsConsent: true } },
        plans: { where: { status: { in: [...OPEN_PLANS] } }, select: { id: true }, take: 1 },
      },
    });
    if (found.length !== ids.length) throw notFound();
    if (found.some((row) => !this.canAct(actor, row.officerId))) throw new ApiError(403, 'FORBIDDEN');
    if (found.some((row) => row.status === 'LITIGATION')) throw conflict('ALREADY_IN_LITIGATION');
    if (found.some((row) => row.status === 'SETTLED' || row.status === 'LOST')) throw conflict('CASE_CLOSED');
    if (found.some((row) => row.plans.length > 0)) throw conflict('PLAN_IN_PROGRESS');
    for (const row of found) {
      // Without a mandate, its rule is unknown: the agreement is asked for, as the strictest mandate would.
      const needed = row.mandate?.litigationNeedsConsent ?? true;
      const consent = !needed ? 'NOT_NEEDED' : body.consentReceived ? 'RECEIVED' : 'WAITING';
      const changed = await tx.case.updateMany({
        where: { id: row.id, version: row.version, status: row.status },
        data: { status: 'LITIGATION', version: { increment: 1 } },
      });
      if (changed.count !== 1) throw conflict('CHANGED');
      await tx.litigationFile.create({ data: { caseId: row.id, creditorId: row.creditorId, consent } });
      await this.event(row.id, 'LITIGATION_OPENED', 'Passage en contentieux', labelOf('FORMAL_NOTICE'), 'danger', true);
      // The reason is the team's: the creditor reads the step, not what was typed.
      await this.event(row.id, 'LITIGATION_REASON', 'Motif du passage en contentieux', body.reason, 'info', false);
      if (consent === 'RECEIVED') await this.event(row.id, 'LITIGATION_CONSENT', 'Accord écrit du créancier reçu', null, 'success', true);
      await this.audit.log({ action: 'LITIGATION_OPENED', entity: { type: 'case', id: row.id } });
      if (consent === 'RECEIVED') await this.audit.log({ action: 'LITIGATION_CONSENT_NOTED', entity: { type: 'case', id: row.id } });
    }
  }

  /** The file one acts on, at the version that was shown. */
  private async actOn(actor: StaffActor, id: string, version: number) {
    const file = await this.database.tx.litigationFile.findUnique({
      where: { id },
      select: { id: true, caseId: true, stage: true, consent: true, version: true, case: { select: { officerId: true, status: true } } },
    });
    if (!file) throw notFound();
    if (!this.canAct(actor, file.case.officerId)) throw new ApiError(403, 'FORBIDDEN');
    if (file.stage === 'CLOSED') throw conflict('LITIGATION_CLOSED');
    if (file.version !== version) throw conflict('CHANGED');
    return file;
  }

  private async save(id: string, version: number, data: { court?: string | null; partnerName?: string | null; stage?: LitigationStage; consent?: 'RECEIVED' }) {
    const changed = await this.database.tx.litigationFile.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (changed.count !== 1) throw conflict('CHANGED');
  }

  /** Court and partner, typed freely: reversible, kept out of the creditor's history. */
  async describe(actor: StaffActor, id: string, body: z.infer<typeof litigationFileBody>): Promise<void> {
    await this.actOn(actor, id, body.version);
    await this.save(id, body.version, { court: body.court || null, partnerName: body.partnerName || null });
  }

  /** One step forward, or closed: closed, the case is settled when nothing is left to pay, otherwise lost. */
  async advance(actor: StaffActor, id: string, body: z.infer<typeof litigationStageBody>): Promise<void> {
    const { tx } = this.database;
    const file = await this.actOn(actor, id, body.version);
    if (body.stage === 'CLOSED') {
      const ledger = await this.ledgers.read(file.caseId, dayOf(new Date()));
      if (!ledger) throw notFound();
      const outcome = balanceOf(ledger) === 0 ? 'SETTLED' : 'LOST';
      if (body.expectedOutcome !== outcome) throw conflict('CHANGED');
      await this.save(id, body.version, { stage: 'CLOSED' });
      const closed = await tx.case.updateMany({
        where: { id: file.caseId, status: 'LITIGATION' },
        data: { status: outcome, closedOn: new Date(`${dayOf(new Date())}T00:00:00Z`), version: { increment: 1 } },
      });
      if (closed.count !== 1) throw conflict('CHANGED');
      await this.event(
        file.caseId,
        'LITIGATION_CLOSED',
        outcome === 'SETTLED' ? 'Procédure close : recouvré' : 'Procédure close : irrécouvrable',
        null,
        outcome === 'SETTLED' ? 'success' : 'danger',
        true,
      );
      await this.audit.log({ action: 'LITIGATION_CLOSED', entity: { type: 'case', id: file.caseId } });
      return;
    }
    const next = CODES[CODES.indexOf(file.stage) + 1];
    if (body.stage !== next) throw conflict('CHANGED');
    if (file.consent === 'WAITING') throw conflict('CONSENT_AWAITED');
    await this.save(id, body.version, { stage: body.stage });
    await this.event(file.caseId, 'LITIGATION_STAGE', `Contentieux : ${labelOf(body.stage)}`, null, 'info', true);
    await this.audit.log({ action: 'LITIGATION_STAGE_CHANGED', entity: { type: 'case', id: file.caseId }, params: { stage: CODES.indexOf(body.stage) + 1 } });
  }

  /** The written agreement of the creditor, ticked by whoever acts on the case; PostgreSQL notes who and when. */
  async consent(actor: StaffActor, id: string, body: z.infer<typeof litigationConsentBody>): Promise<void> {
    const file = await this.actOn(actor, id, body.version);
    if (file.consent !== 'WAITING') throw conflict('CHANGED');
    await this.save(id, body.version, { consent: 'RECEIVED' });
    await this.event(file.caseId, 'LITIGATION_CONSENT', 'Accord écrit du créancier reçu', null, 'success', true);
    await this.audit.log({ action: 'LITIGATION_CONSENT_NOTED', entity: { type: 'case', id: file.caseId } });
  }
}
