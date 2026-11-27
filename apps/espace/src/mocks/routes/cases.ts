import {
  allocatePayment,
  isValidSiret,
  sirenOfNumber,
  type CaseInvoice,
  type NewCase,
  canActOnCase,
  canReadCase,
  hasDelegation,
  newPayment,
  type CaseDetail,
  type CaseFilter,
  type CaseListItem,
  type GdprRequest,
  type Payment,
  type Role,
  type Session,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { creditorFacts } from './creditorFacts';
import { addGdprRequest } from './settings';
import { mayHoldCases } from './steering';

export const OFFICERS: Record<string, { name: string; role: Role }> = {
  cl: { name: 'Camille Laurent', role: 'COLLECTION_MANAGER' },
  hb: { name: 'Hugo Benali', role: 'CLAIMS_OFFICER' },
  sm: { name: 'Sarah Morel', role: 'CLAIMS_OFFICER' },
  ad: { name: 'Marie Dubreuil', role: 'DIRECTOR' },
};
type Stored = Omit<CaseListItem, 'canAct' | 'officer'> & { group: CaseFilter };
const row = (
  id: string,
  reference: string,
  name: string,
  siret: string,
  creditorId: string,
  creditor: string,
  invoicesLabel: string,
  euros: number,
  daysLate: number | null,
  group: CaseFilter,
  status: CaseListItem['status'],
  statusLabel: string,
  nextAction: string,
  nextDate: string,
  officerId: string | null,
): Stored => ({
  id,
  reference,
  name,
  identifier: siret === 'Particulier' ? 'Particulier' : `SIRET ${siret}`,
  creditorId,
  creditor,
  invoicesLabel,
  amount: euros * 100,
  daysLate,
  group,
  status,
  statusLabel,
  nextAction,
  nextDate,
  officerId,
});

const seed = (): Stored[] => [
  row(
    'demo',
    'LGR-2026-00142',
    'Bâtiplus SAS',
    '512 334 871 00088',
    'md',
    'Matériaux Delta',
    '3 factures',
    48200,
    64,
    'overdue',
    'OVERDUE',
    'En retard',
    'Appel téléphonique',
    'Aujourd’hui',
    'cl',
  ),
  row(
    'helio',
    'LGR-2026-00151',
    'Groupe Hélio',
    '319 935 185 00011',
    'mt',
    'Médiatel',
    '2 factures',
    36750,
    38,
    'reminder',
    'REMINDER',
    'Relance 2',
    'Relance n°3 (ferme)',
    '25 nov.',
    'hb',
  ),
  row(
    'valmont',
    'LGR-2026-00098',
    'Garage Valmont',
    '193 786 571 00094',
    'tl',
    'TransAlp Leasing',
    '4 factures',
    23900,
    97,
    'overdue',
    'FORMAL_NOTICE',
    'Mise en demeure',
    'Transfert contentieux',
    '28 nov.',
    'cl',
  ),
  row(
    'nordis',
    'LGR-2026-00163',
    'Nordis Logistique',
    '854 323 193 00045',
    'er',
    'Énergies Rhône',
    '1 facture',
    21400,
    45,
    'promise',
    'PROMISE',
    'Promesse',
    'Contrôler paiement',
    'Aujourd’hui',
    'sm',
  ),
  row(
    'mistral',
    'LGR-2026-00170',
    'Atelier Mistral',
    '975 749 110 00089',
    'md',
    'Matériaux Delta',
    '1 facture',
    18320,
    52,
    'dispute',
    'DISPUTE',
    'Litige',
    'Réponse au litige',
    '22 nov.',
    'hb',
  ),
  row(
    'orsay',
    'LGR-2026-00177',
    'Cabinet Orsay',
    '725 276 018 00084',
    'mt',
    'Médiatel',
    'Échéancier 2/6',
    14800,
    12,
    'promise',
    'PLAN',
    'Échéancier',
    'Échéance n°3',
    '5 déc.',
    'sm',
  ),
  row(
    'durand',
    'LGR-2026-00181',
    'Fromagerie Durand',
    '655 979 714 00012',
    'er',
    'Énergies Rhône',
    '2 factures',
    6240,
    21,
    'reminder',
    'REMINDER',
    'Relance 1',
    'Relance n°2',
    '24 nov.',
    'cl',
  ),
  row(
    'castel',
    'LGR-2026-00119',
    'Imprimerie Castel',
    '571 049 741 00069',
    'tl',
    'TransAlp Leasing',
    '1 facture',
    0,
    null,
    'settled',
    'SETTLED',
    'Réglé',
    'Clôturer le dossier',
    '—',
    'hb',
  ),
  row(
    'meunier',
    'LGR-2026-00203',
    'Paul Meunier',
    'Particulier',
    'ch',
    'Crédit Horizon',
    '1 facture',
    2150,
    18,
    'reminder',
    'REMINDER',
    'Relance 1',
    'Relance n°2',
    '30 nov.',
    null,
  ),
  row(
    'lagarde',
    'LGR-2026-00087',
    'Hôtel Lagarde',
    '402 118 556 00027',
    'er',
    'Énergies Rhône',
    '2 factures',
    11900,
    73,
    'overdue',
    'OVERDUE',
    'En retard',
    'Appel téléphonique',
    'Demain',
    'ad',
  ),
];
let cases = seed();
/** What was typed for the cases opened here; absent for those of the mockup. */
let opened: Record<string, { body: NewCase; invoices: CaseInvoice[]; version: number }> = {};
let payments: Record<string, Payment[]> = {};
let extra: Record<string, { history: CaseDetail['history']; exchanges: CaseDetail['exchanges'] }> = {};
/** Fictitious access codes, only held by the simulated API. */
const codes = new Map<string, string>();
const codeVersions = new Map<string, number>();
export const resetCases = () => {
  codes.clear();
  codeVersions.clear();
  cases = seed();
  opened = {};
  payments = {};
  extra = {};
};

const ownership = (item: Stored) => ({ officerId: item.officerId, officerRole: item.officerId ? (OFFICERS[item.officerId]?.role ?? 'CLAIMS_OFFICER') : null });
export const readable = (session: Session) => cases.filter((item) => canReadCase(session, ownership(item)));
export const allNames = () => cases.map((item) => item.name);
export const actsOn = (session: Session, caseId: string) => cases.some((item) => item.id === caseId && canActOnCase(session, ownership(item)));
/** Addresses recorded on a case: the only ones a message of that case may go to. */
export const contactsOf = (caseId: string) => (caseId === 'demo' ? ['compta@batiplus.example', 'j.ferrand@batiplus.example'] : [`contact@${caseId}.example`]);
/** Case behind a debtor's address, as the API would find it. */
export const caseOfEmail = (email: string) => cases.find((item) => contactsOf(item.id).includes(email.trim().toLowerCase()))?.id ?? null;
const toItem = (item: Stored, session: Session): CaseListItem => {
  const { group: _group, ...rest } = item;
  return { ...rest, officer: item.officerId ? (OFFICERS[item.officerId]?.name ?? null) : null, canAct: canActOnCase(session, ownership(item)) };
};
const find = (id: unknown) => cases.find((item) => item.id === id);
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const AGE: Record<string, [number, number]> = { '0-30': [0, 30], '31-60': [31, 60], '61-90': [61, 90], '90+': [91, 9999] };
/** Totals of the mockup for the whole firm; a role with a reduced scope gets its own counts. */
const FIRM: Record<CaseFilter, number> = { all: 248, overdue: 86, reminder: 72, promise: 41, dispute: 14, settled: 35, unassigned: 1 };

const log = (
  id: string,
  session: Session,
  title: string,
  detail: string,
  tone: CaseDetail['history'][number]['tone'] = 'info',
  onBehalfOf: string | null = null,
) => {
  const entry = (extra[id] ??= { history: [], exchanges: [] });
  entry.history.unshift({
    id: `${id}-${entry.history.length}`,
    title,
    detail,
    date: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date()),
    actor: `${session.firstName} ${session.lastName}`,
    onBehalfOf,
    tone,
  });
};

const TODAY = '2026-11-25';
const lateDays = (due: string) => Math.max(0, Math.round((Date.parse(TODAY) - Date.parse(due)) / 86_400_000));
const left = (invoices: CaseInvoice[]) => invoices.reduce((sum, invoice) => sum + invoice.left, 0);
const labelOf = (count: number) => `${count} facture${count > 1 ? 's' : ''}`;
const openedDetail = (item: Stored, { body, invoices }: { body: NewCase; invoices: CaseInvoice[] }, session: Session): CaseDetail => ({
  ...toItem(item, session),
  creditorRef: body.externalReference || '—',
  isIndividual: body.kind === 'INDIVIDUAL',
  correctable: correctableOf(item, session),
  principal: left(invoices),
  interest: 0,
  fees: body.kind === 'INDIVIDUAL' ? 0 : invoices.filter((invoice) => lateDays(invoice.dueOn) > 0).length * 4000,
  remindersSent: 0,
  remindersTotal: 0,
  risk: null,
  contacts: body.contacts.map((contact, index) => ({ id: `n${index}`, kind: contact.kind, value: contact.value, verified: false })),
  mainContact: {
    name: body.contactName || 'Aucun interlocuteur',
    title: body.contactTitle,
    phone: body.contacts.find((contact) => contact.kind === 'PHONE')?.value ?? '',
    email: body.contacts.find((contact) => contact.kind === 'EMAIL')?.value ?? '',
    address: `${body.address}, ${body.postalCode} ${body.city}`,
  },
  aiSummary: null,
  invoices: invoices.map((invoice) => ({
    number: invoice.number,
    issued: invoice.issuedOn,
    due: invoice.dueOn,
    amount: invoice.left,
    daysLate: lateDays(invoice.dueOn),
  })),
  history: extra[item.id]?.history ?? [],
  exchanges: [],
  payments: payments[item.id] ?? [],
  documents: [],
  mandate: { sector: '', terms: creditorFacts.mandateOf(item.creditorId)?.terms ?? [] },
  otherClaims: [],
  scenario: [],
  firstLetter: null,
  contactLimit: null,
});
const opens = (session: Session) => session.role === 'DIRECTOR' || session.role === 'COLLECTION_MANAGER';
/** As the API: the Director and the manager may correct the debtor, from a case they act on (question 138). */
const correctableOf = (item: Stored, session: Session): CaseDetail['correctable'] =>
  opens(session) && canActOnCase(session, ownership(item))
    ? { name: item.name, kind: item.identifier === 'Particulier' ? 'INDIVIDUAL' : 'COMPANY', hasSiren: item.identifier !== 'Particulier' }
    : null;
/** Company behind a case of the mockup, or of one opened here. */
const sirenOf = (item: Stored) => item.identifier.replace(/\D/gu, '').slice(0, 9);

function detailOf(item: Stored, session: Session): CaseDetail {
  const typed = opened[item.id];
  if (typed) return openedDetail(item, typed, session);
  const isDemo = item.id === 'demo';
  const interest = isDemo ? 136600 : Math.round(item.amount * 0.02);
  const fees = item.identifier === 'Particulier' ? 0 : isDemo ? 12000 : 4000;
  const changes = extra[item.id] ?? { history: [], exchanges: [] };
  return {
    ...toItem(item, session),
    creditorRef: isDemo ? 'CLI-08812' : `CLI-${item.reference.slice(-4)}`,
    isIndividual: item.identifier === 'Particulier',
    correctable: correctableOf(item, session),
    principal: item.amount,
    interest,
    fees,
    remindersSent: 2,
    remindersTotal: 4,
    risk: item.identifier === 'Particulier' ? null : { label: 'Élevé', reason: 'Deux promesses non tenues et retard supérieur à 60 jours' },
    contacts: [
      { id: 'p1', kind: 'PHONE', value: '04 72 18 45 90', verified: true },
      { id: 'p2', kind: 'PHONE', value: '06 12 48 77 03', verified: false },
      ...contactsOf(item.id).map((value, index) => ({ id: `e${index + 1}`, kind: 'EMAIL' as const, value, verified: index === 0 })),
    ],
    mainContact: {
      name: 'Julien Ferrand',
      title: 'gérant',
      phone: '04 72 18 45 90',
      email: contactsOf(item.id)[0] ?? '',
      address: '12 rue des Artisans, 69007 Lyon',
    },
    aiSummary: {
      events: 23,
      updated: 'il y a 2 min',
      lines: [
        { k: 'Situation', v: '48 200 € dus à Matériaux Delta sur 3 factures, la plus ancienne en retard de 68 jours.' },
        { k: 'Promesses', v: '2 promesses depuis septembre : celle du 15/10 n’a pas été tenue ; la dernière (18 600 € au plus tard le 28/11) est en cours.' },
        { k: 'Dernier contact', v: 'Appel du 21/11 avec Julien Ferrand (gérant), confirmé par e-mail le même jour.' },
        { k: 'Blocage', v: 'Trésorerie tendue après un retard de chantier. Demande d’échéancier en 4 mensualités pour le solde de 29 600 €.' },
        { k: 'Suggestion', v: 'Vérifier le virement le 29/11, puis soumettre l’échéancier 4 × 7 400 € à Matériaux Delta.' },
      ],
    },
    invoices: isDemo
      ? [
          { number: 'F-2026-0712', issued: '2026-08-15', due: '2026-09-14', amount: 1860000, daysLate: 68 },
          { number: 'F-2026-0745', issued: '2026-08-28', due: '2026-09-27', amount: 1640000, daysLate: 55 },
          { number: 'F-2026-0790', issued: '2026-09-10', due: '2026-10-10', amount: 1320000, daysLate: 42 },
        ]
      : [{ number: `F-${item.reference.slice(4)}`, issued: '2026-08-15', due: '2026-09-14', amount: item.amount, daysLate: item.daysLate ?? 0 }],
    history: [
      ...changes.history,
      {
        id: 'h1',
        title: 'Appel sans réponse',
        detail: 'Message laissé à J. Ferrand, rappel demandé.',
        date: '19 nov. 2026',
        actor: 'Camille Laurent',
        onBehalfOf: null,
        tone: 'danger',
      },
      {
        id: 'h2',
        title: 'Relance n°2 envoyée par e-mail',
        detail: 'Modèle « Relance ferme » · ouvert le 13 nov.',
        date: '12 nov. 2026',
        actor: 'automatique',
        onBehalfOf: null,
        tone: 'info',
      },
      {
        id: 'h3',
        title: 'Promesse de paiement non tenue',
        detail: 'Paiement de 18 600 € annoncé pour le 31 oct.',
        date: '3 nov. 2026',
        actor: 'Camille Laurent',
        onBehalfOf: null,
        tone: 'warning',
      },
      {
        id: 'h4',
        title: 'Relance n°1 envoyée par e-mail',
        detail: 'Modèle « Rappel amiable »',
        date: '21 sept. 2026',
        actor: 'automatique',
        onBehalfOf: null,
        tone: 'info',
      },
      {
        id: 'h5',
        title: 'Dossier ouvert',
        detail: 'Créé automatiquement depuis la comptabilité',
        date: '15 sept. 2026',
        actor: '',
        onBehalfOf: null,
        tone: 'neutral',
      },
    ],
    exchanges: [
      ...changes.exchanges,
      {
        id: 'x1',
        channel: 'EMAIL_IN',
        title: 'Julien Ferrand demande un échéancier',
        text: 'Confirme 18 600 € au 28/11 et propose d’étaler le solde de 29 600 € en quatre fois.',
        when: '21/11 09:42',
        delivery: null,
        acknowledgmentId: null,
        verified: true,
      },
      {
        id: 'x2',
        channel: 'CALL',
        title: 'Appel sortant · 4 min 32',
        text: 'Promesse de paiement de 18 600 € pour le 28/11, demande d’échéancier pour le solde.',
        when: '21/11 09:00',
        delivery: null,
        acknowledgmentId: null,
        verified: true,
      },
      {
        id: 'x3',
        channel: 'PORTAL_IN',
        title: 'Message de l’espace débiteur',
        text: 'Vous trouverez ci-joint notre justificatif de virement.',
        when: '20/11 17:20',
        delivery: null,
        acknowledgmentId: null,
        verified: false,
      },
      {
        id: 'x4',
        channel: 'REGISTERED_LETTER',
        title: 'Premier courrier recommandé',
        text: 'Distribué le 16/09 à Lyon.',
        when: '15/09 10:00',
        delivery: 'ACKNOWLEDGED',
        acknowledgmentId: 'ar-0142',
        verified: true,
      },
      {
        id: 'x5',
        channel: 'EMAIL_OUT',
        title: 'Relance n°2 – relance ferme',
        text: 'Ouverte le 13/11 à 08:15.',
        when: '12/11 09:00',
        delivery: 'DELIVERED',
        acknowledgmentId: null,
        verified: true,
      },
      {
        id: 'x6',
        channel: 'SMS_OUT',
        title: 'Relance SMS avec lien de l’espace débiteur',
        text: 'Distribué. Aucun clic sur le lien.',
        when: '05/10 10:00',
        delivery: 'DELIVERED',
        acknowledgmentId: null,
        verified: true,
      },
    ],
    payments:
      payments[item.id] ??
      (isDemo
        ? (payments.demo = [
            {
              id: 'pay1',
              method: 'CHEQUE',
              amount: 250000,
              status: 'DEPOSITED',
              receivedOn: '2026-11-10',
              depositedOn: '2026-11-12',
              chequeNumber: '4581207',
              bank: 'Banque de démonstration',
              label: null,
              receiptId: null,
              allocation: { interest: 136600, principal: 113400, fees: 0 },
              version: 1,
            },
          ])
        : []),
    documents: [
      { id: 'd1', name: 'Relance n°2 – relance ferme.pdf', meta: 'Envoyée le 12/11/2026 · ouverte le 13/11', kind: 'PDF' },
      { id: 'd2', name: 'Proposition d’échéancier (8 mois).docx', meta: 'Brouillon du 21/11/2026', kind: 'DOCX' },
      { id: 'd3', name: 'F-2026-0712.pdf', meta: 'Facture du créancier · 18 600 €', kind: 'PDF' },
      { id: 'd4', name: 'F-2026-0745.pdf', meta: 'Facture du créancier · 16 400 €', kind: 'PDF' },
      { id: 'd5', name: 'F-2026-0790.pdf', meta: 'Facture du créancier · 13 200 €', kind: 'PDF' },
    ],
    mandate: {
      sector: 'Négoce de matériaux BTP',
      terms: [
        { label: 'Honoraires', value: '8 % HT du recouvré' },
        { label: 'Échéancier sans accord', value: '≤ 6 mois' },
        { label: 'Remise autorisée', value: '≤ 5 %' },
        { label: 'Contentieux', value: 'Sur accord écrit' },
      ],
    },
    otherClaims: isDemo ? [{ creditor: 'Énergies Rhône', invoices: 1, amount: 324000 }] : [],
    scenario: [
      { label: 'Rappel amiable (e-mail)', when: 'J+7 · envoyé', state: 'DONE' },
      { label: 'Relance ferme (e-mail)', when: 'J+30 · envoyé', state: 'DONE' },
      { label: 'Relance téléphonique + courrier', when: 'J+60 · à faire', state: 'NEXT' },
      { label: 'Mise en demeure (LRAR)', when: 'J+75', state: 'TODO' },
    ],
    firstLetter: { reference: 'LR-2026-0142', date: '2026-09-15' },
    contactLimit: null,
  };
}

type Info = { request: Request; params: Record<string, unknown> };
/** Every change on a case goes through here: the API refuses what the role cannot do. */
const acting = (resolve: (item: Stored, session: Session, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(staffWithCases, (info, session) => {
    const item = find(info.params.id);
    if (!item || !canReadCase(session, ownership(item))) return notFound();
    return canActOnCase(session, ownership(item)) ? resolve(item, session, info) : forbidden();
  });
/** As the API: « Bâtiplus SAS » and « BATIPLUS » are the same name. */
const plainName = (name: string) =>
  normalize(name)
    .replaceAll('.', '')
    .replaceAll('&', ' et ')
    .replace(/\b(?:sasu?|sarl|eurl|sa|snc|scs|sca|sci|scop|selarl|selas|ei|eirl|gie|ste|societe)\b/gu, '')
    .replace(/[^a-z0-9]/gu, '');
const administers = (session: Session) => session.role === 'DIRECTOR' || hasDelegation(session, 'ADMINISTRATIVE');
const bulk = (title: string, apply: (item: Stored, body: { officerId?: string; reason?: string }) => void, managerOnly = false) =>
  guarded<Info>(
    (session) => staffWithCases(session) && (!managerOnly || administers(session)),
    async ({ request }, session) => {
      const body = (await request.json()) as { ids: string[]; officerId?: string; reason?: string };
      const items = body.ids.map(find);
      // Only an active account whose role handles cases may receive one.
      if (managerOnly && !mayHoldCases(body.officerId ?? '')) return HttpResponse.json({ code: 'INVALID_OFFICER' }, { status: 422 });
      // Assigning is a right of the Director, whose delegate acts on their behalf.
      if (items.some((item) => !item || !(managerOnly ? canReadCase(session, ownership(item)) : canActOnCase(session, ownership(item))))) return forbidden();
      const onBehalfOf = managerOnly && session.role !== 'DIRECTOR' ? session.directorName : null;
      for (const item of items)
        if (item) {
          apply(item, body);
          log(item.id, session, title, body.reason ?? '', 'info', onBehalfOf);
        }
      return done();
    },
  );

export const caseHandlers = [
  http.post(
    '/api/cases/search',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const params = new URL(request.url).searchParams;
      const { query } = (await request.json()) as { query: string };
      const q = normalize(query.trim());
      const visible = readable(session).filter((item) => params.get('creditor') === 'all' || item.creditorId === params.get('creditor'));
      const status = params.get('status') as CaseFilter;
      const age = AGE[params.get('age') ?? ''];
      const list = visible.filter(
        (item) =>
          (status === 'all' || (status === 'unassigned' ? item.officerId === null : item.group === status)) &&
          (params.get('officer') === 'all' || item.officerId === params.get('officer')) &&
          (!age || (item.daysLate !== null && item.daysLate >= age[0] && item.daysLate <= age[1])) &&
          (!q ||
            normalize(`${item.name} ${item.reference} ${item.identifier} ${item.creditor}`).includes(q) ||
            (q.replace(/\s/g, '').length >= 3 && normalize(item.identifier).replace(/\s/g, '').includes(q.replace(/\s/g, '')))),
      );
      const whole = session.role !== 'CLAIMS_OFFICER' && params.get('creditor') === 'all';
      const count = (group: CaseFilter) =>
        group === 'all'
          ? visible.length
          : group === 'unassigned'
            ? visible.filter((item) => item.officerId === null).length
            : visible.filter((item) => item.group === group).length;
      const counts = Object.fromEntries(
        (Object.keys(FIRM) as CaseFilter[]).map((group) => [group, whole && group !== 'unassigned' ? FIRM[group] : count(group)]),
      );
      if (session.role !== 'COLLECTION_MANAGER') counts.unassigned = 0;
      const filtered = !!q || params.get('officer') !== 'all' || !!age;
      return HttpResponse.json({
        items: list.map((item) => toItem(item, session)),
        total: filtered ? list.length : counts[status],
        counts,
        stats: whole
          ? {
              outstanding: 128456000,
              invoices: 1942,
              overdue: 86,
              overdueAmount: 41230000,
              promises: 7,
              promisesToday: 2,
              recovered: 18642000,
              targetRatio: 107,
            }
          : {
              outstanding: visible.reduce((sum, item) => sum + item.amount, 0),
              invoices: visible.length * 2,
              overdue: count('overdue'),
              overdueAmount: visible.filter((item) => item.group === 'overdue').reduce((sum, item) => sum + item.amount, 0),
              promises: count('promise'),
              promisesToday: 1,
              recovered: 4120000,
              targetRatio: 82,
            },
      });
    }),
  ),
  http.post(
    '/api/cases/reminders',
    bulk('Relance programmée', () => {}),
  ),
  http.post(
    '/api/cases/litigation',
    bulk('Passage en contentieux demandé', (item) => {
      item.status = 'LITIGATION';
      item.statusLabel = 'Contentieux';
    }),
  ),
  http.post(
    '/api/cases/assign',
    bulk(
      'Dossier attribué',
      (item, body) => {
        item.officerId = body.officerId ?? null;
      },
      true,
    ),
  ),
  http.get(
    '/api/cases/choices',
    guarded(opens, (_info, session) =>
      HttpResponse.json({
        creditors: creditorFacts.list(),
        officers: Object.entries(OFFICERS)
          .filter(([id]) => id !== session.userId)
          .map(([id, officer]) => ({ id, name: officer.name })),
        mayAssign: administers(session),
      }),
    ),
  ),
  http.post(
    '/api/cases/check',
    guarded<Info>(opens, async ({ request }, session) => {
      const { creditorId, number } = (await request.json()) as { creditorId: string; number: string };
      if (!creditorFacts.list().some((item) => item.id === creditorId)) return notFound();
      const siren = sirenOfNumber(number);
      const same = /^\d{9}$/u.test(siren) ? readable(session).filter((item) => sirenOf(item) === siren && item.status !== 'SETTLED') : [];
      const open = same.find((item) => item.creditorId === creditorId);
      const mandate = creditorFacts.mandateOf(creditorId);
      const [first] = same;
      return HttpResponse.json({
        mandate,
        known: first ? { name: first.name, kind: 'COMPANY' } : null,
        startsOn: mandate ? null : creditorFacts.nextOf(creditorId),
        open: open
          ? {
              id: open.id,
              reference: open.reference,
              name: open.name,
              version: opened[open.id]?.version ?? 1,
              officer: open.officerId ? (OFFICERS[open.officerId]?.name ?? null) : null,
              canAct: canActOnCase(session, ownership(open)),
            }
          : null,
        others: same
          .filter((item) => item.creditorId !== creditorId)
          .map((item) => ({ creditor: item.creditor, invoices: Number.parseInt(item.invoicesLabel, 10) || 1 })),
      });
    }),
  ),
  http.post(
    '/api/cases',
    guarded<Info>(opens, async ({ request }, session) => {
      const body = (await request.json()) as NewCase;
      const creditor = creditorFacts.list().find((item) => item.id === body.creditorId);
      if (!creditor) return notFound();
      const mandate = creditorFacts.mandateOf(body.creditorId);
      if (!mandate) return HttpResponse.json({ code: 'NO_MANDATE' }, { status: 409 });
      if (mandate.id !== body.mandateId) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      const siren = sirenOfNumber(body.number);
      const known = body.kind !== 'INDIVIDUAL' ? cases.find((item) => sirenOf(item) === siren) : undefined;
      if (known && (body.kind !== 'COMPANY' || plainName(known.name) !== plainName(body.name)))
        return HttpResponse.json({ code: 'DEBTOR_MISMATCH' }, { status: 409 });
      if (body.kind !== 'INDIVIDUAL' && cases.some((item) => item.creditorId === body.creditorId && sirenOf(item) === siren && item.status !== 'SETTLED'))
        return HttpResponse.json({ code: 'CASE_EXISTS' }, { status: 409 });
      const rank = Object.keys(opened).length + 1;
      const id = `new${rank}`;
      const reference = `LGR-2026-${String(300 + rank).padStart(5, '0')}`;
      const late = Math.max(...body.invoices.map((invoice) => lateDays(invoice.dueOn)));
      const digits = body.number.replace(/\D/gu, '');
      cases = [
        ...cases,
        {
          id,
          reference,
          name: cases.find((item) => body.kind !== 'INDIVIDUAL' && sirenOf(item) === siren)?.name ?? body.name,
          identifier:
            body.kind === 'INDIVIDUAL'
              ? 'Particulier'
              : `${isValidSiret(body.number) ? 'SIRET' : 'SIREN'} ${digits.replace(/(\d{3})(\d{3})(\d{3})(\d{5})?/u, (_all, a: string, b: string, c: string, d?: string) => [a, b, c, d].filter(Boolean).join(' '))}`,
          creditorId: body.creditorId,
          creditor: creditor.name,
          invoicesLabel: labelOf(body.invoices.length),
          amount: left(body.invoices),
          daysLate: late > 0 ? late : null,
          group: 'all',
          status: 'NEW',
          statusLabel: 'Nouveau',
          nextAction: 'Envoyer le premier courrier',
          nextDate: '—',
          officerId: body.toMe ? session.userId : null,
        },
      ];
      opened[id] = { body, invoices: body.invoices, version: 1 };
      log(id, session, 'Dossier ouvert', labelOf(body.invoices.length));
      return HttpResponse.json({ id, reference });
    }),
  ),
  http.post(
    '/api/cases/:id/invoices',
    guarded<Info>(opens, async ({ params, request }, session) => {
      const item = find(params.id);
      if (!item || !canReadCase(session, ownership(item))) return notFound();
      if (!canActOnCase(session, ownership(item))) return forbidden();
      const { version, invoices } = (await request.json()) as { version: number; invoices: CaseInvoice[] };
      if (item.status === 'SETTLED') return HttpResponse.json({ code: 'CASE_CLOSED' }, { status: 409 });
      const typed = opened[item.id];
      if (version !== (typed?.version ?? 1)) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      if (typed?.invoices.some((known) => invoices.some((invoice) => invoice.number.toLowerCase() === known.number.toLowerCase())))
        return HttpResponse.json({ code: 'INVOICE_EXISTS' }, { status: 409 });
      if (typed) opened[item.id] = { ...typed, invoices: [...typed.invoices, ...invoices], version: version + 1 };
      const count = (Number.parseInt(item.invoicesLabel, 10) || 0) + invoices.length;
      cases = cases.map((entry) => (entry.id === item.id ? { ...entry, amount: entry.amount + left(invoices), invoicesLabel: labelOf(count) } : entry));
      log(item.id, session, 'Factures ajoutées', labelOf(invoices.length));
      return done();
    }),
  ),
  http.get(
    '/api/cases/:id',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      const item = find(params.id);
      if (!item) return notFound();
      // As the API: a case of someone else is refused, and told to exist to the team alone (question 141).
      if (!canReadCase(session, ownership(item))) return forbidden();
      if (session.role === 'DIRECTOR' && item.officerId !== session.userId && !extra[item.id]?.history.some((entry) => entry.title === 'Dossier consulté'))
        log(item.id, session, 'Dossier consulté', 'Consultation par le Directeur', 'neutral');
      return HttpResponse.json(detailOf(item, session));
    }),
  ),
  http.put(
    '/api/cases/:id/debtor',
    guarded<Info>(staffWithCases, async ({ params, request }, session) => {
      // As the API: the Director and the manager alone, then the cases they read.
      if (!opens(session)) return forbidden();
      const item = find(params.id);
      if (!item || !canReadCase(session, ownership(item))) return notFound();
      if (!canActOnCase(session, ownership(item))) return forbidden();
      const body = (await request.json()) as { kind: string; name: string; seen: string };
      if (body.kind === 'INDIVIDUAL' && item.identifier !== 'Particulier') return HttpResponse.json({ code: 'INVALID', fields: ['kind'] }, { status: 422 });
      if (body.seen !== item.name) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      // As the API: in all the cases of the debtor, each one noting it.
      for (const other of cases.filter((candidate) => candidate.name === body.seen && candidate.identifier === item.identifier)) {
        other.name = body.name.trim();
        log(other.id, session, 'Débiteur corrigé', `Ancien nom : ${body.seen}`);
      }
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/notes',
    // As the API: whoever acts on the case, kept from the creditor.
    acting(async (item, session, { request }) => {
      const { text } = (await request.json()) as { text: string };
      if (!text.trim()) return HttpResponse.json({ code: 'INVALID', fields: ['text'] }, { status: 422 });
      log(item.id, session, 'Note', text.trim());
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/reminders',
    acting(async (item, session, { request }) => {
      const { channel, template } = (await request.json()) as { channel: string; template: 'FRIENDLY' | 'FIRM' | 'FORMAL_NOTICE' };
      // As the API: texts come with lot R, the registered letter with the letters (question 210).
      if (channel !== 'EMAIL') return HttpResponse.json({ code: 'NOT_AVAILABLE' }, { status: 409 });
      log(item.id, session, 'Relance envoyée', `E-mail · niveau ${{ FRIENDLY: 1, FIRM: 2, FORMAL_NOTICE: 3 }[template]}`);
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/ai-summary',
    acting(() => done()),
  ),
  http.post(
    '/api/cases/:id/ai-summary/report',
    acting(() => done()),
  ),
  http.get(
    '/api/cases/:id/access-code',
    // As the API: read only once the case is closed (question 140).
    acting((item) =>
      HttpResponse.json({
        code: codes.get(item.id) ?? 'KXPM',
        version: codeVersions.get(item.id) ?? 1,
        closed: item.status === 'SETTLED' || item.status === 'LOST',
      }),
    ),
  ),
  http.post(
    '/api/cases/:id/access-code/regenerate',
    acting(async (item, session, { request }) => {
      if (item.status === 'SETTLED') return HttpResponse.json({ code: 'CASE_CLOSED' }, { status: 409 });
      const known = codeVersions.get(item.id) ?? 1;
      if (((await request.json()) as { version: number }).version !== known) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
      codeVersions.set(item.id, known + 1);
      codes.set(item.id, codes.get(item.id) === 'BRTV' ? 'HDZN' : 'BRTV');
      log(item.id, session, 'Code d’accès régénéré', 'Ancien code inutilisable', 'warning');
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/portal-messages',
    acting(async (item, session, { request }) => {
      const { text } = (await request.json()) as { text: string };
      log(item.id, session, 'Réponse dans l’espace débiteur', '');
      extra[item.id]?.exchanges.unshift({
        id: `out${Date.now()}`,
        channel: 'PORTAL_OUT',
        title: 'Réponse du cabinet',
        text,
        when: 'à l’instant',
        delivery: 'SENT',
        acknowledgmentId: null,
        verified: true,
      });
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/payments',
    acting(async (item, session, { request }) => {
      const body = newPayment.parse(await request.json());
      const detail = detailOf(item, session);
      const { remainder: _remainder, ...allocation } = allocatePayment(body.amount, detail);
      const definitive = body.method === 'TRANSFER' && body.reconciled;
      payments[item.id] = [
        ...detail.payments,
        {
          id: `pay${detail.payments.length + 1}`,
          method: body.method,
          amount: body.amount,
          status: body.method === 'CHEQUE' ? (body.depositedOn ? 'DEPOSITED' : 'RECEIVED') : definitive ? 'RECONCILED' : 'TO_RECONCILE',
          receivedOn: body.receivedOn,
          depositedOn: body.method === 'CHEQUE' ? body.depositedOn : null,
          chequeNumber: body.method === 'CHEQUE' ? body.chequeNumber : null,
          bank: body.method === 'CHEQUE' ? body.bank : null,
          label: body.method === 'TRANSFER' ? body.label : null,
          receiptId: definitive ? `q-${item.id}` : null,
          allocation,
          version: 1,
        },
      ];
      log(item.id, session, 'Paiement enregistré', body.method === 'CHEQUE' ? 'Chèque' : 'Virement', 'success');
      return done();
    }),
  ),
  http.put(
    '/api/cases/:id/payments/:paymentId',
    acting(async (item, session, { request, params }) => {
      const { status } = (await request.json()) as { status: 'CASHED' | 'BOUNCED' | 'RECONCILED' };
      payments[item.id] = detailOf(item, session).payments.map((entry) =>
        entry.id === params.paymentId ? { ...entry, status, receiptId: status === 'BOUNCED' ? null : `q-${entry.id}`, version: entry.version + 1 } : entry,
      );
      log(item.id, session, status === 'BOUNCED' ? 'Chèque impayé' : 'Paiement définitif, quittance générée', '', status === 'BOUNCED' ? 'danger' : 'success');
      return done();
    }),
  ),
  http.post(
    '/api/gdpr/requests',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const { caseId, kind, origin } = (await request.json()) as { caseId: string; kind: GdprRequest['kind']; origin: string };
      const item = readable(session).find((entry) => entry.id === caseId);
      if (!item) return notFound();
      if (!actsOn(session, caseId)) return forbidden();
      addGdprRequest({ caseId, kind, origin, debtor: item.name });
      return done();
    }),
  ),
];
