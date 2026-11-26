import {
  LITIGATION_STAGES,
  litigationConsentBody,
  litigationFileBody,
  litigationStageBody,
  newReminder,
  type LitigationCase, type PaymentPlan, type Reminder, type ReminderType, type Session } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import type { z } from 'zod';
import { audit } from '../audit';
import { done, forbidden, guarded, notFound, staffWithCases } from '../http';
import { actsOn, OFFICERS, readable } from './cases';
import { contactCap } from './settings';

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
  ['11-24', '10:00', 'SMS', 'Fromagerie Durand', 'durand', ER, 'Relance SMS', false, true, 'cl', 'plafond de 1 SMS par semaine dépassé'],
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
/** Contacts of the same week (letters: same month) already planned for this debtor, done or not. */
const overCap = (type: ReminderType, debtor: string, date: string): string | null => {
  const caps = {
    CALL: ['calls', 'appels par semaine'],
    EMAIL: ['emails', 'e-mails par semaine'],
    SMS: ['sms', 'SMS par semaine'],
    LETTER: ['letters', 'courriers par mois'],
  } as const;
  const rule = caps[type as keyof typeof caps];
  if (!rule) return null;
  const week = (iso: string) => {
    const day = new Date(`${iso}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    return day.toISOString().slice(0, 10);
  };
  const same = (iso: string) => (type === 'LETTER' ? iso.slice(0, 7) === date.slice(0, 7) : week(iso) === week(date));
  const cap = contactCap(rule[0]);
  const count = reminders.filter((item) => item.debtor === debtor && item.type === type && same(item.date)).length;
  return count >= cap ? `Plafond atteint : ${cap} ${rule[1]} pour ce débiteur` : null;
};
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
    version: 1,
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
    version: 1,
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
    version: 1,
  },
];
let requests = seedRequests();
/** Hors maquette: values of the demonstration, never real rates of the firm (typed by the Director). */
let interestRates: { kind: 'ECB' | 'LEGAL_INDIVIDUAL'; validFrom: string; rateBp: number; enteredBy: string; updatedAt: string }[] = [];

type StoredLitigation = Omit<LitigationCase, 'canAct'> & { officerId: string };
const step = (title: string, date: string, who: string) => ({ title, date, who });
/** `maquette/donnees-demo/Contentieux.json`, reduced to what the minimal follow-up keeps (question 163). */
const seedLitigation = (): StoredLitigation[] =>
  (
    [
      ['bellet', 0, '2026-11-16', 'Charpentes Bellet', '607 529 179 00006', MD, 2730000, 'Tribunal de commerce de Lyon', 'Me Durieux, avocat', 'RECEIVED', 'cl', [
        step('Passage en contentieux', '2026-11-05', 'Claire Lambert'),
        step('Accord écrit du créancier reçu', '2026-11-05', 'Claire Lambert'),
      ]],
      ['valmont', 0, '2026-11-18', 'Garage Valmont', '193 786 571 00094', TL, 2390000, 'Tribunal judiciaire de Grenoble', '', 'WAITING', 'cl', [
        step('Passage en contentieux', '2026-11-18', 'Claire Lambert'),
      ]],
      ['fabre', 1, '2026-11-04', 'Électricité Fabre', '887 789 329 00018', ER, 1248000, 'Tribunal judiciaire de Valence', 'Me Roche, avocate', 'RECEIVED', 'hb', [
        step('Passage en contentieux', '2026-10-02', 'Hugo Bernard'),
        step('Accord écrit du créancier reçu', '2026-10-02', 'Hugo Bernard'),
        step('Contentieux : Injonction de payer', '2026-11-04', 'Hugo Bernard'),
      ]],
      ['pixelia', 1, '2026-11-04', 'Studio Pixelia', '979 217 429 00013', MT, 396000, '', 'Étude Garnier, commissaires de justice', 'NOT_NEEDED', 'hb', [
        step('Passage en contentieux', '2026-10-15', 'Hugo Bernard'),
        step('Contentieux : Injonction de payer', '2026-11-04', 'Hugo Bernard'),
      ]],
      ['arnal', 2, '2026-11-02', 'Menuiserie Arnal', '280 967 928 00019', MD, 1875000, 'Tribunal de commerce de Lyon', 'Étude Garnier', 'RECEIVED', 'cl', [
        step('Passage en contentieux', '2026-09-21', 'Claire Lambert'),
        step('Accord écrit du créancier reçu', '2026-09-21', 'Claire Lambert'),
        step('Contentieux : Injonction de payer', '2026-10-20', 'Claire Lambert'),
        step('Contentieux : Titre exécutoire', '2026-11-02', 'Claire Lambert'),
      ]],
      ['lemaire', 3, '2026-10-01', 'Transports Lemaire', '868 426 842 00068', TL, 3150000, 'Tribunal judiciaire de Grenoble', 'Étude Garnier', 'RECEIVED', 'cl', [
        step('Passage en contentieux', '2026-06-08', 'Claire Lambert'),
        step('Accord écrit du créancier reçu', '2026-06-10', 'Claire Lambert'),
        step('Contentieux : Injonction de payer', '2026-07-01', 'Claire Lambert'),
        step('Contentieux : Titre exécutoire', '2026-09-12', 'Claire Lambert'),
        step('Contentieux : Exécution forcée', '2026-10-01', 'Claire Lambert'),
      ]],
      ['morin', 4, '2026-11-10', 'Boulangerie Morin', '181 003 393 00012', CH, 0, 'Tribunal judiciaire de Lyon', 'Me Durieux', 'NOT_NEEDED', 'sm', [
        step('Passage en contentieux', '2026-05-11', 'Sofia Martin'),
        step('Contentieux : Titre exécutoire', '2026-07-02', 'Sofia Martin'),
        step('Procédure close : recouvré', '2026-11-10', 'Sofia Martin'),
      ]],
    ] as const
  ).map(([id, stage, stageSince, debtor, siret, [creditorId, creditor], amount, court, partnerName, consent, officerId, events]) => ({
    id,
    caseId: id,
    stage,
    stageSince,
    debtor,
    identifier: `SIRET ${siret}`,
    creditorId: creditorId ?? '',
    creditor: creditor ?? '',
    amount,
    balance: amount,
    court,
    partnerName,
    consent,
    events: [...events],
    version: 1,
    officerId,
  }));
let litigation = seedLitigation();
export const resetCollection = () => {
  planned.clear();
  reminders = seedReminders();
  requests = seedRequests();
  interestRates = [];
  litigation = seedLitigation();
};
const nameOf = (session: Session) => `${session.firstName} ${session.lastName}`;
const conflict = (code: string) => HttpResponse.json({ code }, { status: 409 });
/** A change to a litigation file: by whoever acts on its case, on the version that was shown, never once closed. */
const followed = <S extends z.ZodType<{ version: number }>>(
  schema: S,
  apply: (item: StoredLitigation, body: z.infer<S>, session: Session) => Response | undefined | void,
) =>
  guarded<Info>(staffWithCases, async ({ request, params }, session) => {
    const body = schema.safeParse(await request.json());
    if (!body.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
    const item = litigation.find((entry) => entry.id === params.id && reads(session, entry.officerId));
    if (!item) return notFound();
    if (!acts(session, item.officerId)) return forbidden();
    if (item.stage === 4) return conflict('LITIGATION_CLOSED');
    if (item.version !== body.data.version) return conflict('CHANGED');
    const refused = apply(item, body.data, session);
    if (refused) return refused;
    item.version += 1;
    return done();
  });

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
      const limit = outsideHours(type, date, time) ?? overCap(type, item.name, date);
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
      // A case that is not shown does not exist (API: 404, never 403).
      if (!readable(session).some((entry) => entry.id === caseId)) return notFound();
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
  // Rates of each semester (question 75): read by the team, typed by the Director or the manager on their behalf.
  http.get(
    '/api/interest-rates',
    guarded(
      (session) => session.role !== 'CREDITOR',
      (_info, session) =>
        HttpResponse.json({
          items: interestRates,
          canEdit: session.role === 'DIRECTOR' || (session.role === 'COLLECTION_MANAGER' && session.activeDelegations.includes('ADMINISTRATIVE')),
        }),
    ),
  ),
  http.put(
    '/api/interest-rates',
    guarded(
      (session) => session.role === 'DIRECTOR' || (session.role === 'COLLECTION_MANAGER' && session.activeDelegations.includes('ADMINISTRATIVE')),
      async ({ request }) => {
        const body = (await request.json()) as { kind: 'ECB' | 'LEGAL_INDIVIDUAL'; validFrom: string; rateBp: number };
        interestRates = [
          { ...body, enteredBy: 'Alice Durand', updatedAt: new Date().toISOString() },
          ...interestRates.filter((rate) => rate.kind !== body.kind || rate.validFrom !== body.validFrom),
        ];
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
      const open = visible.filter((item) => item.stage < 4);
      return HttpResponse.json({
        cases: visible.map(({ officerId, ...item }) => ({ ...item, canAct: item.stage < 4 && acts(session, officerId) })),
        stageTotals: LITIGATION_STAGES.map((_, index) => {
          const list = visible.filter((item) => item.stage === index);
          return { count: list.length, amount: list.reduce((sum, item) => sum + item.amount, 0) };
        }),
        stats: {
          amount: open.reduce((sum, item) => sum + item.amount, 0),
          count: open.length,
          titles: visible.filter((item) => item.events.some((event) => event.title === 'Contentieux : Titre exécutoire' && event.date.startsWith('2026'))).length,
          waiting: open.filter((item) => item.consent === 'WAITING').length,
        },
      });
    }),
  ),
  http.put(
    '/api/litigation/:id',
    followed(litigationFileBody, (item, body) => {
      item.court = body.court;
      item.partnerName = body.partnerName;
    }),
  ),
  http.post(
    '/api/litigation/:id/stage',
    followed(litigationStageBody, (item, body, session) => {
      const next = LITIGATION_STAGES.findIndex((stage) => stage.code === body.stage);
      if (body.stage === 'CLOSED') {
        if (body.expectedOutcome !== (item.balance === 0 ? 'SETTLED' : 'LOST')) return conflict('CHANGED');
        item.events.push(step(item.balance === 0 ? 'Procédure close : recouvré' : 'Procédure close : irrécouvrable', TODAY, nameOf(session)));
      } else {
        if (next !== item.stage + 1) return conflict('CHANGED');
        if (item.consent === 'WAITING') return conflict('CONSENT_AWAITED');
        item.events.push(step(`Contentieux : ${LITIGATION_STAGES[next]?.label ?? ''}`, TODAY, nameOf(session)));
      }
      item.stage = next;
      item.stageSince = TODAY;
      return undefined;
    }),
  ),
  http.post(
    '/api/litigation/:id/consent',
    followed(litigationConsentBody, (item, _body, session) => {
      if (item.consent !== 'WAITING') return conflict('CHANGED');
      item.consent = 'RECEIVED';
      item.events.push(step('Accord écrit du créancier reçu', TODAY, nameOf(session)));
      return undefined;
    }),
  ),
];
