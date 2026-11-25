import {
  hasDelegation,
  MANDATE_INTEREST_LABELS,
  type CreditorFile,
  type CreditorListItem,
  type MandateForm,
  type MandateVersion,
  type NewCreditor,
} from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { bankAccountChange, creditorChanges, creditorChoices, creditorDetail, mandateAmendment } from '@legarec/contracts';
import { Audit } from '../../platform/audit/audit';
import type { Actor } from '../../platform/database/actor';
import { Database, type Transaction } from '../../platform/database/database';
import { conflict, invalid, notFound } from '../../platform/errors/api-error';
import { capitalized, ago, dayOf } from '../../platform/format';
import { SettingValues } from '../settings/values';
import { Vault } from '../vault/vault';

export type StaffActor = Extract<Actor, { kind: 'staff' }>;
type Identity = NewCreditor['identity'];
type Account = z.infer<typeof bankAccountChange>['account'];

const compact = (value: string) => value.replace(/\s/gu, '').toUpperCase();
const day = (date: Date) => date.toISOString().slice(0, 10);
const date = (value: string) => new Date(`${value}T00:00:00Z`);
const dayBefore = (value: string) => new Date(date(value).getTime() - 86_400_000);
export const initialsOf = (name: string) =>
  name
    .split(/[\s-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
export const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const masked = (iban: string) => `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
const shortName = (person: { firstName: string; lastName: string }) => `${person.firstName.charAt(0)}. ${person.lastName}`;
const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`;
const person = { select: { firstName: true, lastName: true } } as const;

type MandateRow = NonNullable<Awaited<ReturnType<CreditorsService['mandates']>>[number]>;

/** A month before its end, a mandate is to be renewed. */
const RENEWAL_DAYS = 60;

/** Creditors, mandates and accounts. The Director and the manager act in their own right; the account is the Director's, or their delegate's. */
@Injectable()
export class CreditorsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async list(): Promise<CreditorListItem[]> {
    const found = await this.database.tx.creditor.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, siren: true, sector: true, manager: person, mandates: { orderBy: { startsOn: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const debtors = await this.debtors(found.map((item) => item.id));
    return found.map((item) => this.summary(item, debtors.get(item.id) ?? 0));
  }

  async detail(actor: StaffActor, id: string): Promise<z.infer<typeof creditorDetail>> {
    const item = await this.database.tx.creditor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        siren: true,
        sector: true,
        portalEnabled: true,
        createdAt: true,
        manager: person,
        mandates: { orderBy: { startsOn: 'asc' } },
        contacts: { where: { isMain: true } },
      },
    });
    if (!item) throw notFound();
    const count = (await this.debtors([id])).get(id) ?? 0;
    const current = currentOf(item.mandates);
    const [main] = item.contacts;
    return {
      ...this.summary(item, count),
      mandateSince: day(item.mandates[0]?.startsOn ?? item.createdAt),
      ownerName: item.manager ? fullName(item.manager) : '',
      totalDebtors: count,
      // Cases, payments and remittances: with their own modules.
      portfolio: [],
      payouts: [],
      nextPayout: { date: dayOf(new Date()), net: 0, gross: 0, fee: 0 },
      activity: [],
      mandateTerms: current ? termsOf(current, actor.role === 'CLAIMS_OFFICER') : [],
      contact: {
        name: main?.name ?? '',
        title: main?.title ?? '',
        phone: main?.phone ?? '',
        email: main?.email ?? 'contact@legarec.fr',
        portalEnabled: item.portalEnabled,
      },
    };
  }

  // ---------------------------------------------------------------- Form « Créancier et mandat »

  async choices(actor: StaffActor): Promise<z.infer<typeof creditorChoices>> {
    const managers = await this.database.tx.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const values = await SettingValues.read(this.database.tx);
    const rate = /^(\d{1,3}(?:[.,]\d{1,2})?)/u.exec(values.text('firm', 'reversements', 'commission'))?.[1];
    return {
      managers: managers.map((manager) => ({ id: manager.id, name: fullName(manager) })),
      bankAccess: this.bankAccess(actor),
      defaults: { amicableRateBp: rate ? Math.min(10_000, Math.round(Number(rate.replace(',', '.')) * 100)) : 0 },
    };
  }

  async file(actor: StaffActor, id: string): Promise<CreditorFile> {
    const { tx } = this.database;
    const item = await tx.creditor.findUnique({
      where: { id },
      select: {
        id: true,
        version: true,
        siren: true,
        name: true,
        legalName: true,
        vatNumber: true,
        sector: true,
        address: true,
        postalCode: true,
        city: true,
        managerId: true,
        portalEnabled: true,
        updatedBy: true,
        updatedAt: true,
        mandates: { orderBy: { startsOn: 'desc' } },
        contacts: { orderBy: [{ isMain: 'desc' }, { name: 'asc' }] },
      },
    });
    if (!item) throw notFound();
    const author = item.updatedBy ? await tx.user.findUnique({ where: { id: item.updatedBy }, select: { firstName: true, lastName: true } }) : null;
    const access = this.bankAccess(actor);
    const account =
      access === 'EDIT'
        ? await tx.creditorBankAccount.findFirst({
            where: { creditorId: id, validUntil: null },
            select: { id: true, holder: true, ibanMasked: true, bic: true, validFrom: true, confirmedAt: true, confirmedWith: true },
          })
        : null;
    return {
      id,
      version: item.version,
      siren: item.siren ?? '',
      identity: {
        legalName: item.legalName ?? item.name,
        name: item.name,
        sector: item.sector ?? '',
        vatNumber: item.vatNumber ?? '',
        address: item.address ?? '',
        postalCode: item.postalCode ?? '',
        city: item.city ?? '',
        managerId: item.managerId,
        portalEnabled: item.portalEnabled,
      },
      contacts: item.contacts.map(({ name, title, email, phone, isMain }) => ({ name, title: title ?? '', email, phone: phone ?? '', isMain })),
      mandates: item.mandates.map(versionOf),
      openCases: await tx.case.count({ where: { creditorId: id, closedOn: null } }),
      updatedBy: author ? fullName(author) : null,
      updatedAt: capitalized(ago(item.updatedAt)),
      bankAccess: access,
      bankAccount: account && {
        id: account.id,
        holder: account.holder,
        masked: account.ibanMasked,
        bic: account.bic,
        since: dayOf(account.validFrom),
        confirmed: account.confirmedAt ? { on: dayOf(account.confirmedAt), with: account.confirmedWith ?? '' } : null,
      },
    };
  }

  async create(actor: StaffActor, body: NewCreditor): Promise<{ id: string }> {
    const { tx } = this.database;
    const siren = compact(body.siren);
    if (await tx.creditor.findUnique({ where: { siren }, select: { id: true } })) throw conflict('SIREN_TAKEN');
    await this.checkManager(body.identity.managerId);
    const id = randomUUID();
    await tx.creditor.create({ data: { id, siren, ...columns(body.identity), updatedBy: actor.userId }, select: { id: true } });
    await this.writeContacts(tx, id, body.contacts);
    await tx.mandate.create({ data: { creditorId: id, ...mandateColumns(body.mandate), createdBy: actor.userId }, select: { id: true } });
    await this.audit.log({ action: 'CREDITOR_CREATED', entity: { type: 'creditor', id } });
    return { id };
  }

  async change(actor: StaffActor, id: string, { version, identity, contacts }: z.infer<typeof creditorChanges>): Promise<void> {
    const { tx } = this.database;
    await this.checkManager(identity.managerId);
    const { count } = await tx.creditor.updateMany({
      where: { id, version },
      data: { ...columns(identity), version: { increment: 1 }, updatedBy: actor.userId, updatedAt: new Date() },
    });
    if (!count) {
      if (!(await tx.creditor.findUnique({ where: { id }, select: { id: true } }))) throw notFound();
      throw conflict('CHANGED');
    }
    await tx.creditorContact.deleteMany({ where: { creditorId: id } });
    await this.writeContacts(tx, id, contacts);
    await this.audit.log({ action: 'CREDITOR_CHANGED', entity: { type: 'creditor', id } });
  }

  /** The terms of a mandate never change: the new one starts where the former one ends. Cases already open keep theirs. */
  async amend(actor: StaffActor, id: string, { amends, mandate }: z.infer<typeof mandateAmendment>): Promise<void> {
    const { tx } = this.database;
    await this.locked(tx, id);
    const [last] = await tx.mandate.findMany({ where: { creditorId: id }, orderBy: { startsOn: 'desc' }, take: 1 });
    if (!last || last.id !== amends) throw conflict('CHANGED');
    if (mandate.startsOn <= day(last.startsOn)) throw invalid({ fields: ['mandate.startsOn'] });
    // A mandate that ended before is not extended by its amendment.
    const end = dayBefore(mandate.startsOn);
    if (last.endsOn === null || last.endsOn > end) await tx.mandate.update({ where: { id: last.id }, data: { endsOn: end }, select: { id: true } });
    const { id: added } = await tx.mandate.create({
      data: { creditorId: id, amendsId: last.id, ...mandateColumns(mandate), createdBy: actor.userId },
      select: { id: true },
    });
    await this.audit.log({ action: 'MANDATE_AMENDED', entity: { type: 'mandate', id: added } });
  }

  // ---------------------------------------------------------------- Account of the remittances

  async replaceAccount(actor: StaffActor, id: string, { replaces, account }: z.infer<typeof bankAccountChange>): Promise<void> {
    const { tx } = this.database;
    await this.locked(tx, id);
    const current = await tx.creditorBankAccount.findFirst({ where: { creditorId: id, validUntil: null }, select: { id: true } });
    if ((current?.id ?? null) !== replaces) throw conflict('CHANGED');
    if (current) await tx.creditorBankAccount.update({ where: { id: current.id }, data: { validUntil: new Date() }, select: { id: true } });
    await this.writeAccount(actor, id, account);
  }

  async confirmAccount(actor: StaffActor, id: string, accountId: string, confirmedWith: string): Promise<void> {
    const { count } = await this.database.tx.creditorBankAccount.updateMany({
      where: { id: accountId, creditorId: id, validUntil: null, confirmedAt: null },
      data: { confirmedBy: actor.userId, confirmedAt: new Date(), confirmedWith },
    });
    if (!count) throw conflict('CHANGED');
    await this.audit.log({ action: 'CREDITOR_ACCOUNT_CONFIRMED', entity: { type: 'creditor', id } });
  }

  /** Shown on demand, and noted each time. */
  async reveal(id: string, accountId: string): Promise<{ iban: string }> {
    const { tx } = this.database;
    const account = await tx.creditorBankAccount.findFirst({ where: { id: accountId, creditorId: id }, select: { id: true } });
    const [row] = account ? await tx.$queryRaw<{ cipher: Uint8Array | null }[]>`SELECT app.creditor_iban(${accountId}::uuid) AS cipher` : [];
    if (!row?.cipher) throw notFound();
    await this.audit.log({ action: 'CREDITOR_IBAN_SHOWN', entity: { type: 'creditor', id } });
    return { iban: this.vault.openFor({ table: 'creditor_bank_accounts', id: accountId, column: 'iban_cipher' }, row.cipher).replace(/(.{4})(?=.)/gu, '$1 ') };
  }

  private async writeAccount(actor: StaffActor, creditorId: string, account: Account): Promise<void> {
    const { tx } = this.database;
    const id = randomUUID();
    const iban = compact(account.iban);
    const [behalf] = await tx.$queryRaw<{ id: string | null }[]>`SELECT app.on_behalf_of() AS id`;
    // Written without reading it back: the team never selects the value.
    await tx.$executeRaw`
      INSERT INTO creditor_bank_accounts (id, creditor_id, holder, iban_cipher, iban_masked, bic, confirmed_by, confirmed_at, confirmed_with, created_by, on_behalf_of_id)
      VALUES (${id}::uuid, ${creditorId}::uuid, ${account.holder}, ${this.vault.sealFor({ table: 'creditor_bank_accounts', id, column: 'iban_cipher' }, iban)}, ${masked(iban)}, ${compact(account.bic)},
        ${account.confirmedWith ? actor.userId : null}::uuid, ${account.confirmedWith ? new Date() : null}::timestamptz, ${account.confirmedWith || null}, ${actor.userId}::uuid, ${behalf?.id ?? null}::uuid)`;
    await this.audit.log({ action: 'CREDITOR_ACCOUNT_CHANGED', entity: { type: 'creditor', id: creditorId } });
    if (account.confirmedWith) await this.audit.log({ action: 'CREDITOR_ACCOUNT_CONFIRMED', entity: { type: 'creditor', id: creditorId } });
  }

  // ---------------------------------------------------------------- Shared

  private bankAccess(actor: StaffActor): 'EDIT' | 'NONE' {
    return actor.role === 'DIRECTOR' || hasDelegation({ role: actor.role, activeDelegations: [...actor.delegations], userId: actor.userId }, 'ADMINISTRATIVE')
      ? 'EDIT'
      : 'NONE';
  }

  /** One change after the other for a creditor. */
  private async locked(tx: Transaction, id: string): Promise<void> {
    const [row] = await tx.$queryRaw<unknown[]>`SELECT 1 FROM creditors WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
    if (!row) throw notFound();
  }

  private async checkManager(id: string | null): Promise<void> {
    if (id === null) return;
    const found = await this.database.tx.user.findFirst({
      where: { id, status: 'ACTIVE', role: { in: ['DIRECTOR', 'COLLECTION_MANAGER', 'CLAIMS_OFFICER'] } },
      select: { id: true },
    });
    if (!found) throw invalid({ fields: ['identity.managerId'] });
  }

  private async writeContacts(tx: Transaction, creditorId: string, contacts: NewCreditor['contacts']): Promise<void> {
    for (const { name, title, email, phone, isMain } of contacts)
      await tx.creditorContact.create({ data: { creditorId, name, title: title || null, email, phone: phone || null, isMain }, select: { id: true } });
  }

  mandates(creditorId: string) {
    return this.database.tx.mandate.findMany({ where: { creditorId }, orderBy: { startsOn: 'asc' } });
  }

  private async debtors(ids: string[]): Promise<Map<string, number>> {
    const rows = await this.database.tx.case.groupBy({ by: ['creditorId'], _count: { _all: true }, where: { creditorId: { in: ids } } });
    return new Map(rows.map((row) => [row.creditorId, row._count._all]));
  }

  private summary(
    item: {
      id: string;
      name: string;
      siren: string | null;
      sector: string | null;
      manager: { firstName: string; lastName: string } | null;
      mandates: MandateRow[];
    },
    debtors: number,
  ): CreditorListItem {
    const current = currentOf(item.mandates);
    const last = item.mandates.at(-1);
    const ends = current?.endsOn && current.id === last?.id ? current.endsOn : null;
    const renewal = ends !== null && ends.getTime() - Date.now() < RENEWAL_DAYS * 86_400_000;
    const status = current ? (renewal ? `Renouvellement ${day(ends).slice(5, 7)}/${day(ends).slice(0, 4)}` : 'Mandat actif') : 'Aucun mandat actif';
    return {
      id: item.id,
      initials: initialsOf(item.name),
      name: item.name,
      sector: item.sector ?? '',
      siren: (item.siren ?? '').replace(/(\d{3})(?=\d)/gu, '$1 '),
      debtors,
      invoices: 0,
      outstanding: 0,
      recovered: 0,
      rate: 0,
      fee: current ? `${percent(current.amicableRateBp)} HT` : '—',
      owner: item.manager ? shortName(item.manager) : '',
      status: current && !renewal ? 'ACTIVE' : 'RENEWAL',
      statusLabel: status,
    };
  }
}

const today = () => dayOf(new Date());
function stateOf(mandate: { startsOn: Date; endsOn: Date | null }): 'CURRENT' | 'TO_COME' | 'ENDED' {
  if (day(mandate.startsOn) > today()) return 'TO_COME';
  return mandate.endsOn !== null && day(mandate.endsOn) < today() ? 'ENDED' : 'CURRENT';
}
export function currentOf<T extends { startsOn: Date; endsOn: Date | null }>(mandates: T[]): T | undefined {
  return mandates.find((mandate) => stateOf(mandate) === 'CURRENT');
}

function columns(identity: Identity) {
  return {
    name: identity.name,
    legalName: identity.legalName,
    sector: identity.sector || null,
    vatNumber: identity.vatNumber ? compact(identity.vatNumber) : null,
    address: identity.address,
    postalCode: identity.postalCode,
    city: identity.city,
    managerId: identity.managerId,
    portalEnabled: identity.portalEnabled,
  };
}
function mandateColumns({ startsOn, endsOn, ...terms }: MandateForm) {
  return { ...terms, startsOn: date(startsOn), endsOn: endsOn ? date(endsOn) : null };
}
function versionOf(mandate: MandateRow): MandateVersion {
  return {
    id: mandate.id,
    startsOn: day(mandate.startsOn),
    endsOn: mandate.endsOn ? day(mandate.endsOn) : null,
    amicableRateBp: mandate.amicableRateBp,
    litigationRateBp: mandate.litigationRateBp,
    openingFeeCents: mandate.openingFeeCents,
    planMonthsWithoutConsent: mandate.planMonthsWithoutConsent as 3 | 6 | 12,
    discountMaxBp: mandate.discountMaxBp,
    litigationNeedsConsent: mandate.litigationNeedsConsent,
    deferSmallRemittances: mandate.deferSmallRemittances,
    interestMode: mandate.interestMode,
    contractRateBp: mandate.contractRateBp,
    fixedIndemnity: mandate.fixedIndemnity,
    reportingDay: mandate.reportingDay,
    scenario: mandate.scenario,
    state: stateOf(mandate),
    hasContract: false,
  };
}
/** Card « Convention de mandat »; an officer reads what they need to act. */
function termsOf(mandate: MandateRow, short: boolean): { label: string; value: string }[] {
  const terms: [string, string][] = [
    ['Honoraires amiable', `${percent(mandate.amicableRateBp)} HT du recouvré`],
    ['Honoraires judiciaire', `${percent(mandate.litigationRateBp)} HT`],
    ...(mandate.openingFeeCents
      ? ([['Frais d’ouverture', `${(mandate.openingFeeCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € HT par dossier`]] as [
          string,
          string,
        ][])
      : []),
    ['Indemnité forfaitaire', mandate.fixedIndemnity ? '40 € / facture (professionnels)' : 'Non réclamée'],
    ['Échéancier sans accord', `≤ ${mandate.planMonthsWithoutConsent} mois`],
    ['Remise autorisée', `≤ ${percent(mandate.discountMaxBp)}`],
    ['Passage en contentieux', mandate.litigationNeedsConsent ? 'Sur accord écrit' : 'Sans accord écrit'],
    ['Reporting', `Mensuel, le ${mandate.reportingDay}`],
    ['Intérêts de retard', MANDATE_INTEREST_LABELS[mandate.interestMode]],
  ];
  return terms.slice(0, short ? 8 : undefined).map(([label, value]) => ({ label, value }));
}
