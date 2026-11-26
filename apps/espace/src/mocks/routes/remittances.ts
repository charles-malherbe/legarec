import { canAccessBilling, type RemittanceRow } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, guarded, notFound } from '../http';

type Info = { request: Request; params: Record<string, string | readonly string[] | undefined> };
const UNTIL = '2026-11-20';
const row = (
  creditorId: string,
  creditor: string,
  payments: number,
  collected: number,
  feesNet: number,
  state: RemittanceRow['state'],
  account: string | null,
): RemittanceRow => {
  const feesVat = Math.round(feesNet * 0.2);
  return {
    creditorId,
    creditor,
    state,
    payments,
    collected,
    feesNet,
    feesVat,
    feesGross: feesNet + feesVat,
    toPay: Math.max(collected - feesNet - feesVat, 0),
    accountId: account ? `compte-${creditorId}` : null,
    account,
    invoice: null,
    reason: null,
  };
};
/** Fictitious batch, the creditors of the demonstration (docs/propositions, écran 3). */
const seed = (): RemittanceRow[] => [
  row('md', 'Matériaux Delta', 4, 2490200, 203716, 'READY', 'FR76 •••• 4521'),
  row('er', 'Énergies Rhône', 17, 4264366, 298506, 'READY', 'FR76 •••• 8830'),
  row('mt', 'Médiatel', 9, 1825000, 167250, 'READY', 'FR76 •••• 1107'),
  row('ta', 'TransAlp Leasing', 5, 1260000, 126000, 'NO_ACCOUNT', null),
  row('ch', 'Crédit Horizon', 1, 9400, 1128, 'BELOW_MINIMUM', 'FR76 •••• 2093'),
];
interface Batch {
  id: string;
  until: string;
  status: 'VALIDATED' | 'PAID';
  total: number;
  transfers: number;
  validatedAt: string;
  validatedBy: string;
  paidOn: string | null;
  rows: RemittanceRow[];
}
let draft = seed();
let batches: Batch[] = [];
export const resetRemittances = () => {
  draft = seed();
  batches = [];
};

export const remittanceHandlers = [
  http.get(
    '/api/remittances/draft',
    guarded(canAccessBilling, () => {
      const ready = draft.filter((item) => item.state === 'READY');
      return HttpResponse.json({ until: UNTIL, rows: draft, total: ready.reduce((sum, item) => sum + item.toPay, 0), transfers: ready.length });
    }),
  ),
  http.post(
    '/api/remittances',
    guarded<Info>(canAccessBilling, async ({ request }, session) => {
      const body = (await request.json()) as { expected: { creditorId: string; toPay: number }[]; retained: { creditorId: string; reason: string }[] };
      const kept = new Set(body.retained.map((item) => item.creditorId));
      const ready = draft.filter((item) => item.state === 'READY' && !kept.has(item.creditorId));
      const same =
        ready.length === body.expected.length &&
        ready.every((item) => body.expected.some((wanted) => wanted.creditorId === item.creditorId && wanted.toPay === item.toPay));
      if (!same) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      const id = crypto.randomUUID();
      const rows = draft
        .filter((item) => item.state === 'READY')
        .map((item, index) =>
          kept.has(item.creditorId)
            ? { ...item, state: 'RETAINED' as const, reason: body.retained.find((entry) => entry.creditorId === item.creditorId)!.reason }
            : { ...item, invoice: `FA-2026-${String(118 + index).padStart(4, '0')}` },
        );
      batches = [
        {
          id,
          until: UNTIL,
          status: 'VALIDATED',
          total: ready.reduce((sum, item) => sum + item.toPay, 0),
          transfers: ready.length,
          validatedAt: '2026-11-21T09:00:00.000Z',
          validatedBy: 'Camille Laurent',
          paidOn: null,
          rows,
        },
        ...batches,
      ];
      draft = draft.filter((item) => item.state !== 'READY' || kept.has(item.creditorId));
      audit(session, 'Lot de reversements validé', 'ADMINISTRATIVE');
      return HttpResponse.json({ id });
    }),
  ),
  http.get(
    '/api/remittances',
    guarded(canAccessBilling, () => HttpResponse.json({ items: batches.map(({ rows: _rows, ...batch }) => batch) })),
  ),
  http.get(
    '/api/remittances/:id',
    guarded<Info>(canAccessBilling, ({ params }) => {
      const batch = batches.find((item) => item.id === params.id);
      return batch ? HttpResponse.json(batch) : notFound();
    }),
  ),
  http.post(
    '/api/remittances/:id/paid',
    guarded<Info>(canAccessBilling, async ({ params, request }, session) => {
      const batch = batches.find((item) => item.id === params.id);
      if (!batch) return notFound();
      const { paidOn, expectedTotal } = (await request.json()) as { paidOn: string; expectedTotal: number };
      if (batch.status !== 'VALIDATED' || batch.total !== expectedTotal) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      batches = batches.map((item) =>
        item.id === batch.id
          ? { ...item, status: 'PAID', paidOn, rows: item.rows.map((entry) => (entry.state === 'READY' ? { ...entry, state: 'PAID' as const } : entry)) }
          : item,
      );
      audit(session, 'Reversements marqués comme versés', 'ADMINISTRATIVE');
      return done();
    }),
  ),
];
