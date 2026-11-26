import { billingData, formatCents, formatSiren, REQUEST_BODIES } from '@legarec/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { StaffOrDelegate } from '../../platform/access/access';
import { Database } from '../../platform/database/database';
import { conflict, forbidden } from '../../platform/errors/api-error';
import { Commits } from '../../platform/http/transaction.interceptor';
import { SettingValues } from '../settings/values';

const bodies = REQUEST_BODIES.staff;
type In<K extends keyof typeof bodies> = z.infer<(typeof bodies)[K]>;
type Data = z.infer<typeof billingData>;
interface Read {
  invoices: { id: string; number: string; issuedOn: string; creditorId: string; gross: number; left: number; settledOn: string | null; credited: number; labels: string[] }[];
  nextInvoice: string;
  yearNet: number;
  yearCount: number;
  monthNet: number;
  monthCount: number;
  dueGross: number;
  dueCount: number;
}
const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
const paris = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' }).format(new Date());

/** The status of an invoice is never written: the credit notes that cite it and the remittance that retained it say it. */
function statusOf(invoice: Read['invoices'][number]): Pick<Data['documents'][number], 'status' | 'tone'> {
  if (invoice.credited > 0) return invoice.left > 0 ? { status: 'Avoir partiel', tone: 'warning' } : { status: 'Annulée par avoir', tone: 'neutral' };
  return invoice.settledOn ? { status: 'Déduite du reversement', tone: 'success' } : { status: 'Émise', tone: 'marine' };
}

/**
 * The screen « Facturation »: the invoices the firm really issued, those of the commission made by the remittances. The
 * Director, or the manager acting for them, as the credit notes. Quotes, contracts and invoices typed by hand have no table
 * yet (questions 195 and 196): none is listed, none is created.
 */
@ApiTags('remittances')
@Controller('staff/billing')
@StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
export class BillingController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  @ApiOkResponse({ standardSchema: billingData })
  async read(): Promise<Data> {
    const tx = this.database.tx;
    // PostgreSQL checks again who reads, before anything else is fetched.
    const [{ data }] = (await tx.$queryRaw<{ data: Read }[]>`SELECT app.billing_overview() AS data`) as [{ data: Read }];
    const creditors = await tx.creditor.findMany({
      where: { OR: [{ status: 'ACTIVE' }, { id: { in: [...new Set(data.invoices.map((item) => item.creditorId))] } }] },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        legalName: true,
        siren: true,
        status: true,
        address: true,
        postalCode: true,
        city: true,
        contacts: { where: { isMain: true }, select: { name: true, title: true } },
      },
    });
    const byId = new Map(creditors.map((item) => [item.id, item]));
    const director = await tx.user.findFirst({ where: { role: 'DIRECTOR', status: 'ACTIVE' }, select: { firstName: true, lastName: true } });
    const values = await SettingValues.read(tx);
    const firm = (field: string) => values.text('firm', 'cabinet', field);
    const year = paris({ year: 'numeric' });
    return {
      firm: {
        name: firm('name'),
        address: firm('address'),
        phone: firm('phone'),
        siren: firm('siren'),
        vat: firm('vat'),
        signer: director ? `${director.firstName} ${director.lastName}, direction` : '',
      },
      // Whom the firm may bill: its creditors in activity. A prospect has no record (question 196).
      clients: creditors
        .filter((item) => item.status === 'ACTIVE')
        .map((item) => {
          const [contact] = item.contacts;
          return {
            id: item.id,
            name: item.name,
            legal: item.legalName || item.name,
            siren: item.siren ? formatSiren(item.siren) : '',
            address: [item.address, [item.postalCode, item.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            signer: contact ? [contact.name, contact.title].filter(Boolean).join(', ') : '',
          };
        }),
      documents: data.invoices.map((invoice) => {
        const creditor = byId.get(invoice.creditorId);
        return {
          id: invoice.id,
          type: 'INVOICE' as const,
          number: invoice.number,
          client: creditor?.name ?? '',
          idLine: creditor?.siren ? `SIREN ${formatSiren(creditor.siren)}` : 'SIREN à renseigner',
          subject: [...new Set(invoice.labels)].join(' · '),
          date: invoice.issuedOn,
          amount: invoice.gross,
          duration: null,
          ...statusOf(invoice),
        };
      }),
      nextNumbers: { INVOICE: data.nextInvoice },
      stats: [
        { label: `Facturé en ${year}`, value: `${formatCents(data.yearNet)} HT`, sub: `${plural(data.yearCount, 'facture', 'factures')}, avoirs déduits` },
        {
          label: `Facturé en ${paris({ month: 'long' })}`,
          value: `${formatCents(data.monthNet)} HT`,
          sub: `${plural(data.monthCount, 'facture', 'factures')}, avoirs déduits`,
        },
        {
          label: 'À encaisser',
          value: formatCents(data.dueGross),
          sub: plural(data.dueCount, 'facture non réglée', 'factures non réglées'),
          ...(data.dueCount > 0 ? { tone: 'warning' as const } : {}),
        },
      ],
    };
  }

  /**
   * « Créer depuis un modèle »: refused for the three types, until the firm says how such a document is numbered, settled
   * and kept (questions 195 and 196). An invoice is immutable and its number never reused: none is drawn on a guess.
   */
  @Post()
  @Commits()
  @HttpCode(409)
  @ApiConflictResponse({ description: 'NOT_AVAILABLE' })
  async create(@Body({ schema: bodies['POST /billing'] }) body: In<'POST /billing'>): Promise<never> {
    // Who acts first, as PostgreSQL knows it: a delegation claimed and not held learns nothing, not even this refusal.
    const [{ allowed }] = (await this.database.tx.$queryRaw<{ allowed: boolean }[]>`SELECT app.acts_as_director('ADMINISTRATIVE') AS allowed`) as [
      { allowed: boolean },
    ];
    if (!allowed) throw forbidden();
    throw conflict('NOT_AVAILABLE', { type: body.type });
  }
}
