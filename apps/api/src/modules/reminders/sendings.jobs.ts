import { contactHours, formatCents, type AutomaticEmail } from '@legarec/contracts';
import type { AutomaticMessage, EmailsService } from '../../emails/emails.service';
import { allowedOutsideProduction, ProviderRefused, type ResendClient } from '../../emails/resend';
import { Audit } from '../../platform/audit/audit';
import { Keyring } from '../../platform/crypto/keyring';
import type { Database, Transaction } from '../../platform/database/database';
import { dayOf, timeOf } from '../../platform/format';
import { PLACEHOLDER } from '../../platform/pdf/pdf';
import { GiveUp, TryLater } from '../../platform/queue/errors';
import { mayActOn, type JobDefinition, type Run } from '../../platform/queue/jobs';
import { bindingOf } from '../debtor-access/access-codes';
import { Ledgers, owedOf } from '../payments/ledger';
import { SettingValues } from '../settings/values';
import { keysIn } from '../vault/internal-keys';
import type { Vault } from '../vault/vault';

interface Parts {
  database: Database;
  vault: Vault;
  emails: Pick<EmailsService, 'compose'>;
  resend: ResendClient;
  /** In production, a missing key makes the sending wait; elsewhere it is simulated and nothing leaves the machine. */
  production: boolean;
  /** Addresses of the firm a test key may write to, outside production. */
  devRecipients: readonly string[];
  /** What a simulated sending does with the message (a private folder in development, nothing in the tests). */
  simulate(message: AutomaticMessage): Promise<void>;
  /** The hour it is; set by the tests, which run at any hour. */
  now?: () => Date;
}
const id = (value: unknown): string => {
  if (typeof value !== 'string') throw new GiveUp('NO_IDENTIFIER');
  return value;
};
const day = (value: string | Date) => {
  const iso = typeof value === 'string' ? value : value.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
const money = (cents: number) => formatCents(cents, { decimals: 'always' });
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

/** What the reminder says, read with the rights of the colleague who sent it. Null: the case no longer allows it. */
async function factsOf(database: Database, vault: Vault, tx: Transaction, caseId: string, contactId: string, level: number) {
  const found = await tx.case.findFirst({
    where: { id: caseId, closedOn: null, anonymizedAt: null },
    select: {
      reference: true,
      contactName: true,
      creditor: { select: { name: true } },
      debtor: { select: { name: true, siren: true, kind: true } },
      contacts: { where: { id: contactId, kind: 'EMAIL', status: { not: 'INVALID' } }, select: { value: true, status: true } },
      invoices: { select: { id: true, issuedOn: true } },
    },
  });
  const contact = found?.contacts[0];
  if (!found || !contact) return { refusal: found ? 'NO_EMAIL' : 'CASE_CLOSED' } as const;
  if (found.debtor.kind === 'INDIVIDUAL' || !found.debtor.siren) return { refusal: 'INDIVIDUAL' } as const;
  const ledger = await new Ledgers(database, new Audit(database)).read(caseId, dayOf(new Date()));
  const unpaid = ledger?.invoices.filter((invoice) => invoice.principalLeft > 0) ?? [];
  if (!ledger || unpaid.length === 0) return { refusal: 'NOTHING_DUE' } as const;
  const owed = owedOf(ledger);
  // As the letters of the same name (`letterAmount`): the indemnities from the firm reminder on, interest in the last one only (question 213).
  const total = owed.principal + (level >= 2 ? owed.fees : 0) + (level >= 3 ? owed.interest : 0);
  // The code only goes to an address a colleague has confirmed (question 112); otherwise the message leaves without it.
  let code: string | undefined;
  if (contact.status === 'VERIFIED') {
    const [row] = await tx.$queryRaw<{ debtor_id: string; code_cipher: Uint8Array }[]>`SELECT debtor_id, code_cipher FROM app.access_code(${caseId}::uuid)`;
    if (row) {
      const [current, ...previous] = await keysIn(tx, vault, 'ACCESS_CODE_KEY');
      try {
        code = new Keyring(current!, previous).decrypt(row.code_cipher, bindingOf(row.debtor_id)).toString();
      } catch {
        code = undefined;
      }
    }
  }
  const issued = new Map(found.invoices.map((invoice) => [invoice.id, invoice.issuedOn]));
  return {
    refusal: undefined,
    to: contact.value,
    data: {
      case: { reference: found.reference, total_due: money(total), ...(code ? { access_code: code } : {}) },
      creditor: { name: found.creditor.name },
      debtor: { company_name: found.debtor.name, siren: found.debtor.siren, ...(found.contactName ? { contact_name: found.contactName } : {}) },
      invoices: unpaid.map((invoice) => ({
        number: invoice.number,
        issue_date: day(issued.get(invoice.id) ?? invoice.dueOn),
        due_date: day(invoice.dueOn),
        principal: money(invoice.principal),
        total: money(invoice.principalLeft),
      })),
    },
  };
}

/**
 * Sends what a request has written in `sendings`. Before anything leaves, the line passes from « queued » to « uncertain »,
 * once: a task delivered twice, or started again after a cut, finds it taken and sends nothing. Then the provider says what
 * happened: sent, refused (nothing left), or nothing clear, and the line stays uncertain until a person decides.
 */
export function sendingJobs({ database, vault, emails, resend, production, devRecipients, simulate, now = () => new Date() }: Parts): Record<string, JobDefinition> {
  const settle = (asApplication: Run, sending: string, data: { status: 'SENT' | 'FAILED'; simulated?: boolean; providerRef?: string; failure?: string }) =>
    asApplication((tx) =>
      tx.sending.updateMany({
        where: { id: sending, status: { in: ['QUEUED', 'UNCERTAIN'] } },
        data: { ...data, ...(data.status === 'SENT' ? { sentAt: new Date() } : {}) },
      }),
    );
  /** Refused before anything left: said in the history of the case, without a word of why beyond a code. */
  const fail = async (asApplication: Run, sending: string, caseId: string, failure: string): Promise<never> => {
    const code = CODE.test(failure) ? failure : 'SENDING_FAILED';
    await asApplication(async (tx) => {
      const { count } = await tx.sending.updateMany({ where: { id: sending, status: { in: ['QUEUED', 'UNCERTAIN'] } }, data: { status: 'FAILED', failure: code } });
      // An anonymized case takes no more history.
      if (count)
        await tx.$executeRaw`SELECT app.add_case_event(${caseId}::uuid, 'REMINDER_FAILED', 'Relance non envoyée', NULL, 'danger'::event_tone, false) WHERE app.case_writable(${caseId}::uuid)`;
    });
    throw new GiveUp(code);
  };

  return {
    'case-reminder': {
      from: ['STAFF'],
      // It reaches a debtor: one try, and the line itself is taken before the provider is called.
      repeatable: false,
      run: async ({ payload, asAuthor, authorize }) => {
        const sending = id(payload.sending);
        const caseId = id(payload.case);
        const asApplication = await authorize(mayActOn(caseId));
        const line = await asApplication((tx) =>
          tx.sending.findFirst({ where: { id: sending, caseId }, select: { status: true, channel: true, level: true, contactId: true } }),
        );
        if (!line) throw new GiveUp('UNKNOWN_SENDING');
        // Already taken by another delivery: whatever happened to it, nothing more leaves from here.
        if (line.status !== 'QUEUED') return;
        if (line.channel !== 'EMAIL' || !line.level || !line.contactId) return fail(asApplication, sending, caseId, 'NOT_AVAILABLE');
        const { level, contactId } = line;
        const facts = await asAuthor((tx) => factsOf(database, vault, tx, caseId, contactId, level));
        if (facts.refusal !== undefined) return fail(asApplication, sending, caseId, facts.refusal);
        let message: AutomaticMessage;
        try {
          message = await emails.compose(`reminder-${level}` as AutomaticEmail, facts.to, facts.data);
        } catch {
          // What the template refuses may quote the debtor: only a code stays.
          return fail(asApplication, sending, caseId, 'UNREADABLE_MESSAGE');
        }
        // One that has waited (a key, a value of the firm) never leaves at night, on a Sunday nor on a public holiday (question 161).
        const settings = await asApplication((tx) => SettingValues.read(tx));
        const moment = now();
        if (contactHours((field) => settings.text('firm', 'relances', field)).outsideHours('EMAIL', dayOf(moment), timeOf(moment)))
          throw new TryLater('OUTSIDE_HOURS');
        // A value of the firm still between brackets: it waits until the Director has typed it.
        if (PLACEHOLDER.test(message.html.replace(/<[^>]+>/gu, ' '))) throw new TryLater('FIRM_INCOMPLETE');
        const [stored] = await asApplication(
          (tx) => tx.$queryRaw<{ id: string | null; value_cipher: Uint8Array | null }[]>`SELECT * FROM app.service_key('RESEND_API_KEY')`,
        );
        const key = stored?.id && stored.value_cipher ? vault.open(stored.id, stored.value_cipher) : null;
        if (!key && production) throw new TryLater('NO_KEY');
        if (key && !production && !allowedOutsideProduction(facts.to, devRecipients)) return fail(asApplication, sending, caseId, 'DEV_RECIPIENT');
        // From here on, a second run sends nothing.
        const taken = await asApplication((tx) => tx.sending.updateMany({ where: { id: sending, status: 'QUEUED' }, data: { status: 'UNCERTAIN' } }));
        if (taken.count !== 1) return;
        if (!key) {
          await simulate(message);
          await settle(asApplication, sending, { status: 'SENT', simulated: true });
          return;
        }
        let ref: string;
        try {
          ({ ref } = await resend.send(key, message, `sending/${sending}`));
        } catch (error) {
          if (error instanceof ProviderRefused) return fail(asApplication, sending, caseId, error.code);
          // Nothing clear came back: the line stays uncertain, and so does its task.
          throw new GiveUp('UNCERTAIN');
        }
        await settle(asApplication, sending, { status: 'SENT', providerRef: ref });
      },
    },
  };
}
