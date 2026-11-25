import type { DocumentItem, LetterRecipient } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { actsOn, readable } from './cases';

type Info = { request: Request; params: Record<string, unknown> };
const d = (
  id: string,
  category: DocumentItem['category'],
  name: string,
  title: string,
  debtor: string,
  caseId: string | null,
  creditorId: string,
  creditor: string,
  date: string,
  size: string,
  status: string,
  tone: DocumentItem['tone'],
  tracking: string,
  author: string,
  kind: DocumentItem['kind'] = 'PDF',
): DocumentItem => ({ id, category, name, title, debtor, caseId, creditorId, creditor, date, size, kind, status, tone, tracking, author });
const ITEMS = [
  d(
    'd1',
    'FORMAL_NOTICE',
    'Mise en demeure – Charpentes Bellet.pdf',
    'MISE EN DEMEURE',
    'Charpentes Bellet',
    null,
    'md',
    'Matériaux Delta',
    '2026-11-16',
    '182 Ko',
    'AR signé',
    'success',
    'LRAR · AR reçu le 18/11',
    'Camille Laurent',
  ),
  d(
    'd2',
    'REMINDER_LETTER',
    'Relance n°2 – Bâtiplus SAS.pdf',
    'RELANCE',
    'Bâtiplus SAS',
    'demo',
    'md',
    'Matériaux Delta',
    '2026-11-12',
    '96 Ko',
    'Envoyé',
    'info',
    'E-mail · ouvert le 13/11',
    'Automatique',
  ),
  d(
    'd3',
    'PAYMENT_PLAN',
    'Échéancier 4 mois – SCI Les Tilleuls.pdf',
    'PLAN DE PAIEMENT',
    'SCI Les Tilleuls',
    null,
    'md',
    'Matériaux Delta',
    '2026-10-02',
    '140 Ko',
    'Signé',
    'success',
    'Signature électronique le 03/10',
    'Camille Laurent',
  ),
  d(
    'd4',
    'INVOICE',
    'F-2026-0712.pdf',
    'FACTURE',
    'Bâtiplus SAS',
    'demo',
    'md',
    'Matériaux Delta',
    '2026-08-15',
    '74 Ko',
    'Reçue du créancier',
    'marine',
    'Import CSV du 15/09',
    'Matériaux Delta',
  ),
  d(
    'd5',
    'EVIDENCE',
    'BL-2026-10-02 (contestation).pdf',
    'BON DE LIVRAISON',
    'Atelier Mistral',
    'mistral',
    'md',
    'Matériaux Delta',
    '2026-11-21',
    '84 Ko',
    'Reçu du débiteur',
    'marine',
    'Pièce jointe d’e-mail',
    'Sophie Arnaud',
  ),
  d(
    'd6',
    'COURT',
    'Ordonnance IP – Menuiserie Arnal.pdf',
    'ORDONNANCE',
    'Menuiserie Arnal',
    null,
    'md',
    'Matériaux Delta',
    '2026-10-20',
    '320 Ko',
    'Signifiée',
    'marine',
    'Signification le 02/11',
    'Étude Garnier',
  ),
  d(
    'd7',
    'REMITTANCE',
    'Relevé de reversement – novembre.pdf',
    'RELEVÉ DE REVERSEMENT',
    '12 débiteurs',
    null,
    'md',
    'Matériaux Delta',
    '2026-11-15',
    '210 Ko',
    'Envoyé',
    'info',
    'Espace créancier + e-mail',
    'Automatique',
  ),
  d(
    'd8',
    'REMINDER_LETTER',
    'Proposition d’échéancier – Bâtiplus SAS.docx',
    'PROPOSITION D’ÉCHÉANCIER',
    'Bâtiplus SAS',
    'demo',
    'md',
    'Matériaux Delta',
    '2026-11-21',
    '48 Ko',
    'Brouillon',
    'neutral',
    'Non envoyé',
    'Camille Laurent',
    'DOCX',
  ),
  d(
    'd9',
    'COURT',
    'PV saisie-attribution – Transports Lemaire.pdf',
    'PROCÈS-VERBAL',
    'Transports Lemaire',
    null,
    'tl',
    'TransAlp Leasing',
    '2026-11-17',
    '268 Ko',
    'Reçu',
    'marine',
    'Transmis par l’étude',
    'Étude Garnier',
  ),
  d(
    'd10',
    'EVIDENCE',
    'Avis de virement 20-11-2026.pdf',
    'AVIS DE VIREMENT',
    'Nordis Logistique',
    'nordis',
    'er',
    'Énergies Rhône',
    '2026-11-20',
    '62 Ko',
    'Rapproché',
    'marine',
    'Paiement de 12 500 €',
    'Nordis Logistique',
  ),
  d(
    'd11',
    'RECEIPT',
    'Quittance 12 500 € – Nordis Logistique.pdf',
    'QUITTANCE',
    'Nordis Logistique',
    'nordis',
    'er',
    'Énergies Rhône',
    '2026-11-20',
    '58 Ko',
    'Disponible',
    'success',
    'Virement rapproché',
    'Automatique',
  ),
];
const r = (
  caseId: string,
  name: string,
  contact: string,
  address: string[],
  creditor: string,
  reference: string,
  lastReminder: string,
  interest: number,
  invoices: [string, string, number][],
  isIndividual = false,
  firstLetter: LetterRecipient['firstLetter'] = { reference: reference.replace(/^LGR-(\d{4})-0/, 'LR-$1-'), date: '2026-09-15' },
): LetterRecipient => ({
  caseId,
  name,
  contact,
  address,
  creditor,
  reference,
  isIndividual,
  settled: false,
  lastReminder,
  firstLetter,
  interest,
  invoices: invoices.map(([number, due, euros]) => ({ number, due, amount: euros * 100 })),
});
const RECIPIENTS = [
  r('demo', 'Bâtiplus SAS', 'M. Julien Ferrand', ['12 rue des Artisans', '69007 Lyon'], 'Matériaux Delta', 'LGR-2026-00142', '2026-11-12', 136600, [
    ['F-2026-0712', '2026-09-14', 18600],
    ['F-2026-0745', '2026-09-27', 16400],
    ['F-2026-0790', '2026-10-10', 13200],
  ]),
  r('helio', 'Groupe Hélio', 'Mme Nadia Roussel', ['8 avenue Jean-Jaurès', '75019 Paris'], 'Médiatel', 'LGR-2026-00151', '2026-11-12', 62000, [
    ['F-2026-0655', '2026-10-13', 21500],
    ['F-2026-0702', '2026-10-20', 15250],
  ]),
  r('valmont', 'Garage Valmont', 'M. Paul Valmont', ['45 route de Lyon', '38000 Grenoble'], 'TransAlp Leasing', 'LGR-2026-00098', '2026-10-28', 58000, [
    ['L-2026-0118', '2026-08-16', 5975],
    ['L-2026-0131', '2026-09-16', 5975],
    ['L-2026-0144', '2026-10-16', 5975],
    ['L-2026-0157', '2026-11-16', 5975],
  ]),
  r('durand', 'Fromagerie Durand', 'M. Marc Durand', ['3 place du Marché', '71000 Mâcon'], 'Énergies Rhône', 'LGR-2026-00181', '2026-11-03', 8400, [
    ['F-2026-0902', '2026-10-31', 3120],
    ['F-2026-0927', '2026-11-07', 3120],
  ]),
  r(
    'meunier',
    'Paul Meunier',
    'M. Paul Meunier',
    ['7 impasse des Lilas', '69003 Lyon'],
    'Crédit Horizon',
    'LGR-2026-00203',
    '2026-11-10',
    1900,
    [['CH-2026-0871', '2026-11-03', 2150]],
    true,
    null,
  ),
];
const COUNTS = { REMINDER_LETTER: 1284, FORMAL_NOTICE: 212, PAYMENT_PLAN: 96, INVOICE: 1386, EVIDENCE: 318, COURT: 74, REMITTANCE: 112, RECEIPT: 148 };
const onDocument = guarded<Info>(staffWithCases, ({ params }, session) => {
  const item = ITEMS.find((entry) => entry.id === params.id);
  if (!item) return notFound();
  const own = readable(session).find((entry) => entry.id === item.caseId);
  // A document without a case is handled by the manager; any other follows the rights on its case.
  if (!item.caseId) return session.role === 'COLLECTION_MANAGER' ? done() : forbidden();
  return own && actsOn(session, own.id) ? done() : forbidden();
});

const BATCH_CREDITORS = [
  { id: 'md', name: 'Matériaux Delta' },
  { id: 'er', name: 'Énergies Rhône' },
  { id: 'mt', name: 'Médiatel' },
  { id: 'tl', name: 'TransAlp Leasing' },
];
/** Share of the portfolio kept by each filter of the demonstration. */
const batchOf = (creditor: string, age: string) => {
  const part = { md: 0.34, er: 0.26, mt: 0.21, tl: 0.11, ch: 0.08 }[creditor] ?? 1;
  const share = { '0-30': 0.6, '60+': 0.45 }[age] ?? 1;
  const scale = (value: number) => Math.round(value * part * share);
  return { debtors: scale(38), invoices: scale(162), amount: scale(214380) * 100, withoutFirstLetter: scale(3) };
};
const MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg']);
export const documentHandlers = [
  http.get(
    '/api/documents',
    guarded(staffWithCases, (_info, session) => {
      const own = new Set(readable(session).map((item) => item.id));
      const officer = session.role === 'CLAIMS_OFFICER';
      const items = officer ? ITEMS.filter((item) => item.caseId && own.has(item.caseId)) : ITEMS;
      return HttpResponse.json({
        items,
        total: officer ? items.length : 3630,
        size: officer ? '1,1 Mo' : '2,4 Go',
        counts: officer ? Object.fromEntries(Object.keys(COUNTS).map((key) => [key, items.filter((item) => item.category === key).length])) : COUNTS,
      });
    }),
  ),
  http.post(
    '/api/documents/import',
    guarded<Info>(staffWithCases, ({ request }, session) => {
      if (!MIME.has((request.headers.get('content-type') ?? '').toLowerCase())) return HttpResponse.json({ code: 'REFUSED' }, { status: 415 });
      const status = actsOn(session, 'demo') ? 'ATTACHED' : 'TO_FILE';
      audit(session, status === 'ATTACHED' ? 'Document importé et rattaché à un dossier' : 'Document importé, à classer');
      return HttpResponse.json({ id: crypto.randomUUID(), status });
    }),
  ),
  http.post('/api/documents/:id/share', onDocument),
  http.post('/api/documents/:id/send', onDocument),
  http.get(
    '/api/documents/compose',
    guarded<Info>(staffWithCases, ({ request }, session) => {
      const allowed = readable(session)
        .filter((item) => session.role !== 'DIRECTOR' || item.officerId === session.userId)
        .map((item) => item.id);
      const params = new URL(request.url).searchParams;
      return HttpResponse.json({
        firm: { name: 'LEGAREC', address: '[ADRESSE DU CABINET]', phone: '01 87 88 02 98', siren: '[SIREN]' },
        recipients: RECIPIENTS.filter((item) => allowed.includes(item.caseId)),
        batch: session.role === 'COLLECTION_MANAGER' ? { creditors: BATCH_CREDITORS, ...batchOf(params.get('creditor') ?? '', params.get('age') ?? '') } : null,
      });
    }),
  ),
  http.post(
    '/api/documents/compose',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const { caseIds, filters, expected, template } = (await request.json()) as {
        caseIds: string[] | null;
        filters: { creditor: string; age: string } | null;
        expected?: number;
        template?: string;
      };
      // Every case of these lists still has a balance.
      if (template === 'CLEARANCE') return HttpResponse.json({ code: 'NOT_SETTLED' }, { status: 422 });
      if (!caseIds) {
        if (session.role !== 'COLLECTION_MANAGER') return forbidden();
        const batch = batchOf(filters?.creditor ?? '', filters?.age ?? '');
        const count = batch.debtors - (template === 'FIRM' || template === 'FORMAL_NOTICE' ? batch.withoutFirstLetter : 0);
        return filters && count > 0 && count === expected ? done() : HttpResponse.json({ code: 'SELECTION_CHANGED' }, { status: 409 });
      }
      const allowed = readable(session)
        .filter((item) => session.role !== 'DIRECTOR' || item.officerId === session.userId)
        .map((item) => item.id);
      return caseIds.every((id) => allowed.includes(id)) ? done() : forbidden();
    }),
  ),
  http.post(
    '/api/documents/compose/draft',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const { caseId } = (await request.json()) as { caseId: string };
      return actsOn(session, caseId) ? done() : forbidden();
    }),
  ),
];
