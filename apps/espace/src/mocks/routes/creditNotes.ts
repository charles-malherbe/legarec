import {
  canAccessBilling,
  creditedVat,
  creditNoteDraftBody,
  creditNoteIssue,
  type CorrectableInvoice,
  type CreditNoteDraft,
  type CreditNoteRow,
  type CreditNotesData,
  type Session,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, guarded, notFound } from '../http';
import { firmText } from './settings';

type Info = { request: Request; params: Record<string, string | readonly string[] | undefined> };
const PLACEHOLDER = /\[[A-ZÀ-ÖØ-Þ][^[\]]{2,}\]/u;
const CLIENTS = {
  er: { id: 'er', name: 'Énergies Rhône', legalName: 'Énergies Rhône SA', address: '8 quai Perrache, 69002 Lyon', siren: '626018154', vatNumber: null },
  md: { id: 'md', name: 'Matériaux Delta', legalName: 'Matériaux Delta SAS', address: '14 rue des Tanneurs, 69007 Lyon', siren: '401228975', vatNumber: null },
  mt: { id: 'mt', name: 'Médiatel', legalName: 'Médiatel SAS', address: '41 avenue Jean Jaurès, 69007 Lyon', siren: '183016617', vatNumber: null },
  tl: {
    id: 'tl',
    name: 'TransAlp Leasing',
    legalName: 'TransAlp Leasing SAS',
    address: '3 place Grenette, 38000 Grenoble',
    siren: '418609137',
    vatNumber: null,
  },
  ch: { id: 'ch', name: 'Crédit Horizon', legalName: 'Crédit Horizon SA', address: '22 cours Lafayette, 69003 Lyon', siren: '199603085', vatNumber: null },
} satisfies Record<string, CorrectableInvoice['client']>;
const line = (id: string, label: string, net: number) => ({ id, label, net, vat: Math.round(net * 0.2) });
const invoice = (id: string, client: keyof typeof CLIENTS, issuedOn: string, settledOn: string | null, lines: ReturnType<typeof line>[]) => {
  const net = lines.reduce((sum, item) => sum + item.net, 0);
  const vat = lines.reduce((sum, item) => sum + item.vat, 0);
  return { id, number: id, issuedOn, client: CLIENTS[client], net, vat, gross: net + vat, settledOn, lines };
};
/** The invoices of the Facturation screen (FA-2026-0113 to 0117), with their lines. */
const INVOICES = [
  invoice('FA-2026-0117', 'er', '2026-11-02', '2026-11-15', [
    line('l117a', 'Commission de recouvrement · 8 % de 101 055,00 € encaissés en octobre 2026', 808_440),
    line('l117b', 'Frais d’ouverture · 8 dossiers', 12_000),
  ]),
  invoice('FA-2026-0116', 'md', '2026-11-02', '2026-11-15', [
    line('l116a', 'Commission · 8 % de 54 590,00 € encaissés en octobre 2026', 436_720),
    line('l116b', 'Frais d’ouverture · 4 dossiers', 6_000),
  ]),
  invoice('FA-2026-0115', 'mt', '2026-11-02', null, [
    line('l115a', 'Commission · 8 % de 39 900,00 € encaissés en octobre 2026', 319_200),
    line('l115b', 'Frais d’ouverture · 4 dossiers', 6_000),
  ]),
  invoice('FA-2026-0114', 'tl', '2026-10-28', null, [line('l114a', 'Refacturation de frais de procédure', 107_000)]),
  invoice('FA-2026-0113', 'ch', '2026-10-02', null, [line('l113a', 'Commission · septembre 2026', 183_000)]),
];
type Credit = CreditNoteRow & { lines: { lineId: string; net: number; vat: number }[] };
const seedItems = (): Credit[] => [
  {
    id: 'AV-2026-0001',
    number: 'AV-2026-0001',
    issuedOn: '2026-10-14',
    client: CLIENTS.ch,
    invoiceId: 'FA-2026-0098',
    invoice: 'FA-2026-0098',
    invoiceIssuedOn: '2026-09-02',
    invoiceStatus: 'CANCELLED',
    scope: 'TOTAL',
    net: 60_000,
    vat: 12_000,
    gross: 72_000,
    reason: 'Taux de commission erroné (dossier LGR-2026-00102).',
    followUp: 'TRANSFER',
    remittedOn: null,
    lines: [],
  },
];
let items = seedItems();
/** As the API: a draft is its author's alone (question 172). */
let drafts: (CreditNoteDraft & { author: string })[] = [];
const mine = (session: Session) => drafts.filter((item) => item.author === session.userId);
export const resetCreditNotes = () => {
  items = seedItems();
  drafts = [];
};

const linesLeft = (source: (typeof INVOICES)[number]) =>
  source.lines.map((item) => {
    const credited = items.flatMap((entry) => entry.lines).filter((entry) => entry.lineId === item.id);
    return {
      ...item,
      leftNet: item.net - credited.reduce((sum, entry) => sum + entry.net, 0),
      leftVat: item.vat - credited.reduce((sum, entry) => sum + entry.vat, 0),
    };
  });
const leftOf = (source: (typeof INVOICES)[number]) =>
  source.gross - items.filter((item) => item.invoiceId === source.id).reduce((sum, item) => sum + item.gross, 0);
/** Status of an invoice of the Facturation screen once credit notes cite it; null: unchanged. */
export const correctedStatus = (number: string): 'Avoir partiel' | 'Annulée par avoir' | null => {
  const source = INVOICES.find((item) => item.number === number);
  if (!source || !items.some((item) => item.invoiceId === source.id)) return null;
  return leftOf(source) > 0 ? 'Avoir partiel' : 'Annulée par avoir';
};
const data = (session: Session): CreditNotesData => ({
  invoices: INVOICES.filter((item) => leftOf(item) > 0).map((item) => ({
    ...item,
    left: leftOf(item),
    credited: items.filter((entry) => entry.invoiceId === item.id).length,
    lines: linesLeft(item),
  })),
  items: items.map(({ lines: _lines, ...item }) => ({
    ...item,
    invoiceStatus: INVOICES.some((source) => source.id === item.invoiceId && leftOf(source) > 0) ? 'PARTIAL' : 'CANCELLED',
  })),
  drafts: mine(session).map(({ author: _author, ...draft }) => draft),
  nextNumber: `AV-2026-${String(items.length + 1).padStart(4, '0')}`,
  nextRemittance: '2026-12-15',
  firm: {
    name: firmText('name'),
    address: firmText('address'),
    phone: firmText('phone'),
    siren: firmText('siren'),
    vat: firmText('vat'),
    rcs: firmText('rcs'),
  },
});
const invalid = () => HttpResponse.json({ code: 'INVALID' }, { status: 422 });

/** Credit notes (docs/propositions, « Avoir »): the same rules as `app.issue_credit_note`. */
export const creditNoteHandlers = [
  http.get(
    '/api/credit-notes',
    guarded(canAccessBilling, (_info, session) => HttpResponse.json(data(session))),
  ),
  http.post(
    '/api/credit-notes',
    guarded<Info>(canAccessBilling, async ({ request }, session) => {
      const parsed = creditNoteIssue.safeParse(await request.json());
      if (!parsed.success) return invalid();
      const body = parsed.data;
      const firm = data(session).firm;
      // The value between brackets, or the name of the field left empty.
      const missing = Object.entries(firm).flatMap(([field, value]) => (!value.trim() ? [field] : (value.match(PLACEHOLDER) ?? []).slice(0, 1)));
      if (missing.length) return HttpResponse.json({ code: 'FIRM_INCOMPLETE', missing }, { status: 409 });
      const source = INVOICES.find((item) => item.id === body.invoiceId);
      if (!source) return notFound();
      const left = leftOf(source);
      if (left !== body.expectedLeft || left <= 0) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      if (body.draftId && !mine(session).some((item) => item.id === body.draftId && item.invoiceId === source.id))
        return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      if ((source.settledOn !== null) !== (body.followUp !== 'DEDUCTED')) return invalid();
      const known = linesLeft(source);
      if (
        body.lines.some((item) => !known.some((entry) => entry.id === item.lineId)) ||
        new Set(body.lines.map((item) => item.lineId)).size !== body.lines.length
      )
        return invalid();
      const lines = known
        .map((item) => {
          const net = body.scope === 'TOTAL' ? item.leftNet : (body.lines.find((entry) => entry.lineId === item.id)?.net ?? 0);
          return { lineId: item.id, net, vat: creditedVat(item, net), leftNet: item.leftNet, leftVat: item.leftVat };
        })
        .filter((item) => item.net > 0 || (body.scope === 'TOTAL' && item.leftVat > 0));
      if (lines.some((item) => item.net > item.leftNet || item.vat > item.leftVat)) return invalid();
      const net = lines.reduce((sum, item) => sum + item.net, 0);
      const vat = lines.reduce((sum, item) => sum + item.vat, 0);
      if (net + vat <= 0) return invalid();
      const number = data(session).nextNumber;
      items = [
        {
          id: number,
          number,
          issuedOn: '2026-11-26',
          client: source.client,
          invoiceId: source.id,
          invoice: source.number,
          invoiceIssuedOn: source.issuedOn,
          invoiceStatus: 'PARTIAL',
          scope: net + vat === left ? 'TOTAL' : 'PARTIAL',
          net,
          vat,
          gross: net + vat,
          reason: body.reason,
          followUp: body.followUp,
          remittedOn: null,
          lines: lines.map(({ lineId, net: credited, vat: tax }) => ({ lineId, net: credited, vat: tax })),
        },
        ...items,
      ];
      drafts = drafts.filter((item) => item.id !== body.draftId);
      audit(session, 'Avoir émis', 'ADMINISTRATIVE');
      return HttpResponse.json({ id: number, number });
    }),
  ),
  http.post(
    '/api/credit-notes/drafts',
    guarded<Info>(canAccessBilling, async ({ request }, session) => {
      const parsed = creditNoteDraftBody.safeParse(await request.json());
      if (!parsed.success) return invalid();
      const source = INVOICES.find((item) => item.id === parsed.data.invoiceId);
      if (!source) return notFound();
      if (parsed.data.lines.some((item) => !source.lines.some((entry) => entry.id === item.lineId))) return invalid();
      const id = crypto.randomUUID();
      drafts = [
        { ...parsed.data, id, invoice: source.number, client: source.client.name, updatedAt: new Date().toISOString(), author: session.userId },
        ...drafts,
      ];
      return HttpResponse.json({ id });
    }),
  ),
  http.put(
    '/api/credit-notes/drafts/:id',
    guarded<Info>(canAccessBilling, async ({ request, params }, session) => {
      const parsed = creditNoteDraftBody.safeParse(await request.json());
      if (!parsed.success) return invalid();
      const draft = mine(session).find((item) => item.id === params.id && item.invoiceId === parsed.data.invoiceId);
      if (!draft) return notFound();
      drafts = drafts.map((item) => (item === draft ? { ...item, ...parsed.data, updatedAt: new Date().toISOString() } : item));
      return done();
    }),
  ),
  http.delete(
    '/api/credit-notes/drafts/:id',
    guarded<Info>(canAccessBilling, ({ params }, session) => {
      if (!mine(session).some((item) => item.id === params.id)) return notFound();
      drafts = drafts.filter((item) => item.id !== params.id);
      return done();
    }),
  ),
];
