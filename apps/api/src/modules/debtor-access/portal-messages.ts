import type { ATTACHMENT_KINDS } from '@legarec/contracts';
import { formatCents, type DebtorRequest, type debtorMessages } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { deriveKey, Keyring } from '../../platform/crypto/keyring';
import { Database } from '../../platform/database/database';
import { ApiError, conflict, notFound } from '../../platform/errors/api-error';
import { Outbox } from '../../platform/queue/outbox';
import { Storage } from '../../platform/storage/storage';
import { checkFile } from '../documents/file-type';
import { Vault } from '../vault/vault';
import { bindingOf } from './access-codes';

const when = (value: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' })
    .format(value)
    .replace(' ', ' à ');
const day = (iso: string) => iso.split('-').reverse().join('/');
const MASK = '••••';

/**
 * The code of a debtor taken out of a text, however it was written: in any case, its letters apart or joined by spaces,
 * dots or dashes. A word that only contains it (« ABCDE ») stays.
 */
export function withoutCode(text: string, code: string | null): string {
  if (!code || !/^[A-Z]{4}$/u.test(code)) return text;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${[...code].join('[\\s.\\-_·]*')}(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(pattern, MASK);
}

/** The words of a guided request, as the team reads them. */
function requestText(request: DebtorRequest): { text: string; facts: Record<string, string | number> } {
  switch (request.kind) {
    case 'PLAN':
      return { text: `Demande d’échéancier en ${request.months} mensualités.${request.note ? `\n\n${request.note}` : ''}`, facts: { months: request.months } };
    case 'DISPUTE':
      return { text: `Contestation : ${request.reason}.\n\n${request.text}`, facts: {} };
    case 'ALREADY_PAID':
      return {
        text: `Paiement déjà effectué le ${day(request.paidOn)} : ${formatCents(request.amount, { decimals: 'always' })} par ${request.method === 'CHEQUE' ? 'chèque' : 'virement'}.`,
        facts: { paidOn: request.paidOn, amount: request.amount, method: request.method },
      };
    case 'CALLBACK':
      return { text: `Demande de rappel au ${request.phone}, ${request.slot === 'MORNING' ? 'le matin' : 'l’après-midi'}.`, facts: { slot: request.slot } };
  }
}

/** Messages of the space of the debtor. PostgreSQL decides who reads and writes what: here, the words and the files. */
@Injectable()
export class PortalMessages {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Vault) private readonly vault: Vault,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  /** The code of the debtor signed in, to take it out of what they write; null if no key opens it. */
  private async ownCode(): Promise<string | null> {
    const [row] = await this.database.tx.$queryRaw<{ debtor_id: string; code_cipher: Uint8Array; key_id: string | null; key_cipher: Uint8Array | null }[]>`
      SELECT * FROM app.own_access_code()`;
    if (!row?.key_id || !row.key_cipher) return null;
    try {
      const keys = (JSON.parse(this.vault.open(row.key_id, row.key_cipher)) as string[]).map((value) =>
        deriveKey(Buffer.from(value, 'base64'), 'ACCESS_CODE_KEY'),
      );
      return new Keyring(keys[0]!, keys.slice(1)).decrypt(Buffer.from(row.code_cipher), bindingOf(row.debtor_id)).toString();
    } catch {
      return null;
    }
  }

  async list(caseId: string): Promise<z.infer<typeof debtorMessages>> {
    const { tx } = this.database;
    if (!(await tx.case.count({ where: { id: caseId, closedOn: null } }))) throw notFound();
    const rows = await tx.portalMessage.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        side: true,
        text: true,
        createdAt: true,
        readByStaffAt: true,
        attachments: { select: { document: { select: { id: true, originalName: true } } } },
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        mine: row.side === 'DEBTOR',
        who: row.side === 'DEBTOR' ? 'Vous' : 'Legarec',
        when: when(row.createdAt),
        text: row.text,
        attachments: row.attachments.map(({ document }) => ({ id: document.id, name: document.originalName })),
        receipt:
          row.side === 'DEBTOR' ? (row.readByStaffAt ? `Lu par Legarec le ${when(row.readByStaffAt)}` : `Reçu par Legarec le ${when(row.createdAt)}`) : null,
      })),
    };
  }

  async write(caseId: string, text: string, kind: keyof typeof ATTACHMENT_KINDS, files: { id: string }[]): Promise<void> {
    const code = await this.ownCode();
    const clean = withoutCode(text, code);
    const facts = files.length ? { attachmentKind: kind } : null;
    await this.database.tx
      .$queryRaw`SELECT app.debtor_message(${caseId}::uuid, ${clean}, ${files.map((file) => file.id)}::uuid[], NULL, ${facts ? JSON.stringify(facts) : null}::jsonb)`;
  }

  async request(caseId: string, request: DebtorRequest): Promise<void> {
    const code = await this.ownCode();
    const { text, facts } = requestText(request);
    const files = 'attachments' in request ? request.attachments.map((file) => file.id) : [];
    await this.database.tx
      .$queryRaw`SELECT app.debtor_message(${caseId}::uuid, ${withoutCode(text, code)}, ${files}::uuid[], ${request.kind}::debtor_request_kind,
      ${JSON.stringify(facts)}::jsonb)`;
  }

  async read(caseId: string): Promise<void> {
    // A case that is not shown does not exist.
    if (!(await this.database.tx.case.count({ where: { id: caseId } }))) throw notFound();
    await this.database.tx.$executeRaw`SELECT app.read_portal_messages(${caseId}::uuid)`;
  }

  /** A file of the debtor: real type checked, kept until their message takes it, analysed before anyone reads it. */
  async upload(bytes: Uint8Array, declared: string): Promise<{ id: string }> {
    const kind = checkFile(bytes, declared);
    if (!kind) throw new ApiError(415, 'REFUSED');
    const stored = await this.storage.put(bytes);
    const id = randomUUID();
    try {
      await this.database.tx
        .$executeRaw`SELECT app.debtor_upload(${id}::uuid, ${kind}::document_kind, ${stored.key}, ${stored.size}::integer, ${stored.sha256})`;
      await this.outbox.add({ queue: 'documents', name: 'scan-document', payload: { document: id } });
    } catch (error) {
      await this.storage.remove(stored.key);
      if (error instanceof ApiError && error.status === 409) throw conflict('TOO_MANY_FILES');
      throw error;
    }
    return { id };
  }

  /** An answer of whoever acts on the case. */
  async answer(caseId: string, text: string): Promise<void> {
    if (!(await this.database.tx.case.count({ where: { id: caseId } }))) throw notFound();
    await this.database.tx.$queryRaw`SELECT app.staff_message(${caseId}::uuid, ${text})`;
  }
}
