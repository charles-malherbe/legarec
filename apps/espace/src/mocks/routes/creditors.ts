import {
  isValidSiren,
  type bankAccountChange,
  type CreditorDetail,
  type CreditorFile,
  type creditorChanges,
  type CreditorListItem,
  type mandateAmendment,
  type MandateVersion,
  type NewCreditor,
  type Session,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import type { z } from 'zod';
import { audit } from '../audit';
import { done, guarded, notFound, staffWithCases } from '../http';
import { mayRead } from '../visibility';
import { OFFICERS, readable } from './cases';
import { creditorFacts } from './creditorFacts';
import { administers } from './steering';

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
            reference: 'LGR-2026-00142',
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
            reference: 'LGR-2026-00109',
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
            reference: 'LGR-2026-00170',
            amount: 1832000,
            daysLate: 52,
            status: 'DISPUTE',
            statusLabel: 'Litige',
            invoices: [inv('F-2026-0874', 'MD-72011', '2026-09-30', 18320, 18320, 'DISPUTED')],
          },
          {
            id: 'rivoire',
            name: 'Menuiserie Rivoire',
            reference: 'LGR-2026-00188',
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
            reference: 'LGR-2026-00175',
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

type Info = { request: Request; params: Record<string, unknown> };
type Stored = Omit<CreditorFile, 'bankAccess' | 'openCases'> & { iban: string };
const manages = (session: Session) => session.role === 'DIRECTOR' || session.role === 'COLLECTION_MANAGER';
const compact = (value: string) => value.replace(/\s/gu, '').toUpperCase();
const changed = () => HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
const invalidField = (field: string) => HttpResponse.json({ code: 'INVALID', fields: [field] }, { status: 422 });
const TODAY = '2026-11-25';
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const withState = (mandate: Omit<MandateVersion, 'state'>): MandateVersion => ({
  ...mandate,
  state: mandate.startsOn > TODAY ? 'TO_COME' : mandate.endsOn !== null && mandate.endsOn < TODAY ? 'ENDED' : 'CURRENT',
});
const firstFile = (item: CreditorListItem): Stored => ({
  id: item.id,
  version: 1,
  siren: compact(item.siren),
  identity: {
    legalName: `${item.name} SAS`,
    name: item.name,
    sector: item.sector,
    vatNumber: '',
    address: '12 rue des Artisans',
    postalCode: '69007',
    city: 'Lyon',
    managerId: 'cl',
    portalEnabled: true,
  },
  contacts: [{ name: 'Claire Besson', title: 'Credit manager', email: 'c.besson@materiauxdelta.example', phone: '04 72 00 00 00', isMain: true }],
  mandates: [
    withState({
      id: `${item.id}-m1`,
      startsOn: '2024-03-12',
      endsOn: null,
      amicableRateBp: Number.parseInt(item.fee, 10) * 100,
      litigationRateBp: 1200,
      openingFeeCents: 1500,
      planMonthsWithoutConsent: 6,
      discountMaxBp: 500,
      litigationNeedsConsent: true,
      deferSmallRemittances: false,
      interestMode: 'ECB_PLUS_TEN',
      contractRateBp: null,
      fixedIndemnity: true,
      reportingDay: 5,
      scenario: 'BUSINESS',
      hasContract: item.id === 'md',
    }),
  ],
  updatedBy: null,
  updatedAt: '12 mars 2024',
  iban: 'FR7630001007941234567894521',
  bankAccount: {
    id: `${item.id}-b1`,
    holder: `${item.name} SAS`,
    masked: 'FR76 •••• •••• 4521',
    bic: 'PSSTFRPPXXX',
    since: '2024-03-12',
    confirmed: { on: '2024-03-12', with: 'Claire Besson' },
    enteredBy: 'Camille Laurent',
    enteredByMe: false,
  },
});
let added: CreditorListItem[] = [];
let files = new Map<string, Stored>();
export const resetCreditors = () => {
  added = [];
  files = new Map();
};
const listed = () => [...CREDITORS, ...added];
const fileOf = (id: unknown): Stored | null => {
  const item = listed().find((entry) => entry.id === (id === 'demo' ? 'md' : id));
  if (!item) return null;
  const known = files.get(item.id) ?? firstFile(item);
  files.set(item.id, known);
  return known;
};
const onFile = (allow: (session: Session) => boolean, resolve: (file: Stored, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(allow, (info, session) => {
    const file = fileOf(info.params.id);
    return file ? resolve(file, session, info) : notFound();
  });
const onAccount = (resolve: (file: Stored, session: Session, info: Info) => Response | Promise<Response>) =>
  onFile(administers, (file, session, info) => (file.bankAccount?.id === info.params.accountId ? resolve(file, session, info) : notFound()));
const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
creditorFacts.list = () => listed().map(({ id, name }) => ({ id, name }));
creditorFacts.mandateOf = (id) => {
  const mandate = fileOf(id)?.mandates.find((item) => item.state === 'CURRENT');
  return mandate
    ? {
        id: mandate.id,
        since: mandate.startsOn,
        scenario: mandate.scenario,
        fixedIndemnity: mandate.fixedIndemnity,
        hasContract: mandate.hasContract,
        terms: [
          { label: 'Honoraires amiable', value: `${percent(mandate.amicableRateBp)} HT du recouvré` },
          { label: 'Indemnité forfaitaire', value: mandate.fixedIndemnity ? '40 € / facture (professionnels)' : 'Non réclamée' },
        ],
      }
    : null;
};
creditorFacts.nextOf = (id) => fileOf(id)?.mandates.find((item) => item.state === 'TO_COME')?.startsOn ?? null;
const knownManager = (id: string | null) => id === null || id in OFFICERS;

const formHandlers = [
  http.get(
    '/api/creditors/choices',
    guarded(manages, (_info, session) =>
      HttpResponse.json({
        managers: Object.entries(OFFICERS).map(([id, officer]) => ({ id, name: officer.name })),
        bankAccess: administers(session) ? 'EDIT' : 'NONE',
        defaults: { amicableRateBp: 800 },
      }),
    ),
  ),
  http.post(
    '/api/creditors',
    guarded<Info>(manages, async ({ request }, session) => {
      const body = (await request.json()) as NewCreditor;
      const siren = compact(body.siren);
      if (!isValidSiren(siren)) return invalidField('siren');
      if (listed().some((item) => compact(item.siren) === siren)) return HttpResponse.json({ code: 'SIREN_TAKEN' }, { status: 409 });
      if (!knownManager(body.identity.managerId)) return invalidField('identity.managerId');
      const id = `c${added.length + 1}`;
      const item: CreditorListItem = {
        id,
        initials: body.identity.name.slice(0, 2).toUpperCase(),
        name: body.identity.name,
        sector: body.identity.sector,
        siren: siren.replace(/(\d{3})(?=\d)/gu, '$1 '),
        debtors: 0,
        invoices: 0,
        outstanding: 0,
        recovered: 0,
        rate: 0,
        fee: `${body.mandate.amicableRateBp / 100} % HT`,
        owner: '',
        status: 'ACTIVE',
        statusLabel: 'Mandat actif',
      };
      added = [...added, item];
      files.set(id, {
        id,
        version: 1,
        siren,
        identity: body.identity,
        contacts: body.contacts,
        mandates: [withState({ ...body.mandate, id: `${id}-m1`, hasContract: false })],
        updatedBy: `${session.firstName} ${session.lastName}`,
        updatedAt: 'À l’instant',
        iban: '',
        bankAccount: null,
      });
      audit(session, 'Créancier créé');
      return HttpResponse.json({ id });
    }),
  ),
  http.get(
    '/api/creditors/:id/file',
    onFile(manages, ({ iban: _iban, ...file }, session) =>
      HttpResponse.json({
        ...file,
        openCases: readable(session).filter((item) => item.creditorId === file.id).length,
        bankAccess: administers(session) ? 'EDIT' : 'NONE',
        // As the API: whoever typed it is told so, and does not confirm it (question 142).
        bankAccount:
          administers(session) && file.bankAccount
            ? { ...file.bankAccount, enteredByMe: file.bankAccount.enteredBy === `${session.firstName} ${session.lastName}` }
            : null,
      }),
    ),
  ),
  http.put(
    '/api/creditors/:id',
    onFile(manages, async (file, session, { request }) => {
      const body = (await request.json()) as z.infer<typeof creditorChanges>;
      if (!knownManager(body.identity.managerId)) return invalidField('identity.managerId');
      if (body.version !== file.version) return changed();
      files.set(file.id, {
        ...file,
        version: file.version + 1,
        identity: body.identity,
        contacts: body.contacts,
        updatedBy: `${session.firstName} ${session.lastName}`,
        updatedAt: 'À l’instant',
      });
      audit(session, 'Fiche d’un créancier modifiée');
      return done();
    }),
  ),
  http.post(
    '/api/creditors/:id/amendments',
    onFile(manages, async (file, session, { request }) => {
      const { amends, mandate } = (await request.json()) as z.infer<typeof mandateAmendment>;
      const [last, ...older] = file.mandates;
      if (!last || last.id !== amends) return changed();
      if (mandate.startsOn <= last.startsOn) return invalidField('mandate.startsOn');
      const closed = withState({ ...last, endsOn: last.endsOn && last.endsOn < mandate.startsOn ? last.endsOn : dayBefore(mandate.startsOn) });
      files.set(file.id, {
        ...file,
        mandates: [withState({ ...mandate, id: `${file.id}-m${file.mandates.length + 1}`, hasContract: false }), closed, ...older],
      });
      audit(session, 'Avenant enregistré');
      return done();
    }),
  ),
  http.post(
    '/api/creditors/:id/bank-accounts',
    onFile(administers, async (file, session, { request }) => {
      const { replaces, account } = (await request.json()) as z.infer<typeof bankAccountChange>;
      if ((file.bankAccount?.id ?? null) !== replaces) return changed();
      const iban = compact(account.iban);
      files.set(file.id, {
        ...file,
        iban,
        bankAccount: {
          id: `${file.id}-b${Date.now()}`,
          holder: account.holder,
          masked: `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`,
          bic: compact(account.bic),
          since: TODAY,
          confirmed: null,
          enteredBy: `${session.firstName} ${session.lastName}`,
          enteredByMe: false,
        },
      });
      audit(session, 'Compte de reversement enregistré', 'ADMINISTRATIVE');
      return done();
    }),
  ),
  http.post(
    '/api/creditors/:id/bank-accounts/:accountId/confirm',
    // As the API: one that is no longer in force, or is already confirmed, has changed.
    onFile(administers, async (file, session, { request, params }) => {
      const { confirmedWith } = (await request.json()) as { confirmedWith: string };
      if (!file.bankAccount || file.bankAccount.id !== params.accountId || file.bankAccount.confirmed) return changed();
      if (file.bankAccount.enteredBy === `${session.firstName} ${session.lastName}`) return HttpResponse.json({ code: 'SAME_PERSON' }, { status: 409 });
      files.set(file.id, { ...file, bankAccount: { ...file.bankAccount, confirmed: { on: TODAY, with: confirmedWith } } });
      audit(session, 'Compte de reversement confirmé par téléphone', 'ADMINISTRATIVE');
      return done();
    }),
  ),
  http.post(
    '/api/creditors/:id/bank-accounts/:accountId/reveal',
    onAccount((file, session) => {
      audit(session, 'IBAN d’un créancier affiché', 'ADMINISTRATIVE');
      return HttpResponse.json({ iban: file.iban.replace(/(.{4})(?=.)/gu, '$1 ') });
    }),
  ),
];

export const creditorHandlers = [
  ...formHandlers,
  http.get(
    '/api/creditors',
    guarded(staffWithCases, (_info, session) => HttpResponse.json(listed().filter((item) => canSeeCreditor(session, item.id)))),
  ),
  http.get(
    '/api/creditors/:id',
    guarded(staffWithCases, ({ params }: { request: Request; params: Record<string, unknown> }, session) => {
      const item = listed().find((creditor) => creditor.id === (params.id === 'demo' ? 'md' : params.id));
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
