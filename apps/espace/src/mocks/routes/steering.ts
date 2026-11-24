import {
  UNIQUE_ROLES,
  newMember,
  staffRole,
  canAccessBilling,
  hasDelegation,
  ROLE_LABELS,
  type Agent,
  type BillingData,
  type Member,
  type NotificationItem,
  type Role,
  type Session,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { mayRead } from '../visibility';

type Info = { request: Request; params: Record<string, unknown> };
const n = (
  id: string,
  kind: NotificationItem['kind'],
  unread: boolean,
  day: NotificationItem['day'],
  time: string,
  text: string,
  meta: string,
  href: string,
  cta: string,
): NotificationItem => ({ id, kind, unread, day, time, text, meta, href, cta });
const seedNotifications = () => [
  n(
    'n1',
    'PAYMENT',
    true,
    'TODAY',
    '11:07',
    'Nordis Logistique a versé 12 500 € : promesse de paiement tenue',
    'Énergies Rhône',
    '/debiteurs/nordis',
    'Rapprocher',
  ),
  n(
    'n2',
    'MESSAGE',
    true,
    'TODAY',
    '10:52',
    'Julien Ferrand (Bâtiplus SAS) demande un échéancier pour le solde de 29 600 €',
    'Matériaux Delta',
    '/e-mails',
    'Répondre',
  ),
  n(
    'n3',
    'LITIGATION',
    true,
    'TODAY',
    '10:15',
    'Le délai de mise en demeure de Charpentes Bellet expire dans 9 jours',
    'Matériaux Delta',
    '/contentieux',
    'Voir la procédure',
  ),
  n(
    'n4',
    'CREDITOR',
    true,
    'TODAY',
    '09:30',
    'Matériaux Delta a validé l’échéancier de 8 mois pour Bâtiplus SAS',
    'Accord du créancier',
    '/echeanciers',
    'Envoyer au débiteur',
  ),
  n('n5', 'REMINDER', false, 'TODAY', '08:00', '7 relances automatiques envoyées ce matin', 'Scénario B2B standard', '/relances', 'Voir l’agenda'),
  n(
    'n6',
    'MESSAGE',
    false,
    'YESTERDAY',
    '16:41',
    'E-mail non remis à Garage Valmont : adresse invalide',
    'TransAlp Leasing',
    '/e-mails',
    'Corriger le contact',
  ),
  n('n7', 'SYSTEM', false, 'YESTERDAY', '14:20', 'Import terminé : 96 nouvelles factures pour Médiatel', 'Import CSV', '/creanciers/mt', 'Voir le créancier'),
  n('n8', 'CREDITOR', false, 'YESTERDAY', '11:05', 'Médiatel : mandat à renouveler avant le 31/12/2026', 'Convention', '/creanciers', 'Ouvrir le mandat'),
  n(
    'n9',
    'REMINDER',
    false,
    'EARLIER',
    '19 nov.',
    'Échéance impayée : Transports Lemaire (5 250 €), deuxième incident',
    'TransAlp Leasing',
    '/echeanciers',
    'Voir le plan',
  ),
  n(
    'n10',
    'LITIGATION',
    false,
    'EARLIER',
    '17 nov.',
    'Saisie-attribution effectuée sur le compte de Transports Lemaire',
    'Étude Garnier',
    '/contentieux',
    'Voir l’acte',
  ),
  n(
    'n11',
    'SYSTEM',
    false,
    'EARLIER',
    '15 nov.',
    'Reversement de 38 420 € effectué à Matériaux Delta',
    'Relevé envoyé au créancier',
    '/creanciers/md',
    'Voir le relevé',
  ),
];
let notifications = seedNotifications();
const scheduled = [
  { id: 'r1', title: 'Rapport mensuel créancier', meta: 'Chaque créancier · le 5 du mois · PDF par e-mail', active: true },
  { id: 'r2', title: 'Relevé de reversement', meta: 'Avec chaque reversement · PDF + CSV', active: true },
  { id: 'r3', title: 'Synthèse hebdomadaire équipe', meta: 'Lundi 8:00 · direction', active: true },
  { id: 'r4', title: 'Balance âgée détaillée', meta: 'Trimestriel · Excel', active: false },
];
const k = (label: string, value: string, delta: string, tone: 'good' | 'bad' | 'neutral' = 'good') => ({ label, value, delta, tone });
const bars = (rows: [string, number, number][]) =>
  rows.map(([label, entrusted, recovered]) => ({ label, entrusted: entrusted * 100_000, recovered: recovered * 100_000 }));
const PERIODS = {
  month: {
    text: 'Novembre 2026 (au 21/11)',
    kpis: [
      k('Recouvré', '186 420 €', '▲ 12,4 % vs octobre'),
      k('Nouvelles créances confiées', '214 300 €', '96 factures', 'neutral'),
      k('Taux de recouvrement', '58 %', '▲ 2 pts'),
      k('DSO moyen', '47 j', '▼ 3 j'),
      k('Honoraires', '15 880 €', '▲ 9 %'),
    ],
    bars: bars([
      ['1–7', 52, 58],
      ['8–14', 61, 64],
      ['15–21', 58, 64],
      ['22–30', 43, 0],
    ]),
  },
  quarter: {
    text: '4e trimestre 2026 (au 21/11)',
    kpis: [
      k('Recouvré', '352 400 €', '▲ 6,8 % vs T3'),
      k('Nouvelles créances confiées', '442 300 €', '204 factures', 'neutral'),
      k('Taux de recouvrement', '56 %', '▲ 1 pt'),
      k('DSO moyen', '48 j', '▼ 2 j'),
      k('Honoraires', '29 960 €', '▲ 5 %'),
    ],
    bars: bars([
      ['Octobre', 228, 166],
      ['Novembre', 214, 186],
      ['Décembre', 0, 0],
    ]),
  },
  year: {
    text: 'Année 2026 (au 21/11)',
    kpis: [
      k('Recouvré', '1 578 000 €', '▲ 18 % vs 2025'),
      k('Nouvelles créances confiées', '2,18 M€', '1 108 factures', 'neutral'),
      k('Taux de recouvrement', '55 %', '▲ 4 pts'),
      k('DSO moyen', '47 j', '▼ 6 j'),
      k('Irrécouvrable', '38 200 €', '▲ 2 dossiers', 'bad'),
    ],
    bars: bars([
      ['Janv.', 182, 118],
      ['Févr.', 176, 124],
      ['Mars', 205, 131],
      ['Avr.', 190, 127],
      ['Mai', 198, 138],
      ['Juin', 211, 142],
      ['Juil.', 189, 151],
      ['Août', 154, 128],
      ['Sept.', 230, 167],
      ['Oct.', 228, 166],
      ['Nov.', 214, 186],
      ['Déc.', 0, 0],
    ]),
  },
};
const AGENTS: Agent[] = [
  {
    id: 'cl',
    name: 'Camille Laurent',
    roleLabel: 'Responsable du recouvrement',
    scope: 'Tous les créanciers',
    presence: 'CALL',
    status: 'En appel · 04:32',
    calls: 18,
    goal: 40,
    reached: 11,
    promises: 4,
    promisedAmount: 3120000,
    cashed: 830000,
    average: '3 min 42',
    book: '24 dossiers prioritaires · 186 300 €',
    kept: 78,
    login: '8:02',
    pause: '18 min',
    live: 'En communication avec Bâtiplus SAS depuis 04:32',
    hours: [2, 3, 2, 1, 0, 2, 3, 3, 2, 0, 0],
  },
  {
    id: 'hb',
    name: 'Hugo Benali',
    roleLabel: 'Gestionnaire de créances',
    scope: 'Médiatel',
    presence: 'AVAILABLE',
    status: 'Disponible',
    calls: 31,
    goal: 40,
    reached: 17,
    promises: 6,
    promisedAmount: 3890000,
    cashed: 410000,
    average: '4 min 18',
    book: '52 débiteurs · 244 900 €',
    kept: 71,
    login: '7:55',
    pause: '25 min',
    live: null,
    hours: [3, 4, 4, 3, 1, 3, 4, 5, 4, 0, 0],
  },
  {
    id: 'sm',
    name: 'Sarah Morel',
    roleLabel: 'Gestionnaire de créances',
    scope: 'Énergies Rhône, Crédit Horizon',
    presence: 'PAUSE',
    status: 'En pause · 9 min',
    calls: 26,
    goal: 40,
    reached: 16,
    promises: 5,
    promisedAmount: 2260000,
    cashed: 1250000,
    average: '4 min 21',
    book: '99 débiteurs · 421 650 €',
    kept: 83,
    login: '8:10',
    pause: '41 min (en pause depuis 9 min)',
    live: null,
    hours: [2, 4, 3, 3, 1, 2, 4, 3, 4, 0, 0],
  },
  {
    id: 'tg',
    name: 'Thomas Giraud',
    roleLabel: 'Gestionnaire de créances',
    scope: 'Matériaux Delta, TransAlp Leasing',
    presence: 'AWAY',
    status: 'En congé · retour lundi',
    calls: 0,
    goal: 0,
    reached: 0,
    promises: 0,
    promisedAmount: 0,
    cashed: 0,
    average: '—',
    book: '97 débiteurs · 618 010 €',
    kept: 74,
    login: '—',
    pause: '—',
    live: null,
    hours: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];
const c = (
  id: string,
  time: string,
  agentId: string,
  debtor: string,
  caseId: string | null,
  creditor: string,
  siret: string,
  direction: 'OUT' | 'IN',
  duration: string,
  result: string,
  tone: string,
  recording: string,
) => ({
  id,
  time,
  agentId,
  agent: AGENTS.find((item) => item.id === agentId)?.name ?? '',
  caseId,
  debtor,
  creditor,
  siret,
  direction,
  duration,
  result,
  tone,
  recording,
});
const CALLS = [
  c('c1', '11:48', 'cl', 'Bâtiplus SAS', 'demo', 'Matériaux Delta', '512 334 871 00088', 'OUT', 'En cours', 'En cours', 'success', 'LIVE'),
  c('c2', '11:42', 'hb', 'Groupe Hélio', 'helio', 'Médiatel', '319 935 185 00011', 'OUT', '6 min 12', 'Échéancier', 'warning', 'AVAILABLE'),
  c('c3', '11:31', 'sm', 'Nordis Logistique', 'nordis', 'Énergies Rhône', '854 323 193 00045', 'IN', '3 min 05', 'Déjà payé', 'success', 'AVAILABLE'),
  c('c4', '11:20', 'cl', 'Cabinet Orsay', 'orsay', 'Médiatel', '725 276 018 00084', 'OUT', '0 min 40', 'Messagerie', 'neutral', 'NONE'),
  c('c5', '11:12', 'hb', 'Studio Pixelia', null, 'Médiatel', '979 217 429 00013', 'OUT', '4 min 47', 'Litige', 'violet', 'AVAILABLE'),
  c('c6', '10:58', 'sm', 'Fromagerie Durand', 'durand', 'Énergies Rhône', '655 979 714 00012', 'OUT', '5 min 30', 'Promesse', 'success', 'AVAILABLE'),
  c('c7', '10:41', 'cl', 'Garage Valmont', 'valmont', 'TransAlp Leasing', '193 786 571 00094', 'OUT', '2 min 18', 'Rappel demandé', 'info', 'AVAILABLE'),
  c('c8', '10:26', 'hb', 'Électricité Fabre', null, 'Énergies Rhône', '887 789 329 00018', 'OUT', '0 min 25', 'Mauvais numéro', 'danger', 'NONE'),
  c('c9', '10:09', 'sm', 'Boulangerie Morin', null, 'Crédit Horizon', '181 003 393 00012', 'IN', '3 min 51', 'Promesse', 'success', 'AVAILABLE'),
];
const m = (
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  role: Role,
  extension: string | null,
  twoFactor: boolean,
  cases: number,
  lastSeen: string,
  status: Member['status'] = 'ACTIVE',
  creditor: string | null = null,
): Member => ({
  id,
  firstName,
  lastName,
  email,
  role,
  extension,
  twoFactor,
  cases,
  lastSeen,
  status,
  creditor,
  sessions: status === 'ACTIVE' ? 1 : 0,
  twoFactorRequired: role === 'DEVELOPER',
  activity: status === 'ACTIVE' ? [{ what: 'Connexion réussie', when: lastSeen }] : [],
});
const seedMembers = () => [
  m('ad', 'Marie', 'Dubreuil', 'mdu@legarec.fr', 'DIRECTOR', null, false, 1, 'Hier'),
  m('cl', 'Camille', 'Laurent', 'cl@legarec.fr', 'COLLECTION_MANAGER', '101', true, 24, 'En ligne'),
  m('hb', 'Hugo', 'Benali', 'hb@legarec.fr', 'CLAIMS_OFFICER', '102', true, 52, 'En ligne'),
  m('sm', 'Sarah', 'Morel', 'sm@legarec.fr', 'CLAIMS_OFFICER', '103', false, 99, 'En ligne'),
  m('tg', 'Thomas', 'Giraud', 'tg@legarec.fr', 'CLAIMS_OFFICER', null, true, 97, 'En congé'),
  m('dev', 'Nora', 'Petit', 'support@legarec.fr', 'DEVELOPER', null, true, 0, 'Aujourd’hui'),
  m('nk', 'Nadia', 'Kaci', 'nk@legarec.fr', 'CLAIMS_OFFICER', null, false, 0, 'Invitée le 20/11', 'INVITED'),
  m('lp', 'Lucas', 'Perrin', 'lp@legarec.fr', 'CLAIMS_OFFICER', null, false, 0, '2 sept.', 'DISABLED'),
  m('cb', 'Claire', 'Besson', 'c.besson@materiauxdelta.example', 'CREDITOR', null, false, 0, '18 nov.', 'ACTIVE', 'Matériaux Delta'),
];
const MEMBER_CREDITORS = [
  { id: 'md', name: 'Matériaux Delta' },
  { id: 'er', name: 'Énergies Rhône' },
  { id: 'mt', name: 'Médiatel' },
  { id: 'tl', name: 'TransAlp Leasing' },
  { id: 'ch', name: 'Crédit Horizon' },
];
/** Account support is part of the technical delegation; the Director's own account is out of the manager's reach. */
const manages = (session: Session) => administers(session) || hasDelegation(session, 'TECHNICAL');
let members = seedMembers();
export const administers = (session: Session) => session.role === 'DIRECTOR' || hasDelegation(session, 'ADMINISTRATIVE');
const supports = (session: Session) => session.role === 'DEVELOPER';
const steers = (session: Session) => session.role === 'DIRECTOR' || session.role === 'COLLECTION_MANAGER';

const doc = (
  number: string,
  type: 'INVOICE' | 'QUOTE' | 'CONTRACT',
  client: string,
  siren: string,
  subject: string,
  date: string,
  amount: number | null,
  duration: string | null,
  status: string,
  tone: BillingData['documents'][number]['tone'],
) => ({ id: number, type, number, client, idLine: siren ? `SIREN ${siren}` : 'SIREN à renseigner', subject, date, amount, duration, status, tone });
const seedDocuments = () => [
  doc('FA-2026-0117', 'INVOICE', 'Énergies Rhône', '626 018 154', 'Commission octobre 2026', '2026-11-02', 984528, null, 'Payée', 'success'),
  doc('FA-2026-0116', 'INVOICE', 'Matériaux Delta', '401 228 975', 'Commission octobre 2026', '2026-11-02', 531264, null, 'Déduite du reversement', 'success'),
  doc('FA-2026-0115', 'INVOICE', 'Médiatel', '183 016 617', 'Commission octobre 2026', '2026-11-02', 390240, null, 'Envoyée', 'marine'),
  doc('FA-2026-0114', 'INVOICE', 'TransAlp Leasing', '418 609 137', 'Refacturation de frais de procédure', '2026-10-28', 128400, null, 'En retard', 'danger'),
  doc('FA-2026-0113', 'INVOICE', 'Crédit Horizon', '199 603 085', 'Commission septembre 2026', '2026-10-02', 219600, null, 'En retard', 'danger'),
  doc('DE-2026-0042', 'QUOTE', 'Prospect', '', 'Recouvrement amiable · Boulangeries Rivaud', '2026-11-18', 1224000, null, 'En attente', 'warning'),
  doc('DE-2026-0041', 'QUOTE', 'Prospect', '', 'Audit de portefeuille · Cliniques Saône', '2026-11-12', 144000, null, 'Accepté', 'success'),
  doc('DE-2026-0040', 'QUOTE', 'TransAlp Leasing', '418 609 137', 'Recouvrement judiciaire', '2026-11-05', 63600, null, 'En attente', 'warning'),
  doc('DE-2026-0039', 'QUOTE', 'Prospect', '', 'Recouvrement amiable · Atelier Nova', '2026-10-21', 480000, null, 'Refusé', 'neutral'),
  doc(
    'CT-2026-0009',
    'CONTRACT',
    'TransAlp Leasing',
    '418 609 137',
    'Avenant tarifaire · taux 7,5 %',
    '2026-11-16',
    null,
    '12 mois',
    'En attente de signature',
    'warning',
  ),
  doc(
    'CT-2026-0008',
    'CONTRACT',
    'Matériaux Delta',
    '401 228 975',
    'Convention de recouvrement amiable',
    '2026-01-01',
    null,
    'jusqu’au 31/12/2026',
    'À renouveler',
    'danger',
  ),
  doc('CT-2026-0007', 'CONTRACT', 'Énergies Rhône', '626 018 154', 'Convention de recouvrement amiable', '2026-02-15', null, '12 mois', 'Signée', 'success'),
  doc('CT-2026-0006', 'CONTRACT', 'Médiatel', '183 016 617', 'Convention de recouvrement amiable', '2026-03-01', null, '12 mois', 'Signée', 'success'),
  doc('CT-2026-0005', 'CONTRACT', 'Crédit Horizon', '199 603 085', 'Convention et mandat judiciaire', '2026-04-10', null, '24 mois', 'Signée', 'success'),
];
let documents = seedDocuments();
/** Accounts that may hold cases: active, and with a role that handles them. */
export const mayHoldCases = (id: string) =>
  members.some((item) => item.id === id && item.status === 'ACTIVE' && ['CLAIMS_OFFICER', 'COLLECTION_MANAGER', 'DIRECTOR'].includes(item.role));
export const resetSteering = () => {
  notifications = seedNotifications();
  members = seedMembers();
  documents = seedDocuments();
};
const CLIENTS = [
  ['md', 'Matériaux Delta', 'Matériaux Delta SAS', '401 228 975', '14 rue des Tanneurs, 69007 Lyon', 'Claire Besson, directrice financière'],
  ['er', 'Énergies Rhône', 'Énergies Rhône SA', '626 018 154', '8 quai Perrache, 69002 Lyon', 'Olivier Marchal, DAF'],
  ['mt', 'Médiatel', 'Médiatel SAS', '183 016 617', '41 avenue Jean Jaurès, 69007 Lyon', 'Inès Carpentier, responsable crédit client'],
  ['tl', 'TransAlp Leasing', 'TransAlp Leasing SAS', '418 609 137', '3 place Grenette, 38000 Grenoble', 'Bruno Vial, directeur des risques'],
  ['ch', 'Crédit Horizon', 'Crédit Horizon SA', '199 603 085', '22 cours Lafayette, 69003 Lyon', 'Nathalie Roy, responsable contentieux'],
  ['px', 'Nouveau prospect…', 'Prospect à renseigner', '', 'Adresse à compléter', 'Signataire à compléter'],
].map(([id, name, legal, siren, address, signer]) => ({
  id: id ?? '',
  name: name ?? '',
  legal: legal ?? '',
  siren: siren ?? '',
  address: address ?? '',
  signer: signer ?? '',
}));

export const steeringHandlers = [
  http.get(
    '/api/notifications',
    guarded(
      () => true,
      (_info, session) => HttpResponse.json(notifications.filter((item) => mayRead(session, item.text))),
    ),
  ),
  http.put(
    '/api/notifications',
    guarded<Info>(
      () => true,
      async ({ request }) => {
        const { ids, unread } = (await request.json()) as { ids: string[]; unread: boolean };
        notifications = notifications.map((item) => (ids.includes(item.id) ? { ...item, unread } : item));
        return done();
      },
    ),
  ),
  http.get(
    '/api/reports',
    guarded(staffWithCases, (_info, session) => {
      const personal = session.role === 'CLAIMS_OFFICER';
      const team = [
        { id: 'cl', name: 'Camille Laurent', cases: 96, calls: 412, promises: 58, recovered: 63290000, rate: 59 },
        { id: 'hb', name: 'Hugo Benali', cases: 82, calls: 365, promises: 44, recovered: 49140000, rate: 52 },
        { id: 'sm', name: 'Sarah Morel', cases: 70, calls: 298, promises: 41, recovered: 45370000, rate: 54 },
      ];
      const own = { ...PERIODS, year: { ...PERIODS.year, kpis: [k('Recouvré', '491 400 €', '▲ 9 % vs 2025'), k('Taux de recouvrement', '52 %', '▲ 1 pt')] } };
      return HttpResponse.json({
        scope: personal ? 'PERSONAL' : session.role === 'DIRECTOR' ? 'GLOBAL' : 'TEAM',
        periods: personal ? own : PERIODS,
        outcomes: [
          { label: 'Recouvré intégralement', percent: 61, tone: 'success' },
          { label: 'Recouvré partiellement', percent: 17, tone: 'teal' },
          { label: 'Échéancier en cours', percent: 9, tone: 'warning' },
          { label: 'Rendu au créancier', percent: 8, tone: 'neutral' },
          { label: 'Irrécouvrable', percent: 5, tone: 'danger' },
        ],
        promisesKept: 78,
        team: personal ? team.filter((item) => item.id === session.userId) : team,
        scheduled: personal ? [] : scheduled,
      });
    }),
  ),
  http.put(
    '/api/reports/scheduled/:id',
    guarded<Info>(steers, async ({ params, request }) => {
      const item = scheduled.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      item.active = ((await request.json()) as { active: boolean }).active;
      return done();
    }),
  ),
  http.get(
    '/api/team',
    guarded<Info>(steers, ({ request }) => {
      const factor = { day: 1, week: 4.7, month: 19.7 }[new URL(request.url).searchParams.get('period') ?? 'day'] ?? 1;
      const scale = (value: number) => Math.round(value * factor);
      return HttpResponse.json({
        agents: AGENTS.map((item) => ({
          ...item,
          calls: scale(item.calls),
          goal: scale(item.goal),
          reached: scale(item.reached),
          promises: scale(item.promises),
          promisedAmount: scale(item.promisedAmount),
          cashed: scale(item.cashed),
        })),
        calls: CALLS,
        callsTotal: 75,
        alerts: [
          'Sarah Morel est en pause depuis 9 min (41 min cumulées aujourd’hui).',
          'Camille Laurent : 18 appels sur 40, sous les 50 % de l’objectif à midi.',
          'Thomas Giraud est en congé : ses 4 rappels du jour sont à réattribuer.',
          '2 appels entrants manqués à rappeler (Cabinet Orsay, Garage Valmont).',
        ],
      });
    }),
  ),
  http.get(
    '/api/members',
    guarded(
      (session) => administers(session) || supports(session) || session.role === 'COLLECTION_MANAGER',
      (_info, session) =>
        HttpResponse.json({
          // The Developer supports the staff: no creditor account and no figure about cases.
          members: supports(session) ? members.filter((item) => item.role !== 'CREDITOR').map((item) => ({ ...item, cases: 0 })) : members,
          canSupport: manages(session),
          creditors: administers(session) ? MEMBER_CREDITORS : [],
          canInvite: administers(session),
          canDisable: administers(session),
          canEditExtension: supports(session) && hasDelegation(session, 'TECHNICAL'),
        }),
    ),
  ),
  http.post(
    '/api/members',
    guarded<Info>(administers, async ({ request }, session) => {
      const parsed = newMember.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      const body = parsed.data;
      const creditor = body.role === 'CREDITOR' ? MEMBER_CREDITORS.find((item) => item.id === body.creditorId) : null;
      if (creditor === undefined) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      if (members.some((item) => item.email.toLowerCase() === body.email.toLowerCase())) return HttpResponse.json({ code: 'EMAIL_TAKEN' }, { status: 409 });
      const holder = UNIQUE_ROLES.includes(body.role) ? members.find((item) => item.role === body.role && item.status !== 'DISABLED') : undefined;
      if (holder)
        return HttpResponse.json({ code: 'ROLE_TAKEN', role: ROLE_LABELS[body.role], holder: `${holder.firstName} ${holder.lastName}` }, { status: 409 });
      audit(session, `Invitation envoyée (${ROLE_LABELS[body.role]})`, 'ADMINISTRATIVE');
      members = [
        ...members,
        m(crypto.randomUUID(), body.firstName, body.lastName, body.email, body.role, null, false, 0, 'Invité', 'INVITED', creditor?.name ?? null),
      ];
      return done();
    }),
  ),
  http.delete(
    '/api/members/:id',
    guarded<Info>(administers, ({ params }, session) => {
      audit(session, 'Invitation annulée', 'ADMINISTRATIVE');
      members = members.filter((item) => item.id !== params.id || item.status !== 'INVITED');
      return done();
    }),
  ),
  http.post(
    '/api/members/:id/disable',
    guarded<Info>(administers, ({ params }, session) => {
      const item = members.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      if (item.role === 'DIRECTOR' || item.id === session.userId) return forbidden();
      audit(session, `Compte désactivé (${ROLE_LABELS[item.role]})`, 'ADMINISTRATIVE');
      item.status = 'DISABLED';
      item.cases = 0;
      return done();
    }),
  ),
  http.put(
    '/api/members/:id/role',
    guarded<Info>(administers, async ({ params, request }, session) => {
      const item = members.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      const parsed = staffRole.safeParse(((await request.json()) as { role: unknown }).role);
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      const role = parsed.data;
      // A creditor account never becomes a staff account, and nobody changes their own role.
      if (item.id === session.userId || item.role === 'CREDITOR' || item.role === 'DIRECTOR' || item.status !== 'ACTIVE') return forbidden();
      const holder = UNIQUE_ROLES.includes(role) ? members.find((entry) => entry.role === role && entry.status !== 'DISABLED' && entry !== item) : undefined;
      if (holder) return HttpResponse.json({ code: 'ROLE_TAKEN', holder: `${holder.firstName} ${holder.lastName}` }, { status: 409 });
      audit(session, `Rôle modifié : ${ROLE_LABELS[item.role]} → ${ROLE_LABELS[role]}`, 'ADMINISTRATIVE');
      Object.assign(item, { role, twoFactorRequired: role === 'DEVELOPER' || item.twoFactorRequired });
      return done();
    }),
  ),
  http.post(
    '/api/members/:id/:action',
    guarded<Info>(manages, ({ params }, session) => {
      const item = members.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      if (session.role === 'DEVELOPER' && item.role === 'CREDITOR') return forbidden();
      if (item.role === 'DIRECTOR' && session.role === 'COLLECTION_MANAGER') return forbidden();
      const delegation = session.role === 'DEVELOPER' ? 'TECHNICAL' : 'ADMINISTRATIVE';
      switch (params.action) {
        case 'reset-link':
          audit(session, 'Lien de réinitialisation envoyé', delegation);
          return done();
        case 'require-2fa':
          // Nobody imposes it on the Director.
          if (item.role === 'DIRECTOR' && session.role !== 'DIRECTOR') return forbidden();
          item.twoFactorRequired = true;
          audit(session, 'Double authentification exigée', delegation);
          return done();
        case 'enable':
          if (!administers(session)) return forbidden();
          if (item.status !== 'DISABLED') return forbidden();
          {
            const holder = UNIQUE_ROLES.includes(item.role) ? members.find((entry) => entry.role === item.role && entry.status !== 'DISABLED') : undefined;
            if (holder) return HttpResponse.json({ code: 'ROLE_TAKEN', holder: `${holder.firstName} ${holder.lastName}` }, { status: 409 });
          }
          item.status = 'ACTIVE';
          audit(session, 'Compte réactivé', delegation);
          return done();
        default:
          return notFound();
      }
    }),
  ),
  http.put(
    '/api/members/:id/extension',
    guarded<Info>(
      (session) => supports(session) && hasDelegation(session, 'TECHNICAL'),
      async ({ params, request }) => {
        const item = members.find((entry) => entry.id === params.id);
        if (!item) return notFound();
        item.extension = ((await request.json()) as { extension: string | null }).extension;
        return done();
      },
    ),
  ),
  http.get(
    '/api/billing',
    guarded(canAccessBilling, () =>
      HttpResponse.json({
        firm: {
          name: 'LEGAREC',
          address: '[ADRESSE DU CABINET]',
          phone: '01 87 88 02 98',
          siren: '[SIREN]',
          vat: '[N° TVA]',
          signer: 'Marie Dubreuil, direction',
        },
        clients: CLIENTS,
        documents,
        nextNumbers: { INVOICE: 'FA-2026-0118', QUOTE: 'DE-2026-0043', CONTRACT: 'CT-2026-0010' },
        stats: [
          { label: 'Facturé en 2026', value: '131 860 € HT', sub: 'commissions et frais refacturés' },
          { label: 'Facturé en novembre', value: '15 627 € HT', sub: '5 factures de commission' },
          { label: 'À encaisser', value: '3 480 €', sub: '2 factures en retard', tone: 'danger' },
          { label: 'Devis en attente', value: '2 · 12 876 €', sub: 'relance automatique à J+7', tone: 'warning' },
          { label: 'Contrats', value: '5 actifs', sub: '1 à renouveler, 1 à signer' },
        ],
      }),
    ),
  ),
  http.post(
    '/api/billing',
    guarded<Info>(canAccessBilling, async ({ request }) => {
      const body = (await request.json()) as { type: 'INVOICE' | 'QUOTE' | 'CONTRACT'; clientId: string; draft: boolean };
      const client = CLIENTS.find((item) => item.id === body.clientId);
      documents = [
        doc(
          `${{ INVOICE: 'FA-2026-0118', QUOTE: 'DE-2026-0043', CONTRACT: 'CT-2026-0010' }[body.type]}${body.draft ? ' (brouillon)' : ''}`,
          body.type,
          client?.name ?? '',
          client?.siren ?? '',
          'Créé depuis un modèle',
          '2026-11-21',
          body.type === 'CONTRACT' ? null : 602328,
          body.type === 'CONTRACT' ? '12 mois' : null,
          body.draft ? 'Brouillon' : 'Envoyé',
          body.draft ? 'neutral' : 'marine',
        ),
        ...documents,
      ];
      return done();
    }),
  ),
];
