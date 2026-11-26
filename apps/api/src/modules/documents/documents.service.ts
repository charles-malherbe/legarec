import { DOCUMENT_CATEGORIES, type DocumentCategory, type DocumentItem, type documentsData } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { Audit } from '../../platform/audit/audit';
import { Database } from '../../platform/database/database';
import { ApiError, conflict, forbidden, notFound } from '../../platform/errors/api-error';
import { dayOf } from '../../platform/format';
import { Outbox } from '../../platform/queue/outbox';
import { Storage } from '../../platform/storage/storage';
import { checkFile, CONTENT_TYPES, readableText, type FileKind } from './file-type';

const SHOWN = 500;
const EXTENSIONS: Record<FileKind, string> = { PDF: 'pdf', DOCX: 'docx', PNG: 'png', JPEG: 'jpg' };
export const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 ** 2).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
      : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
/** A number of an invoice written in the file, as a word of it; too short or without a digit, it proves nothing. */
const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ');
const telling = (number: string) => /\d/u.test(number) && number.replace(/[^A-Za-z0-9]/gu, '').length >= 6;
const written = (content: string, number: string) => telling(number) && content.includes(` ${plain(number).trim()} `);
/** Read for the invoice numbers: the first 2 Mo of the text. */
const READ_FOR_NUMBERS = 2 * 1024 * 1024;

interface Shown {
  status: string;
  tone: DocumentItem['tone'];
}
const stateOf = (row: { scanStatus: string; caseId: string | null; sharedWithCreditorAt: Date | null }): Shown =>
  row.scanStatus === 'PENDING'
    ? { status: 'Analyse en cours', tone: 'warning' }
    : row.scanStatus !== 'CLEAN'
      ? { status: 'Bloqué par l’antivirus', tone: 'warning' }
      : !row.caseId
        ? { status: 'À classer', tone: 'neutral' }
        : row.sharedWithCreditorAt
          ? { status: 'Partagé au créancier', tone: 'marine' }
          : { status: 'Reçu', tone: 'info' };

/** Documents of the cases. PostgreSQL decides which ones are shown; a file is read only once ClamAV found it clean. */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  async list(): Promise<z.infer<typeof documentsData>> {
    const { tx } = this.database;
    const rows = await tx.document.findMany({
      orderBy: { createdAt: 'desc' },
      take: SHOWN,
      select: {
        id: true,
        caseId: true,
        creditorId: true,
        category: true,
        kind: true,
        title: true,
        originalName: true,
        sizeBytes: true,
        scanStatus: true,
        sharedWithCreditorAt: true,
        createdAt: true,
        source: true,
        author: { select: { firstName: true, lastName: true } },
        case: { select: { debtor: { select: { name: true } }, creditor: { select: { name: true } } } },
      },
    });
    const [totals] = await tx.$queryRaw<{ count: bigint; size: bigint | null }[]>`SELECT count(*) AS count, sum(size_bytes) AS size FROM documents`;
    const counts = await tx.document.groupBy({ by: ['category'], _count: { _all: true } });
    return {
      items: rows.map((row) => ({
        id: row.id,
        category: row.category,
        name: row.originalName,
        title: row.title,
        debtor: row.case?.debtor.name ?? '—',
        caseId: row.caseId,
        creditorId: row.creditorId ?? '',
        creditor: row.case?.creditor.name ?? '—',
        date: dayOf(row.createdAt),
        size: sizeText(row.sizeBytes),
        kind: row.kind,
        ...stateOf(row),
        tracking: '—',
        author: row.author ? `${row.author.firstName} ${row.author.lastName}` : 'Automatique',
      })),
      total: Number(totals?.count ?? 0),
      size: sizeText(Number(totals?.size ?? 0)),
      counts: Object.fromEntries(
        (Object.keys(DOCUMENT_CATEGORIES) as DocumentCategory[]).map((category) => [
          category,
          counts.find((item) => item.category === category)?._count._all ?? 0,
        ]),
      ) as Record<DocumentCategory, number>,
    };
  }

  /**
   * A file received by a colleague: its real type is that announced, then it waits for ClamAV. It goes with the case whose
   * invoice number it carries, among the cases this person acts on; otherwise it is to be filed. Its name never left the
   * browser: it gets one of its own.
   */
  async import(bytes: Uint8Array, declared: string): Promise<{ id: string; status: 'ATTACHED' | 'TO_FILE' }> {
    const { tx } = this.database;
    const kind = checkFile(bytes, declared);
    if (!kind) throw new ApiError(415, 'REFUSED');
    const name = `Document importé le ${dayOf(new Date()).split('-').reverse().join('/')}.${EXTENSIONS[kind]}`;
    const content = ` ${plain(readableText(bytes, kind).slice(0, READ_FOR_NUMBERS))} `;
    const invoices = await tx.$queryRaw<{ case_id: string; creditor_id: string; number: string }[]>`
      SELECT i.case_id, i.creditor_id, i.number FROM case_invoices i JOIN cases c ON c.id = i.case_id
      WHERE app.can_act_on_case(c.officer_id) AND c.closed_on IS NULL`;
    const cases = [...new Map(invoices.filter((invoice) => written(content, invoice.number)).map((invoice) => [invoice.case_id, invoice])).values()];
    const target = cases.length === 1 ? cases[0]! : null;
    const stored = await this.storage.put(bytes);
    try {
      const [who] = await tx.$queryRaw<{ user_id: string }[]>`SELECT app.user_id() AS user_id`;
      const document = await tx.document.create({
        data: {
          caseId: target?.case_id ?? null,
          creditorId: target?.creditor_id ?? null,
          category: target ? 'INVOICE' : 'EVIDENCE',
          kind,
          title: 'Document importé',
          originalName: name,
          storageKey: stored.key,
          sizeBytes: stored.size,
          sha256: stored.sha256,
          source: 'UPLOAD',
          authorId: who!.user_id,
        },
        select: { id: true },
      });
      await this.outbox.add({ queue: 'documents', name: 'scan-document', payload: { document: document.id } });
      await this.audit.log({ action: target ? 'DOCUMENT_ATTACHED' : 'DOCUMENT_TO_FILE', entity: { type: 'document', id: document.id } });
      if (target)
        await tx.$executeRaw`SELECT app.add_case_event(${target.case_id}::uuid, 'DOCUMENT_ADDED', 'Document ajouté', ${name}, 'info'::event_tone, false)`;
      return { id: document.id, status: target ? 'ATTACHED' : 'TO_FILE' };
    } catch (error) {
      // Nothing written: the file goes too.
      await this.storage.remove(stored.key);
      throw error;
    }
  }

  /** Shown to the creditor: attached to a case one acts on, clean, without the access code (question 118). */
  async share(id: string): Promise<void> {
    const { tx } = this.database;
    const [row] = await tx.$queryRaw<{ case_id: string | null; scan_status: string; contains_access_code: boolean; shared: boolean; can_act: boolean }[]>`
      SELECT d.case_id, d.scan_status, d.contains_access_code, d.shared_with_creditor_at IS NOT NULL AS shared,
        coalesce((SELECT app.can_act_on_case(c.officer_id) FROM cases c WHERE c.id = d.case_id), false) AS can_act
      FROM documents d WHERE d.id = ${id}::uuid`;
    if (!row) throw notFound();
    if (!row.case_id) throw conflict('TO_FILE');
    if (!row.can_act) throw forbidden();
    if (row.scan_status !== 'CLEAN') throw conflict('NOT_SCANNED');
    if (row.contains_access_code) throw conflict('CONTAINS_ACCESS_CODE');
    if (row.shared) return;
    // In one's own name, with its history and its audit: PostgreSQL does it, and checks everything again.
    await tx.$executeRaw`SELECT app.share_document(${id}::uuid)`;
  }

  /** The file, once clean, under a neutral name: never the one it was sent with (CLAUDE.md). */
  async file(id: string): Promise<{ bytes: Buffer; type: string; name: string }> {
    const { tx } = this.database;
    const found = await tx.document.findUnique({ where: { id }, select: { storageKey: true, kind: true, scanStatus: true, caseId: true } });
    if (!found) throw notFound();
    if (found.scanStatus !== 'CLEAN') throw conflict('NOT_SCANNED');
    // Read by someone who does not act on its case (the Director, the manager for one to file): noted.
    const [acting] = await tx.$queryRaw<{ acts: boolean }[]>`
      SELECT coalesce((SELECT app.can_act_on_case(c.officer_id) FROM cases c WHERE c.id = ${found.caseId}::uuid), false) AS acts`;
    if (!acting?.acts) await this.audit.log({ action: 'DOCUMENT_DOWNLOADED', entity: { type: 'document', id } });
    return { bytes: await this.storage.read(found.storageKey), type: CONTENT_TYPES[found.kind], name: `document.${EXTENSIONS[found.kind]}` };
  }
}
