import { isValidSiret, newClaim, parseCents, type ImportReport, type importDone } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { readSheet } from 'read-excel-file/node';
import type { z } from 'zod';
import { Database } from '../../platform/database/database';
import { RateLimits } from '../../platform/limits/rate-limits';
import { ApiError, notFound } from '../../platform/errors/api-error';
import { withinZipLimits } from './zip-limits';

type Cell = string | number | boolean | Date | null | undefined;
type Claim = z.infer<typeof newClaim>;
/** The columns of the model the portal gives (`modele-depot-creances.csv`). */
const COLUMNS = ['debiteur', 'siret', 'email', 'telephone', 'adresse', 'numero_facture', 'date_emission', 'date_echeance', 'montant_ttc'] as const;
const LINES_MAX = 5000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv']);

/** One line of CSV after another, quotes and doubled quotes understood; `;` or `,`, whichever the first line uses. */
export function csvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/u, '');
  const firstLine = clean.split(/\r?\n/u, 1)[0] ?? '';
  const separator = (firstLine.match(/;/gu)?.length ?? 0) >= (firstLine.match(/,/gu)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]!;
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > LINES_MAX + 1) break;
    } else cell += char;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

const text = (cell: Cell) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === null || cell === undefined ? '' : String(cell)).trim();
/** `31/12/2026`, `2026-12-31` or a date of Excel. */
function dayOf(cell: Cell): string | null {
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10);
  const value = text(cell);
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const [year, month, day] = french ? [french[3], french[2], french[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!year) return null;
  const date = `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : null;
}
const amountOf = (cell: Cell) => (typeof cell === 'number' ? Math.round(cell * 100) : parseCents(text(cell)));

/** Each line read and checked; the claims of one debtor go together, as one deposit. */
export function readClaims(rows: Cell[][]): { lines: number; claims: Claim[]; errors: ImportReport['errors'] } {
  const [header = [], ...body] = rows;
  const names = header.map((cell) => text(cell).toLowerCase());
  const at = (row: Cell[], column: (typeof COLUMNS)[number]) => row[names.indexOf(column)];
  const errors: ImportReport['errors'] = [];
  const missing = COLUMNS.filter((column) => !names.includes(column));
  if (missing.length) return { lines: 0, claims: [], errors: [{ line: 1, message: `Colonnes manquantes : ${missing.join(', ')}` }] };
  const lines = body.filter((row) => row.some((cell) => text(cell) !== ''));
  if (lines.length > LINES_MAX)
    return { lines: lines.length, claims: [], errors: [{ line: 1, message: `Plus de ${LINES_MAX} lignes : découpez le fichier.` }] };
  const groups = new Map<string, Claim>();
  body.forEach((row, index) => {
    const line = index + 2;
    if (!row.some((cell) => text(cell) !== '')) return;
    const number = text(at(row, 'numero_facture'));
    const shown = number.slice(0, 20);
    const issuedOn = dayOf(at(row, 'date_emission'));
    const dueOn = dayOf(at(row, 'date_echeance'));
    const amount = amountOf(at(row, 'montant_ttc'));
    const siret = text(at(row, 'siret')).replace(/\s/gu, '');
    const refused = (message: string) => errors.push({ line, message: message.slice(0, 200) });
    if (!text(at(row, 'debiteur'))) return refused('Nom du débiteur manquant');
    if (siret && !isValidSiret(siret)) return refused(`SIRET invalide pour la facture ${shown || '(sans numéro)'}`);
    if (!number) return refused('Numéro de facture manquant');
    if (!issuedOn || !dueOn) return refused(`${!issuedOn ? 'Date d’émission' : 'Échéance'} manquante ou illisible pour la facture ${shown}`);
    if (amount === null || amount <= 0) return refused(`Montant illisible (« ${text(at(row, 'montant_ttc')).slice(0, 20)} »)`);
    const key = `${text(at(row, 'debiteur')).toLowerCase()}|${siret}`;
    const known = groups.get(key);
    const invoice = { number, issuedOn, dueOn, amount };
    const candidate: Claim = known
      ? { ...known, invoices: [...known.invoices, invoice] }
      : {
          debtor: text(at(row, 'debiteur')),
          siret,
          email: text(at(row, 'email')),
          phone: text(at(row, 'telephone')),
          address: text(at(row, 'adresse')),
          invoices: [invoice],
        };
    const parsed = newClaim.safeParse(candidate);
    if (!parsed.success) return refused(parsed.error.issues[0]?.message ?? 'Ligne illisible');
    groups.set(key, parsed.data);
  });
  return { lines: lines.length, claims: [...groups.values()], errors: errors.slice(0, 200) };
}

/** The import of a file of claims by a creditor: read here, kept until confirmed, then deposited claim by claim. */
@Injectable()
export class ClaimImports {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  async read(bytes: Uint8Array, declared: string): Promise<ImportReport> {
    const [who] = await this.database.tx.$queryRaw<
      { user_id: string; creditor: string }[]
    >`SELECT app.user_id() AS user_id, app.partner_creditor() AS creditor`;
    await this.limits.take({ name: 'claim-import', max: 20, seconds: 3600 }, who!.creditor);
    const type = declared.split(';')[0]!.trim().toLowerCase();
    let rows: Cell[][];
    try {
      if (type === XLSX) {
        if (!withinZipLimits(bytes)) throw new Error('zip');
        rows = (await readSheet(Buffer.from(bytes))) as Cell[][];
      } else if (CSV.has(type)) rows = csvRows(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      else throw new Error('type');
    } catch {
      throw new ApiError(422, 'UNREADABLE');
    }
    const { lines, claims, errors } = readClaims(rows);
    const valid = claims.reduce((sum, claim) => sum + claim.invoices.length, 0);
    const total = claims.reduce((sum, claim) => sum + claim.invoices.reduce((all, invoice) => all + invoice.amount, 0), 0);
    const { tx } = this.database;
    // At most 10 waiting per creditor, counted under a lock of the creditor.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`claim-import:${who!.creditor}`}, 0))::text`;
    const waiting = await tx.claimImport.count({ where: { status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (waiting >= 10) throw new ApiError(429, 'TOO_MANY');
    const { id } = await tx.claimImport.create({
      data: { creditorId: who!.creditor, uploadedBy: who!.user_id, lines, valid, totalCents: BigInt(total), claims, errors },
      select: { id: true },
    });
    return { id, lines, valid, total, errors };
  }

  /** Each claim deposited as one typed by hand; those that are refused are counted as pending, with the lines in error. */
  async confirm(id: string): Promise<z.infer<typeof importDone>> {
    const { tx } = this.database;
    // One confirmation at a time: the second waits, then finds it confirmed.
    await tx.$queryRaw`SELECT id FROM claim_imports WHERE id = ${id}::uuid FOR UPDATE`;
    const found = await tx.claimImport.findFirst({ where: { id, status: 'PENDING', expiresAt: { gt: new Date() } }, select: { claims: true, errors: true } });
    if (!found) throw notFound();
    let created = 0;
    let refused = 0;
    for (const claim of found.claims as Claim[]) {
      const [row] = await tx.$queryRaw<{ outcome: string }[]>`
        SELECT outcome FROM app.creditor_deposit(${claim.debtor}, ${claim.siret}, ${claim.address}, ${claim.email}, ${claim.phone}, ${JSON.stringify(claim.invoices)}::jsonb, '{}'::uuid[])`;
      if (row?.outcome === 'OPENED') created += claim.invoices.length;
      else refused += claim.invoices.length;
    }
    await tx.claimImport.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), createdCount: created, claims: [], errors: [] } });
    return { created, pending: refused + (found.errors as unknown[]).length };
  }
}
