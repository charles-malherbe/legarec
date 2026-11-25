import type { CreditorDetail, CreditorListItem, Session } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { guarded, notFound, staffWithCases } from '../http';
import { mayRead } from '../visibility';
import { readable } from './cases';

export const CREDITORS: CreditorListItem[] = [
  {
    id: 'md',
    initials: 'MD',
    name: 'Matériaux Delta',
    siren: '401 228 975',
    sector: 'Négoce de matériaux BTP',
    debtors: 64,
    invoices: 412,
    outstanding: 38640000,
    recovered: 45030000,
    rate: 54,
    fee: '8 % HT',
    owner: 'C. Laurent',
    status: 'ACTIVE',
    statusLabel: 'Mandat actif',
  },
  {
    id: 'er',
    initials: 'ER',
    name: 'Énergies Rhône',
    siren: '626 018 154',
    sector: 'Fourniture d’énergie',
    debtors: 71,
    invoices: 688,
    outstanding: 29815000,
    recovered: 51290000,
    rate: 63,
    fee: '7 % HT',
    owner: 'S. Morel',
    status: 'ACTIVE',
    statusLabel: 'Mandat actif',
  },
  {
    id: 'mt',
    initials: 'MT',
    name: 'Médiatel',
    siren: '183 016 617',
    sector: 'Télécommunications',
    debtors: 52,
    invoices: 534,
    outstanding: 24490000,
    recovered: 25160000,
    rate: 51,
    fee: '9 % HT',
    owner: 'H. Benali',
    status: 'RENEWAL',
    statusLabel: 'Renouvellement 12/2026',
  },
  {
    id: 'tl',
    initials: 'TL',
    name: 'TransAlp Leasing',
    siren: '418 609 137',
    sector: 'Crédit-bail',
    debtors: 33,
    invoices: 146,
    outstanding: 23161000,
    recovered: 20450000,
    rate: 47,
    fee: '10 % HT',
    owner: 'C. Laurent',
    status: 'ACTIVE',
    statusLabel: 'Mandat actif',
  },
  {
    id: 'ch',
    initials: 'CH',
    name: 'Crédit Horizon',
    siren: '199 603 085',
    sector: 'Crédit à la consommation',
    debtors: 28,
    invoices: 162,
    outstanding: 12350000,
    recovered: 15870000,
    rate: 56,
    fee: '12 % HT',
    owner: 'S. Morel',
    status: 'ACTIVE',
    statusLabel: 'Mandat actif',
  },
];
const inv = (
  number: string,
  externalRef: string,
  due: string,
  total: number,
  left: number,
  state: CreditorDetail['portfolio'][number]['invoices'][number]['state'],
) => ({ number, externalRef, due, total: total * 100, left: left * 100, state });

const detail = (item: CreditorListItem): CreditorDetail => ({
  ...item,
  mandateSince: '2024-03-12',
  ownerName: item.id === 'md' ? 'Camille Laurent' : item.owner,
  totalDebtors: item.debtors,
  portfolio:
    item.id !== 'md'
      ? []
      : [
          {
            id: 'demo',
            name: 'Bâtiplus SAS',
            reference: 'DOS-2026-0142',
            amount: 4820000,
            daysLate: 68,
            status: 'OVERDUE',
            statusLabel: 'En retard',
            invoices: [
              inv('F-2026-0712', 'MD-71204', '2026-09-14', 18600, 18600, 'UNPAID'),
              inv('F-2026-0745', 'MD-71388', '2026-09-27', 16400, 16400, 'UNPAID'),
              inv('F-2026-0790', 'MD-71502', '2026-10-10', 13200, 13200, 'REMINDED'),
            ],
          },
          {
            id: 'bellet',
            name: 'Charpentes Bellet',
            reference: 'DOS-2026-0109',
            amount: 2730000,
            daysLate: 81,
            status: 'FORMAL_NOTICE',
            statusLabel: 'Mise en demeure',
            invoices: [
              inv('F-2026-0601', 'MD-70114', '2026-08-31', 9800, 9800, 'UNPAID'),
              inv('F-2026-0633', 'MD-70290', '2026-09-07', 7400, 7400, 'UNPAID'),
              inv('F-2026-0688', 'MD-70842', '2026-09-21', 6900, 6900, 'UNPAID'),
              inv('F-2026-0721', 'MD-71240', '2026-10-05', 5200, 3200, 'PARTIAL'),
            ],
          },
          {
            id: 'mistral',
            name: 'Atelier Mistral',
            reference: 'DOS-2026-0170',
            amount: 1832000,
            daysLate: 52,
            status: 'DISPUTE',
            statusLabel: 'Litige',
            invoices: [inv('F-2026-0874', 'MD-72011', '2026-09-30', 18320, 18320, 'DISPUTED')],
          },
          {
            id: 'rivoire',
            name: 'Menuiserie Rivoire',
            reference: 'DOS-2026-0188',
            amount: 1564000,
            daysLate: 34,
            status: 'REMINDER',
            statusLabel: 'Relance 1',
            invoices: [
              inv('F-2026-0902', 'MD-72230', '2026-10-18', 4120, 4120, 'REMINDED'),
              inv('F-2026-0915', 'MD-72301', '2026-10-22', 3860, 3860, 'REMINDED'),
              inv('F-2026-0931', 'MD-72377', '2026-10-29', 2940, 2940, 'REMINDED'),
              inv('F-2026-0948', 'MD-72455', '2026-11-05', 2610, 2610, 'REMINDED'),
              inv('F-2026-0960', 'MD-72519', '2026-11-12', 2110, 2110, 'REMINDED'),
            ],
          },
          {
            id: 'tilleuls',
            name: 'SCI Les Tilleuls',
            reference: 'DOS-2026-0175',
            amount: 987000,
            daysLate: 12,
            status: 'PLAN',
            statusLabel: 'Échéancier 2/4',
            invoices: [inv('F-2026-0811', 'MD-71760', '2026-10-20', 8400, 4200, 'PLAN'), inv('F-2026-0866', 'MD-71955', '2026-11-09', 5670, 5670, 'PLAN')],
          },
        ],
  payouts: [
    ['2026-11-15', 12, 41761, 3341, 38420],
    ['2026-10-15', 15, 44837, 3587, 41250],
    ['2026-09-15', 9, 30880, 2470, 28410],
    ['2026-08-15', 11, 36210, 2897, 33313],
  ].map(([date, collections, gross, fee, net]) => ({
    id: String(date),
    date: String(date),
    collections: Number(collections),
    gross: Number(gross) * 100,
    fee: Number(fee) * 100,
    net: Number(net) * 100,
  })),
  nextPayout: { date: '2026-12-15', net: 2291000, gross: 2490200, fee: 199200 },
  activity: [
    { id: 'a1', who: 'Bâtiplus SAS', what: 'échéancier de 8 mois validé par Camille Laurent', when: '21/11 11:58', status: null },
    { id: 'a2', who: 'Bâtiplus SAS', what: 'promesse de 18 600 € pour le 28/11', when: '21/11 09:00', status: 'PROMISE' },
    { id: 'a3', who: 'Atelier Mistral', what: 'contestation reçue (livraison incomplète)', when: '21/11 08:15', status: 'DISPUTE' },
    { id: 'a4', who: 'Charpentes Bellet', what: 'accusé de réception de la mise en demeure', when: '18/11', status: 'FORMAL_NOTICE' },
    { id: 'a5', who: 'Import', what: '22 nouvelles créances déposées par Claire Besson', when: '20/11', status: null },
    { id: 'a6', who: 'Reversement', what: '38 420 € versés au créancier', when: '15/11', status: 'SETTLED' },
  ],
  mandateTerms: [
    ['Honoraires amiable', `${item.fee} du recouvré`],
    ['Honoraires judiciaire', '12 % HT'],
    ['Indemnité forfaitaire', '40 € / facture (professionnels)'],
    ['Échéancier sans accord', '≤ 6 mois'],
    ['Remise autorisée', '≤ 5 %'],
    ['Passage en contentieux', 'Sur accord écrit'],
    ['Reporting', 'Mensuel, le 5'],
  ].map(([label, value]) => ({ label: label ?? '', value: value ?? '' })),
  contact: { name: 'Claire Besson', title: 'Credit manager', phone: '04 72 00 00 00', email: 'c.besson@materiauxdelta.example', portalEnabled: true },
});

/** An officer only meets the creditors of their own cases, and only their own debtors there. */
export const canSeeCreditor = (session: Session, id: string) => session.role !== 'CLAIMS_OFFICER' || readable(session).some((item) => item.creditorId === id);

export const creditorHandlers = [
  http.get(
    '/api/creditors',
    guarded(staffWithCases, (_info, session) => HttpResponse.json(CREDITORS.filter((item) => canSeeCreditor(session, item.id)))),
  ),
  http.get(
    '/api/creditors/:id',
    guarded(staffWithCases, ({ params }: { request: Request; params: Record<string, unknown> }, session) => {
      const item = CREDITORS.find((creditor) => creditor.id === (params.id === 'demo' ? 'md' : params.id));
      if (!item || !canSeeCreditor(session, item.id)) return notFound();
      const full = detail(item);
      const officer = session.role === 'CLAIMS_OFFICER';
      return HttpResponse.json({
        ...full,
        portfolio: full.portfolio.filter((entry) => mayRead(session, entry.name)),
        activity: full.activity.filter((entry) => mayRead(session, `${entry.who} ${entry.what}`)),
        payouts: officer ? [] : full.payouts,
      });
    }),
  ),
];
