import { newReminder, type LitigationCase, type PaymentPlan, type Reminder, type ReminderType, type Session } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { audit } from '../audit';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { actsOn, OFFICERS, readable } from './cases';

type Info = { request: Request; params: Record<string, unknown> };
/** Same access rules as cases, applied to anything owned by an officer. */
const reads = (session: Session, officerId: string | null) =>
  session.role === 'DIRECTOR' ||
  (session.role === 'COLLECTION_MANAGER'
    ? officerId === null || officerId === session.userId || OFFICERS[officerId]?.role === 'CLAIMS_OFFICER'
    : officerId === session.userId);
const acts = (session: Session, officerId: string | null) => (session.role === 'DIRECTOR' ? officerId === session.userId : reads(session, officerId));

const MD = ['md', 'Matériaux Delta'],
  ER = ['er', 'Énergies Rhône'],
  MT = ['mt', 'Médiatel'],
  TL = ['tl', 'TransAlp Leasing'],
  CH = ['ch', 'Crédit Horizon'],
  ALL = [null, 'Plusieurs créanciers'];
const EVENTS: [string, string | null, ReminderType, string, string | null, (string | null)[], string, boolean, boolean, string, string?][] = [
  ['11-03', '09:00', 'EMAIL', 'Fromagerie Durand', 'durand', ER, 'Relance n°1 (rappel amiable)', true, false, 'cl'],
  ['11-05', null, 'INSTALLMENT', 'SCI Les Tilleuls', null, MD, 'Échéance 2/4 · 3 517 €', true, false, 'cl'],
  ['11-05', null, 'INSTALLMENT', 'Cabinet Orsay', 'orsay', MT, 'Échéance 2/6 · 3 700 €', true, false, 'sm'],
  ['11-10', '10:00', 'SMS', 'Julie Mercier', null, CH, 'Rappel avant échéance', true, false, 'sm'],
  ['11-12', '09:00', 'EMAIL', 'Bâtiplus SAS', 'demo', MD, 'Relance n°2 (relance ferme)', true, false, 'cl'],
  ['11-12', '09:00', 'EMAIL', 'Groupe Hélio', 'helio', MT, 'Relance n°2 (relance ferme)', true, false, 'hb'],
  ['11-16', null, 'LETTER', 'Charpentes Bellet', null, MD, 'Mise en demeure LRAR', true, false, 'cl'],
  ['11-17', '14:00', 'CALL', 'Nordis Logistique', 'nordis', ER, 'Négociation du solde', true, false, 'sm'],
  ['11-19', '11:00', 'CALL', 'Bâtiplus SAS', 'demo', MD, 'Appel · sans réponse', true, false, 'cl'],
  ['11-21', '09:00', 'CALL', 'Bâtiplus SAS', 'demo', MD, 'Rappel de M. Ferrand · promesse obtenue', true, false, 'cl'],
  ['11-21', '10:00', 'SMS', 'Fromagerie Durand', 'durand', ER, 'Relance SMS J+21', false, true, 'cl'],
  ['11-21', '11:00', 'EMAIL', 'Atelier Mistral', 'mistral', MD, 'Répondre à la contestation', false, false, 'hb'],
  ['11-21', '15:00', 'CALL', 'Groupe Hélio', 'helio', MT, 'Confirmer la date de paiement', false, false, 'hb'],
  ['11-23', '10:30', 'CALL', 'Garage Valmont', 'valmont', TL, 'Dernier appel avant contentieux', false, false, 'cl'],
  ['11-23', '09:00', 'EMAIL', '5 débiteurs', null, ALL, 'Lot · relance n°2', false, true, 'cl'],
  ['11-24', '10:00', 'CALL', 'Groupe Hélio', 'helio', MT, 'Rappel programmé', false, false, 'hb'],
  ['11-24', '10:00', 'SMS', 'Fromagerie Durand', 'durand', ER, 'Relance SMS', false, true, 'cl', 'plafond de 3 contacts par semaine dépassé'],
  ['11-25', '09:00', 'EMAIL', 'Groupe Hélio', 'helio', MT, 'Relance n°3', false, true, 'hb'],
  ['11-26', null, 'LETTER', 'Menuiserie Rivoire', null, MD, 'Relance ferme par courrier', false, false, 'cl'],
  ['11-28', null, 'INSTALLMENT', 'Bâtiplus SAS', 'demo', MD, 'Promesse · 18 600 €', false, false, 'cl'],
  ['11-30', null, 'COURT_DEADLINE', 'Charpentes Bellet', null, MD, 'Fin du délai de mise en demeure', false, false, 'cl'],
  ['11-30', null, 'INSTALLMENT', 'Groupe Hélio', 'helio', MT, 'Promesse · 36 750 €', false, false, 'hb'],
  ['12-01', null, 'INSTALLMENT', 'Julie Mercier', null, CH, 'Échéance 8/12 · 240 €', false, false, 'sm'],
  ['12-02', null, 'COURT_DEADLINE', 'Menuiserie Arnal', null, MD, 'Fin du délai d’opposition', false, false, 'cl'],
  ['12-04', null, 'COURT_DEADLINE', 'Studio Pixelia', null, MT, 'Réponse en procédure simplifiée', false, false, 'hb'],
  ['12-05', null, 'INSTALLMENT', 'SCI Les Tilleuls', null, MD, 'Échéance 3/4 · 3 517 €', false, false, 'cl'],
  ['12-05', null, 'INSTALLMENT', 'Cabinet Orsay', 'orsay', MT, 'Échéance 3/6 · 3 700 €', false, false, 'sm'],
  ['12-05', null, 'COURT_DEADLINE', 'Transports Lemaire', null, TL, 'Versement des fonds saisis', false, false, 'cl'],
  ['12-07', '09:00', 'EMAIL', '12 débiteurs', null, ALL, 'Lot · relance n°1', false, true, 'cl'],
  ['12-10', null, 'LETTER', 'Garage Valmont', 'valmont', TL, 'Mise en demeure LRAR', false, false, 'cl'],
  ['12-15', null, 'INSTALLMENT', 'Bâtiplus SAS', 'demo', MD, 'Échéance 1/8 · 3 700 €', false, false, 'cl'],
  ['12-15', null, 'INSTALLMENT', 'Nordis Logistique', 'nordis', ER, 'Échéance 2/2 · 4 450 €', false, false, 'sm'],
];
const TODAY = '2026-11-21';
const planned = new Set<string>();
/** Default hours of Paramètres du cabinet > Relances; the caps wait for their values. */
const outsideHours = (type: ReminderType, date: string, time: string): string | null => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0) return 'Dimanche : hors des plages autorisées';
  const end = day === 6 && type === 'CALL' ? '12:00' : '19:00';
  return time && type !== 'LETTER' && (time < '09:00' || time > end) ? `${time} : hors des plages autorisées (09:00–${end})` : null;
};
const seedReminders = () =>
  EVENTS.map(([date, time, type, debtor, caseId, creditor, title, isDone, automatic, officerId, limit], index) => ({
    id: `r${index}`,
    date: `2026-${date}`,
    time,
    type,
    debtor,
    caseId,
    creditorId: creditor[0] ?? null,
    creditor: creditor[1] ?? '',
    title,
    done: isDone,
    automatic,
    officerId,
    limit: limit ?? null,
  }));
let reminders: Omit<Reminder, 'canAct'>[] = seedReminders();

const series = (total: number, dates: string[], paidCount: number, missedCount = 0): PaymentPlan['installments'] =>
  dates.map((date, index) => ({
    number: index + 1,
    date,
    amount: total * 100,
    state: index < paidCount ? 'PAID' : index < paidCount + missedCount ? 'MISSED' : 'UPCOMING',
  }));
const monthly = (start: string, count: number) =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(`${start}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + index);
    return date.toISOString().slice(0, 10);
  });
const plans: (Omit<PaymentPlan, 'canAct'> & { officerId: string })[] = [
  {
    id: 'p1',
    caseId: 'tilleuls',
    debtor: 'SCI Les Tilleuls',
    identifier: 'SIRET 442 366 712 00028',
    creditorId: 'md',
    creditor: 'Matériaux Delta',
    total: 1407000,
    state: 'ON_TRACK',
    method: 'TRANSFER',
    installments: series(3517, monthly('2026-10-05', 4), 2),
    officerId: 'cl',
  },
  {
    id: 'p2',
    caseId: 'orsay',
    debtor: 'Cabinet Orsay',
    identifier: 'SIRET 725 276 018 00084',
    creditorId: 'mt',
    creditor: 'Médiatel',
    total: 2220000,
    state: 'ON_TRACK',
    method: 'TRANSFER',
    installments: series(3700, monthly('2026-10-05', 6), 2),
    officerId: 'sm',
  },
  {
    id: 'p3',
    caseId: 'nordis',
    debtor: 'Nordis Logistique',
    identifier: 'SIRET 854 323 193 00045',
    creditorId: 'er',
    creditor: 'Énergies Rhône',
    total: 890000,
    state: 'LATE',
    method: 'TRANSFER',
    installments: series(4450, monthly('2026-11-15', 2), 0, 1),
    officerId: 'sm',
  },
  {
    id: 'p4',
    caseId: 'lemaire',
    debtor: 'Transports Lemaire',
    identifier: 'SIRET 868 426 842 00068',
    creditorId: 'tl',
    creditor: 'TransAlp Leasing',
    total: 3150000,
    state: 'DEFAULT',
    method: 'CHEQUE',
    installments: series(5250, monthly('2026-08-10', 6), 1, 2),
    officerId: 'cl',
  },
  {
    id: 'p5',
    caseId: 'demo',
    debtor: 'Bâtiplus SAS',
    identifier: 'SIRET 512 334 871 00088',
    creditorId: 'md',
    creditor: 'Matériaux Delta',
    total: 2960000,
    state: 'WAITING_CREDITOR',
    method: 'TRANSFER',
    installments: series(3700, monthly('2026-12-15', 8), 0),
    officerId: 'cl',
  },
  {
    id: 'p6',
    caseId: 'mercier',
    debtor: 'Julie Mercier',
    identifier: 'Particulier',
    creditorId: 'ch',
    creditor: 'Crédit Horizon',
    total: 288000,
    state: 'ON_TRACK',
    method: 'CHEQUE',
    installments: series(240, monthly('2026-05-01', 12), 7),
    officerId: 'sm',
  },
];
const seedRequests = () => [
  {
    id: 'q1',
    debtor: 'Bâtiplus SAS',
    creditor: 'Matériaux Delta',
    plan: '29 600 € en 8 mensualités de 3 700 € à partir du 15/12',
    origin: 'Proposé par Thomas Giraud · accord écrit du créancier reçu le 21/11',
    flag: 'Au-delà de 6 mois',
    tone: 'warning',
    decision: null as string | null,
  },
  {
    id: 'q2',
    debtor: 'Fromagerie Durand',
    creditor: 'Énergies Rhône',
    plan: '5 320 € en 3 mensualités de 1 774 €',
    origin: 'Demandé par le débiteur depuis son espace · 21/11 10:51',
    flag: 'Demande débiteur',
    tone: 'info',
    decision: null as string | null,
  },
  {
    id: 'q3',
    debtor: 'Garage Valmont',
    creditor: 'TransAlp Leasing',
    plan: '23 900 € en 12 mensualités de 1 992 €',
    origin: 'Proposé par Hugo Benali · accord du créancier en attente',
    flag: 'Accord créancier manquant',
    tone: 'danger',
    decision: null as string | null,
  },
];
let requests = seedRequests();

const act = (title: string, date: string, state: 'DONE' | 'NOW' | 'TODO') => ({ title, date, state });
const litigation: (Omit<LitigationCase, 'canAct' | 'actionSent'> & { officerId: string })[] = [
  {
    id: 'bellet',
    stage: 0,
    debtor: 'Charpentes Bellet',
    siret: '607 529 179 00006',
    creditorId: 'md',
    creditor: 'Matériaux Delta',
    amount: 2730000,
    step: 'Mise en demeure LRAR envoyée',
    due: 'Délai expire le 30/11',
    urgent: true,
    procedure: 'Mise en demeure',
    court: 'Tribunal de commerce de Lyon',
    partner: 'Me Durieux, avocat',
    action: 'Préparer la requête en injonction',
    officerId: 'cl',
    acts: [
      act('Relances amiables (3) sans résultat', '14/09 → 28/10/2026', 'DONE'),
      act('Accord du créancier pour le contentieux', '05/11/2026', 'DONE'),
      act('Mise en demeure LRAR — accusé de réception signé', '16/11/2026', 'NOW'),
      act('Requête en injonction de payer', 'Prévue après le 30/11/2026', 'TODO'),
    ],
  },
  {
    id: 'valmont',
    stage: 0,
    debtor: 'Garage Valmont',
    siret: '193 786 571 00094',
    creditorId: 'tl',
    creditor: 'TransAlp Leasing',
    amount: 2390000,
    step: 'Accord créancier demandé',
    due: 'En attente depuis 3 j',
    urgent: false,
    procedure: 'Mise en demeure',
    court: 'Tribunal judiciaire de Grenoble',
    partner: 'À désigner',
    action: 'Relancer le créancier',
    officerId: 'cl',
    acts: [
      act('Relances amiables sans résultat', '20/08 → 10/11/2026', 'DONE'),
      act('Demande d’accord au créancier', '18/11/2026', 'NOW'),
      act('Mise en demeure LRAR', 'À venir', 'TODO'),
    ],
  },
  {
    id: 'fabre',
    stage: 1,
    debtor: 'Électricité Fabre',
    siret: '887 789 329 00018',
    creditorId: 'er',
    creditor: 'Énergies Rhône',
    amount: 1248000,
    step: 'Requête déposée au greffe',
    due: 'Ordonnance attendue',
    urgent: false,
    procedure: 'Injonction de payer',
    court: 'Tribunal judiciaire de Valence',
    partner: 'Me Roche, avocate',
    action: 'Suivre au greffe',
    officerId: 'hb',
    acts: [
      act('Mise en demeure LRAR', '02/10/2026', 'DONE'),
      act('Requête en injonction de payer déposée', '04/11/2026', 'NOW'),
      act('Ordonnance du juge', 'En attente', 'TODO'),
      act('Signification par commissaire de justice', 'À venir', 'TODO'),
    ],
  },
  {
    id: 'pixelia',
    stage: 1,
    debtor: 'Studio Pixelia',
    siret: '979 217 429 00013',
    creditorId: 'mt',
    creditor: 'Médiatel',
    amount: 396000,
    step: 'Procédure simplifiée (< 5 000 €)',
    due: 'Réponse débiteur avant le 04/12',
    urgent: true,
    procedure: 'Procédure simplifiée',
    court: '—',
    partner: 'Étude Garnier, commissaires de justice',
    action: 'Voir la proposition d’accord',
    officerId: 'hb',
    acts: [
      act('Mise en demeure LRAR', '15/10/2026', 'DONE'),
      act('Lettre du commissaire de justice (procédure simplifiée)', '04/11/2026', 'NOW'),
      act('Accord du débiteur → titre exécutoire', 'Délai d’un mois', 'TODO'),
    ],
  },
  {
    id: 'arnal',
    stage: 2,
    debtor: 'Menuiserie Arnal',
    siret: '280 967 928 00019',
    creditorId: 'md',
    creditor: 'Matériaux Delta',
    amount: 1875000,
    step: 'Ordonnance signifiée',
    due: 'Opposition possible jusqu’au 02/12',
    urgent: true,
    procedure: 'Injonction de payer',
    court: 'Tribunal de commerce de Lyon',
    partner: 'Étude Garnier',
    action: 'Demander la formule exécutoire',
    officerId: 'cl',
    acts: [
      act('Ordonnance d’injonction de payer rendue', '20/10/2026', 'DONE'),
      act('Signification au débiteur', '02/11/2026', 'DONE'),
      act('Délai d’opposition d’un mois', 'Jusqu’au 02/12/2026', 'NOW'),
      act('Apposition de la formule exécutoire', 'À venir', 'TODO'),
    ],
  },
  {
    id: 'lemaire',
    stage: 3,
    debtor: 'Transports Lemaire',
    siret: '868 426 842 00068',
    creditorId: 'tl',
    creditor: 'TransAlp Leasing',
    amount: 3150000,
    step: 'Saisie-attribution sur compte',
    due: 'Fonds attendus 05/12',
    urgent: false,
    procedure: 'Exécution forcée',
    court: 'Tribunal judiciaire de Grenoble',
    partner: 'Étude Garnier',
    action: 'Voir le procès-verbal',
    officerId: 'cl',
    acts: [
      act('Titre exécutoire obtenu', '12/09/2026', 'DONE'),
      act('Commandement de payer', '01/10/2026', 'DONE'),
      act('Saisie-attribution sur compte bancaire', '17/11/2026', 'NOW'),
      act('Versement des fonds saisis', 'Attendu le 05/12/2026', 'TODO'),
    ],
  },
  {
    id: 'morin',
    stage: 4,
    debtor: 'Boulangerie Morin',
    siret: '181 003 393 00012',
    creditorId: 'ch',
    creditor: 'Crédit Horizon',
    amount: 724000,
    step: 'Recouvré intégralement',
    due: 'Clos le 10/11',
    urgent: false,
    procedure: 'Clos',
    court: 'Tribunal judiciaire de Lyon',
    partner: 'Me Durieux',
    action: 'Archiver',
    officerId: 'sm',
    acts: [act('Titre exécutoire', '02/07/2026', 'DONE'), act('Paiement intégral + frais', '10/11/2026', 'DONE')],
  },
];
let sent = new Set<string>();
export const resetCollection = () => {
  planned.clear();
  reminders = seedReminders();
  requests = seedRequests();
  sent = new Set();
};
const TOTALS = [
  [6, 3860000],
  [5, 6414000],
  [4, 7190000],
  [3, 8126000],
  [3, 2900000],
].map(([count, amount]) => ({ count: count ?? 0, amount: amount ?? 0 }));

export const collectionHandlers = [
  http.get(
    '/api/reminders',
    guarded(staffWithCases, (_info, session) =>
      HttpResponse.json({
        today: '2026-11-21',
        items: reminders.filter((item) => reads(session, item.officerId)).map((item) => ({ ...item, canAct: acts(session, item.officerId) })),
        weekly: { emails: 34, sms: 12, letters: 5 },
      }),
    ),
  ),
  http.get(
    '/api/reminders/targets',
    guarded(staffWithCases, (_info, session) =>
      HttpResponse.json({
        items: readable(session)
          .filter((item) => actsOn(session, item.id))
          .map(({ id, name, creditor }) => ({ id, name, creditor })),
      }),
    ),
  ),
  http.post(
    '/api/reminders',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const parsed = newReminder.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      const { caseId, type, date, time, title } = parsed.data;
      if (date < TODAY) return HttpResponse.json({ code: 'PAST_DATE' }, { status: 422 });
      const item = readable(session).find((entry) => entry.id === caseId);
      if (!item || !actsOn(session, caseId)) return forbidden();
      const limit = outsideHours(type, date, time);
      const id = crypto.randomUUID();
      planned.add(id);
      audit(session, 'Relance planifiée');
      reminders = [
        ...reminders,
        {
          id,
          date,
          time: time || null,
          type,
          debtor: item.name,
          caseId,
          creditorId: item.creditorId,
          creditor: item.creditor,
          title,
          done: false,
          automatic: false,
          officerId: item.officerId,
          limit,
        },
      ];
      return HttpResponse.json({ id, limit });
    }),
  ),
  http.delete(
    '/api/reminders/:id',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      const item = reminders.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      // Only a reminder planned by hand, never a scenario step, an installment nor a court deadline.
      if (!acts(session, item.officerId) || item.done || !planned.has(item.id)) return forbidden();
      audit(session, 'Relance planifiée supprimée');
      planned.delete(item.id);
      reminders = reminders.filter((entry) => entry !== item);
      return done();
    }),
  ),
  http.put(
    '/api/reminders/:id',
    guarded<Info>(staffWithCases, async ({ params, request }, session) => {
      const item = reminders.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      if (!acts(session, item.officerId)) return forbidden();
      const body = (await request.json()) as Partial<Pick<Reminder, 'date' | 'time' | 'done'>>;
      for (const key of ['date', 'time', 'done'] as const) if (body[key] !== undefined) Object.assign(item, { [key]: body[key] });
      return done();
    }),
  ),
  http.get(
    '/api/payment-plans',
    guarded(staffWithCases, (_info, session) => {
      const visible = plans.filter((plan) => reads(session, plan.officerId));
      const manager = session.role === 'COLLECTION_MANAGER';
      const { role } = session;
      return HttpResponse.json({
        plans: visible.map(({ officerId, ...plan }) => ({ ...plan, canAct: acts(session, officerId) })),
        requests: role === 'CLAIMS_OFFICER' ? [] : requests,
        canValidate: manager,
        thresholdMonths: 6,
        stats:
          role === 'CLAIMS_OFFICER'
            ? { active: visible.length, remaining: 1840000, nextMonth: 740000, nextMonthCount: 2, honored: 88, defaults: 0 }
            : { active: 38, remaining: 31248000, nextMonth: 4260000, nextMonthCount: 51, honored: 91, defaults: 4 },
        simulation:
          role === 'DIRECTOR'
            ? { caseId: 'lagarde', debtor: 'Hôtel Lagarde', creditor: 'Énergies Rhône', balance: 1190000, ownedByDirector: true }
            : manager
              ? { caseId: 'demo', debtor: 'Bâtiplus SAS', creditor: 'Matériaux Delta', balance: 2960000, ownedByDirector: false }
              : { caseId: 'helio', debtor: 'Groupe Hélio', creditor: 'Médiatel', balance: 3675000, ownedByDirector: false },
      });
    }),
  ),
  http.get(
    '/api/payment-plans/simulation/:id',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      const item = readable(session).find((entry) => entry.id === params.id);
      if (!item) return notFound();
      if (!actsOn(session, item.id)) return forbidden();
      const plan = plans.find((entry) => entry.caseId === item.id);
      const balance = plan ? plan.installments.filter((entry) => entry.state !== 'PAID').reduce((sum, entry) => sum + entry.amount, 0) : item.amount;
      return HttpResponse.json({ caseId: item.id, debtor: item.name, creditor: item.creditor, balance, ownedByDirector: item.officerId === 'ad' });
    }),
  ),
  http.post(
    '/api/payment-plans',
    guarded<Info>(staffWithCases, async ({ request }, session) => {
      const { caseId } = (await request.json()) as { caseId: string };
      return actsOn(session, caseId) ? done() : forbidden();
    }),
  ),
  http.put(
    '/api/payment-plans/requests/:id',
    guarded<Info>(
      (session) => session.role === 'COLLECTION_MANAGER',
      async ({ params, request }) => {
        const item = requests.find((entry) => entry.id === params.id);
        if (!item) return notFound();
        item.decision = ((await request.json()) as { decision: string }).decision;
        return done();
      },
    ),
  ),
  http.post(
    '/api/payment-plans/:id/reminder',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      const plan = plans.find((item) => item.id === params.id);
      return !plan ? notFound() : acts(session, plan.officerId) ? done() : forbidden();
    }),
  ),
  http.get(
    '/api/litigation',
    guarded(staffWithCases, (_info, session) => {
      const visible = litigation.filter((item) => reads(session, item.officerId));
      const whole = session.role !== 'CLAIMS_OFFICER';
      const totals = whole
        ? TOTALS
        : TOTALS.map((_, index) => {
            const list = visible.filter((item) => item.stage === index);
            return { count: list.length, amount: list.reduce((sum, item) => sum + item.amount, 0) };
          });
      return HttpResponse.json({
        cases: visible.map(({ officerId, ...item }) => ({ ...item, actionSent: sent.has(item.id), canAct: acts(session, officerId) })),
        stageTotals: totals,
        deadlines: [
          { caseId: 'bellet', date: '2026-11-30', title: 'Fin du délai de mise en demeure', who: 'Charpentes Bellet · Matériaux Delta', tone: 'danger' },
          { caseId: 'arnal', date: '2026-12-02', title: 'Fin du délai d’opposition', who: 'Menuiserie Arnal · Matériaux Delta', tone: 'danger' },
          { caseId: 'pixelia', date: '2026-12-04', title: 'Réponse en procédure simplifiée', who: 'Studio Pixelia · Médiatel', tone: 'warning' },
          { caseId: 'lemaire', date: '2026-12-05', title: 'Versement des fonds saisis', who: 'Transports Lemaire · TransAlp Leasing', tone: 'neutral' },
        ].filter((item) => visible.some((row) => row.id === item.caseId)),
        stats: whole
          ? { amount: 28490000, count: 21, advancedFees: 482000, titles: 14, waiting: 3, soon: 4 }
          : { amount: visible.reduce((sum, item) => sum + item.amount, 0), count: visible.length, advancedFees: 64000, titles: 2, waiting: 0, soon: 1 },
      });
    }),
  ),
  http.post(
    '/api/litigation/:id/action',
    guarded<Info>(staffWithCases, ({ params }, session) => {
      const item = litigation.find((entry) => entry.id === params.id);
      if (!item) return notFound();
      if (!acts(session, item.officerId)) return forbidden();
      sent.add(item.id);
      return done();
    }),
  ),
];
