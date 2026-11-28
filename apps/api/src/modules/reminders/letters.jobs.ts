import { contactHours, formatCents, reminderAmount } from '@legarec/contracts';
import { sourceOf, TEMPLATE_CATALOGUE } from '@legarec/contracts/templateCatalogue';
import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRefused } from '../../emails/resend';
import type { MySendingBoxClient, PostalAddress } from '../../letters/mysendingbox';
import { postalOf, streetLinesOf } from '../../letters/postal';
import { Audit } from '../../platform/audit/audit';
import { databaseCode } from '../../platform/database/codes';
import type { Database, Transaction } from '../../platform/database/database';
import { dayOf } from '../../platform/format';
import { FirmIncomplete, PLACEHOLDER, type PdfRenderer } from '../../platform/pdf/pdf';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import { mayActOn, type JobDefinition, type Run } from '../../platform/queue/jobs';
import type { Storage } from '../../platform/storage/storage';
import { Ledgers, owedOf } from '../payments/ledger';
import { SettingValues } from '../settings/values';
import type { Vault } from '../vault/vault';
import { sendingDeadline, suspensionOf } from './contact-rules';
import { markFailed, sentNote } from './sendings.jobs';

interface Parts {
  database: Database;
  vault: Vault;
  storage: Storage;
  pdf: Pick<PdfRenderer, 'render'>;
  /** The folder `templates/pdf`, next to the sources as to the built programs. */
  templates: string;
  mysendingbox: MySendingBoxClient;
  /** The rights of the worker, for what fails before the author has passed the check of the task. */
  asWorker: Run;
  /** In production, a missing key makes the letter wait; elsewhere it is simulated and nothing leaves the machine. */
  production: boolean;
  /**
   * `MYSENDINGBOX_ENV=production`, said in so many words: the letters are posted with the `live_` key. Without it, only the
   * `test_` key is read, and MySendingBox posts nothing.
   */
  real: boolean;
  /** Where the address of the debtor's portal is read: never a personal link (question 112). */
  portal: string;
  now?: () => Date;
}

const id = (value: unknown): string => {
  if (typeof value !== 'string') throw new GiveUp('NO_IDENTIFIER');
  return value;
};
const money = (cents: number) => formatCents(cents, { decimals: 'always' });
const short = (value: Date | string) => {
  const iso = typeof value === 'string' ? value : value.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const long = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** The template of Paramètres › Modèles for each letter of the reminder form, and its level for the amounts (question 213). */
const LETTERS = {
  FRIENDLY: { code: 'amiable', level: 1, category: 'REMINDER_LETTER', title: 'Relance amiable' },
  FIRM: { code: 'ferme', level: 2, category: 'REMINDER_LETTER', title: 'Relance ferme' },
  FORMAL_NOTICE: { code: 'demeure', level: 3, category: 'FORMAL_NOTICE', title: 'Mise en demeure' },
} as const;
type LetterTemplate = keyof typeof LETTERS;
/** Days the debtor is given to pay from the day of the letter (« date limite »). */
const DEADLINE_DAYS = 8;
const portalLabel = (url: string) => url.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
/** A list that reads as its numbers in a sentence (`{{creance.factures}}`) and as its invoices in a loop. */
const listOf = <T extends { facture: { numero: string } }>(items: T[]) =>
  Object.defineProperty(items, 'toString', { value: () => items.map((item) => item.facture.numero).join(', '), enumerable: false });
/** The body of a full page: the source of a template is one, checked when it was imported (no script, nothing from elsewhere). */
const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/iu.exec(html)?.[1] ?? html;

type Facts = { refusal: string } | { refusal: undefined; to: PostalAddress; data: Record<string, unknown>; source: string; subject: string };

/** What the letter says, read with the rights of the colleague who asked: as the case stands when it leaves. */
async function factsOf(database: Database, tx: Transaction, caseId: string, template: LetterTemplate, today: string, portal: string): Promise<Facts> {
  const found = await tx.case.findFirst({
    where: { id: caseId, closedOn: null, anonymizedAt: null },
    select: {
      reference: true,
      status: true,
      firstLetterReference: true,
      firstLetterOn: true,
      debtorSiret: true,
      debtorAddress: true,
      debtorPostalCode: true,
      debtorCity: true,
      contactName: true,
      _count: { select: { plans: { where: { status: 'ACTIVE' } } } },
      officer: { select: { firstName: true, lastName: true } },
      creditor: { select: { name: true, legalName: true, address: true, postalCode: true, city: true, siren: true } },
      debtor: { select: { name: true } },
      contacts: {
        where: { kind: { in: ['EMAIL', 'PHONE'] }, status: { not: 'INVALID' } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { kind: true, value: true },
      },
      invoices: { select: { id: true, issuedOn: true } },
    },
  });
  if (!found) return { refusal: 'CASE_CLOSED' };
  const suspended = suspensionOf(found.status, found._count.plans);
  if (suspended) return { refusal: suspended };
  const { level, code } = LETTERS[template];
  if (level > 1 && (!found.firstLetterReference || !found.firstLetterOn)) return { refusal: 'NO_FIRST_LETTER' };
  const street = streetLinesOf(found.debtorAddress);
  if (!street || !found.debtorPostalCode || !found.debtorCity?.trim()) return { refusal: 'NO_ADDRESS' };
  const ledger = await new Ledgers(database, new Audit(database)).read(caseId, today);
  const unpaid = ledger?.invoices.filter((invoice) => invoice.principalLeft > 0) ?? [];
  if (!ledger || unpaid.length === 0) return { refusal: 'NOTHING_DUE' };
  const owed = owedOf(ledger);
  // As the e-mails of the same level: the indemnities from the firm letter on, interest in the formal notice only (question 213).
  const total = reminderAmount(level, owed);
  const paid = ledger.invoices.reduce((sum, invoice) => sum + invoice.principal - invoice.principalLeft, 0);
  const oldest = unpaid.reduce((first, invoice) => (invoice.dueOn < first ? invoice.dueOn : first), unpaid[0]!.dueOn);
  const issued = new Map(found.invoices.map((invoice) => [invoice.id, invoice.issuedOn]));
  const item = TEMPLATE_CATALOGUE.find((entry) => entry.id === code)!;
  // The version in service of Paramètres › Modèles, or the validated one of the catalogue.
  const published = await tx.templateVersion.findFirst({ where: { templateCode: code, state: 'PUBLISHED' }, select: { source: true } });
  const creditorAddress = [found.creditor.address, [found.creditor.postalCode, found.creditor.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const email = found.contacts.find((contact) => contact.kind === 'EMAIL')?.value ?? '';
  const phone = found.contacts.find((contact) => contact.kind === 'PHONE')?.value ?? '';
  return {
    refusal: undefined,
    to: { name: found.debtor.name, lines: street, postalCode: found.debtorPostalCode, city: found.debtorCity.trim() },
    source: published?.source ?? sourceOf(item),
    subject: (item.subject ?? item.name).replace(/\{([^{}\s]+)\}/gu, '{{$1}}'),
    data: {
      dossier: {
        reference: found.reference,
        gestionnaire: found.officer ? `${found.officer.firstName} ${found.officer.lastName}` : '',
        premier_courrier_reference: found.firstLetterReference ?? '',
        premier_courrier_date: found.firstLetterOn ? long(found.firstLetterOn.toISOString().slice(0, 10)) : '',
      },
      debiteur: {
        raison_sociale: found.debtor.name,
        adresse: [...street, `${found.debtorPostalCode} ${found.debtorCity.trim()}`].join(', '),
        siret: found.debtorSiret ?? '',
        contact: found.contactName ?? '',
        email,
        telephone: phone,
      },
      creance: {
        principal: money(owed.principal),
        interets: money(owed.interest),
        indemnites: money(owed.fees),
        frais: money(0),
        total: money(total),
        deja_paye: money(paid),
        anciennete: `${Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${oldest}T12:00:00Z`)) / 86_400_000))} jours`,
        factures: listOf(
          unpaid.map((invoice) => ({
            facture: {
              numero: invoice.number,
              date: short(issued.get(invoice.id) ?? invoice.dueOn),
              echeance: short(invoice.dueOn),
              montant: money(invoice.principalLeft),
            },
          })),
        ),
      },
      creancier: { nom: found.creditor.legalName ?? found.creditor.name, adresse: creditorAddress, siren: found.creditor.siren ?? '' },
      date: { jour: long(today), limite: long(plusDays(today, DEADLINE_DAYS)) },
      paiement: { lien: portalLabel(portal) },
    },
  };
}

/**
 * Posts the registered letters a request has written in `sendings` (question 210), in the queue of the reminders: one try.
 * The PDF is written and kept in the case before anything leaves, and the line is taken (« uncertain ») with it, once.
 * Then MySendingBox says what happened: accepted, refused (nothing left), or nothing clear, and the line stays uncertain
 * until a person decides. A letter posted for real, and the first of its case, becomes its first letter (`LR-AAAA-NNNN`):
 * the e-mail reminders and the portal of the debtor open with it. The test key never makes one.
 */
export function letterJobs({ database, vault, storage, pdf, templates, mysendingbox, asWorker, production, real, portal, now = () => new Date() }: Parts) {
  const engine = Handlebars.create();
  for (const name of ['en_tete', 'mentions_recouvrement']) engine.registerPartial(name, readFileSync(join(templates, 'letter', `${name}.hbs`), 'utf8'));
  const layout = engine.compile(readFileSync(join(templates, 'letter.hbs'), 'utf8'), { strict: true });
  const fail = async (asApplication: Run, sending: string, caseId: string, failure: string, from: 'QUEUED' | 'UNCERTAIN' = 'QUEUED'): Promise<never> => {
    throw new GiveUp((await markFailed(asApplication, sending, caseId, failure, from)).code);
  };

  const job: JobDefinition = {
    from: ['STAFF'],
    repeatable: false,
    run: async ({ payload, asAuthor, authorize }) => {
      const sending = id(payload.sending);
      const caseId = id(payload.case);
      let asApplication: Run;
      try {
        asApplication = await authorize(mayActOn(caseId));
      } catch (error) {
        if (error instanceof GiveUp) return fail(asWorker, sending, caseId, error.code);
        throw error;
      }
      const line = await asApplication((tx) =>
        tx.sending.findFirst({ where: { id: sending, caseId }, select: { status: true, channel: true, template: true, creditorId: true, createdAt: true } }),
      );
      if (!line) throw new GiveUp('UNKNOWN_SENDING');
      if (line.status !== 'QUEUED') return;
      if (line.channel !== 'REGISTERED_LETTER' || !(line.template in LETTERS)) return fail(asApplication, sending, caseId, 'NOT_AVAILABLE');
      const template = line.template as LetterTemplate;
      const settings = await asApplication((tx) => SettingValues.read(tx));
      const hours = contactHours((field) => settings.text('firm', 'relances', field));
      const moment = now();
      // One that has waited too long never leaves (a key, a value of the firm).
      if (moment >= sendingDeadline(line.createdAt, hours)) return fail(asApplication, sending, caseId, 'EXPIRED');
      const today = dayOf(moment);
      const facts = await asAuthor((tx) => factsOf(database, tx, caseId, template, today, portal));
      if (facts.refusal !== undefined) return fail(asApplication, sending, caseId, facts.refusal);
      const firmText = (field: string) => settings.text('firm', 'cabinet', field);
      const firmPostal = postalOf(firmText('address'));
      // A value of the firm still between brackets, or an address the post cannot read: it waits for the Director.
      if (
        !firmPostal ||
        ['name', 'address', 'phone', 'siren', 'iban', 'holder', 'chequePayee', 'chequeAddress'].some((field) => PLACEHOLDER.test(firmText(field)))
      )
        throw new TryLater('FIRM_INCOMPLETE');
      const data = {
        ...facts.data,
        cabinet: {
          nom: firmText('name'),
          adresse: firmText('address'),
          telephone: firmText('phone'),
          email: firmText('email'),
          siren: firmText('siren'),
          tva: firmText('vat'),
          titulaire: firmText('holder'),
          ordre_cheques: firmText('chequePayee'),
          adresse_cheques: firmText('chequeAddress'),
        },
        paiement: { ...(facts.data.paiement as object), iban: firmText('iban') },
      };
      let html: string;
      try {
        const subject = engine.compile(facts.subject, { strict: true, noEscape: true })(data);
        const letter = engine.compile(facts.source, { strict: true })({
          ...data,
          lettre: {
            objet: subject,
            mode: 'Lettre recommandée avec accusé de réception',
            adresse: [...facts.to.lines, `${facts.to.postalCode} ${facts.to.city}`],
          },
        });
        html = layout({ content: bodyOf(letter), lettre: { objet: subject } });
      } catch {
        // What the template refuses may quote the debtor: only a code stays.
        return fail(asApplication, sending, caseId, 'UNREADABLE_MESSAGE');
      }
      let bytes: Buffer;
      try {
        bytes = await pdf.render(html);
      } catch (error) {
        if (error instanceof FirmIncomplete) throw new TryLater('FIRM_INCOMPLETE');
        throw error;
      }
      const name = real ? 'MYSENDINGBOX_API_KEY' : 'MYSENDINGBOX_TEST_API_KEY';
      const [stored] = await asApplication(
        (tx) => tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.service_key(${name})`,
      );
      const key = stored?.id && stored.value_cipher ? vault.open(stored.id, stored.value_cipher) : null;
      if (!key && production) throw new TryLater('NO_KEY');
      // Outside `MYSENDINGBOX_ENV=production`, only a key that posts nothing.
      if (key && !real && !key.startsWith('test_')) return fail(asApplication, sending, caseId, 'TEST_KEY_REQUIRED');
      // The letter is kept in the case with the line it belongs to, which is taken at the same moment: a second run sends nothing.
      const file = await storage.put(bytes);
      const { title, category } = LETTERS[template];
      try {
        await asApplication(async (tx) => {
          const document = await tx.document.create({
            data: {
              caseId,
              creditorId: line.creditorId,
              category,
              kind: 'PDF',
              title: `${title} (recommandé)`,
              originalName: `courrier-${today}.pdf`,
              storageKey: file.key,
              sizeBytes: file.size,
              sha256: file.sha256,
              source: 'GENERATED',
              scanStatus: 'CLEAN',
              scannedAt: new Date(),
            },
            select: { id: true },
          });
          const { count } = await tx.sending.updateMany({ where: { id: sending, status: 'QUEUED' }, data: { status: 'UNCERTAIN', documentId: document.id } });
          if (count !== 1) throw new GiveUp('ALREADY_TAKEN');
        });
      } catch (error) {
        await storage.remove(file.key);
        if (error instanceof GiveUp && error.code === 'ALREADY_TAKEN') return;
        throw error;
      }
      const sent = async (change: { simulated?: boolean; providerRef?: string }, first: boolean) => {
        const { count } = await asApplication(async (tx) => {
          const changed = await tx.sending.updateMany({ where: { id: sending, status: 'UNCERTAIN' }, data: { status: 'SENT', sentAt: new Date(), ...change } });
          // The first letter of the case, once: under the lock of the case, so that two letters never both take a number.
          if (changed.count && first) {
            const [open] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cases WHERE id = ${caseId}::uuid AND first_letter_on IS NULL FOR UPDATE`;
            if (open) {
              const [numbered] = await tx.$queryRaw<{ for_year: number; number: number }[]>`SELECT * FROM app.next_number('FIRST_LETTER')`;
              await tx.case.updateMany({
                where: { id: caseId, firstLetterOn: null },
                data: {
                  firstLetterReference: `LR-${numbered!.for_year}-${String(numbered!.number).padStart(4, '0')}`,
                  firstLetterOn: new Date(`${today}T00:00:00Z`),
                },
              });
            }
          }
          return changed;
        });
        if (!count) return;
        const note = sentNote(caseId, { channel: 'REGISTERED_LETTER', template, level: null });
        await asAuthor(note).catch((error: unknown) => {
          if (databaseCode(error) !== '42501') throw error;
          return asApplication(note);
        });
      };
      if (!key) return sent({ simulated: true }, false);
      let answer: { ref: string; test: boolean };
      try {
        answer = await mysendingbox.send(
          key,
          { pdf: bytes, to: facts.to, from: { name: firmText('name'), ...firmPostal }, postage: 'lrar', sending },
          `sending/${sending}`,
        );
      } catch (error) {
        if (error instanceof ProviderRefused) return fail(asApplication, sending, caseId, error.code, 'UNCERTAIN');
        // Nothing clear came back: the line stays uncertain, and so does its task.
        throw new GiveUp('UNCERTAIN');
      }
      // A letter of the test mode is rendered, never posted: it opens nothing.
      await sent({ providerRef: answer.ref, ...(answer.test ? { simulated: true } : {}) }, real && !answer.test);
    },
  };
  return { 'case-letter': job };
}
