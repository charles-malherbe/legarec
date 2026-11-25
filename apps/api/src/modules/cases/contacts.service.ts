import { checkCoordinate, type REQUEST_BODIES } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { conflict, invalid, notFound } from '../../platform/errors/api-error';
import { CasesService, normalized, type StaffActor } from './cases.service';

type Bodies = (typeof REQUEST_BODIES)['staff'];
type NewContact = z.infer<Bodies['POST /cases/:id/coordinates']>;
type Change = z.infer<Bodies['PUT /cases/:id/coordinates/:coordinateId']>;

/** Coordinates of a debtor for one case. A code of access only goes to those that a collaborator has confirmed (question 112). */
@Injectable()
export class ContactsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async add(actor: StaffActor, caseId: string, body: NewContact): Promise<void> {
    const { tx } = this.database;
    const { creditor_id: creditorId } = await this.locked(caseId);
    if (checkCoordinate(body.kind, body.value, [], null)) throw invalid({ fields: ['value'] });
    const known = await tx.caseContact.findMany({
      where: { caseId, kind: body.kind, status: { not: 'INVALID' } },
      select: { id: true, valueNormalized: true },
    });
    const value = normalized(body.kind, body.value);
    if (known.some((contact) => contact.valueNormalized === value && contact.id !== body.replaces)) throw conflict('COORDINATE_EXISTS');
    const replaced = body.replaces ? known.find((contact) => contact.id === body.replaces) : undefined;
    if (body.replaces && !replaced) throw conflict('CHANGED');
    if (replaced)
      await tx.caseContact.update({
        where: { id: replaced.id },
        data: { status: 'INVALID', isPrimary: false, invalidatedAt: new Date() },
        select: { id: true },
      });
    if (body.primary) await tx.caseContact.updateMany({ where: { caseId, kind: body.kind, isPrimary: true }, data: { isPrimary: false } });
    const id = await this.cases.addContact(tx, actor, {
      caseId,
      creditorId,
      kind: body.kind,
      label: body.label,
      value: body.value,
      primary: body.primary,
      source: body.source,
      status: 'NEW',
    });
    if (replaced) {
      await tx.caseContact.update({ where: { id: replaced.id }, data: { replacedById: id }, select: { id: true } });
      await tx.$executeRaw`SELECT app.note_contact(${replaced.id}::uuid, 'REPLACED')`;
    }
    // Neither the number nor the address is written in the history nor in the journal.
    await this.cases.event(caseId, 'CONTACT_ADDED', replaced ? 'Coordonnée remplacée' : 'Coordonnée ajoutée', body.kind === 'PHONE' ? 'Téléphone' : 'E-mail');
    await this.audit.log({ action: 'CONTACT_ADDED', entity: { type: 'case', id: caseId } });
  }

  async change(caseId: string, contactId: string, { status, primary }: Change): Promise<void> {
    const { tx } = this.database;
    await this.locked(caseId);
    const contact = await tx.caseContact.findFirst({ where: { id: contactId, caseId }, select: { id: true, kind: true, status: true, isPrimary: true } });
    if (!contact) throw notFound();
    const next = status ?? contact.status;
    // One that is wrong is the main one of nothing; it never becomes it.
    const main = next !== 'INVALID' && (primary ?? contact.isPrimary);
    if (primary && next === 'INVALID') throw invalid({ fields: ['primary'] });
    if (main && !contact.isPrimary) await tx.caseContact.updateMany({ where: { caseId, kind: contact.kind, isPrimary: true }, data: { isPrimary: false } });
    await tx.caseContact.update({
      where: { id: contactId },
      // Taken back: it no longer stands for the one that replaced it.
      data: { status: next, isPrimary: main, invalidatedAt: next === 'INVALID' ? new Date() : null, ...(next === 'INVALID' ? {} : { replacedById: null }) },
      select: { id: true },
    });
    const what = status && status !== contact.status ? ({ VERIFIED: 'VERIFIED', INVALID: 'INVALIDATED' } as Record<string, string>)[status] : undefined;
    await tx.$executeRaw`SELECT app.note_contact(${contactId}::uuid, ${what ?? (main && !contact.isPrimary ? 'MADE_PRIMARY' : 'CHANGED')})`;
    await this.audit.log({ action: 'CONTACT_CHANGED', entity: { type: 'case', id: caseId } });
  }

  /** One change after the other for a case. */
  private async locked(caseId: string) {
    const row = await this.cases.acting(caseId);
    await this.database.tx.$queryRaw`SELECT 1 FROM cases WHERE id = ${caseId}::uuid FOR NO KEY UPDATE`;
    return row;
  }
}
