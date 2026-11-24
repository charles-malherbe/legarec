import { callQualification, type CallQualification, type CallTarget, type Coordinate } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, guarded, notFound, staffWithCases, unauthorized } from '../http';
import { currentSession } from '../state';
import { readable } from './cases';

type Info = { request: Request; params: Record<string, unknown> };
const phone = (id: string, label: string, value: string, status: Coordinate['status'], primary: boolean, note = ''): Coordinate => ({
  id,
  kind: 'PHONE',
  label,
  value,
  status,
  primary,
  note,
});
const email = (id: string, label: string, value: string, status: Coordinate['status'], primary: boolean, note = ''): Coordinate => ({
  id,
  kind: 'EMAIL',
  label,
  value,
  status,
  primary,
  note,
});
const HISTORY = [
  { channel: 'E-mail', text: 'Relance n°2 non remise : adresse e-mail en erreur', when: '12/11' },
  { channel: 'Appel', text: 'Sans réponse, message laissé', when: '19/11' },
  { channel: 'Promesse', text: 'Promesse non tenue (paiement annoncé le 31/10)', when: '03/11' },
  { channel: 'SMS', text: 'Relance avec lien de l’espace débiteur, distribué', when: '05/10' },
];
const callbackAi = (contact: string, creditor: string): CallTarget['ai'] => ({
  lines: [
    { who: 'Vous', text: `Je vous appelle au sujet des factures ${creditor}.` },
    { who: contact, text: 'Je ne peux pas vous répondre maintenant, rappelez-moi demain matin.' },
  ],
  chips: ['Rappel demandé', 'Demain matin'],
  summary: `${contact} n’était pas disponible et demande à être rappelé demain matin.`,
  outcome: 'CALLBACK',
  facts: [
    { k: 'Résultat', v: 'Rappel demandé' },
    { k: 'Quand', v: 'Demain 10:00' },
    { k: 'Prochaine action', v: `Rappeler ${contact}` },
  ],
  amount: null,
  date: null,
  invoices: [],
});
const base = (
  item: Pick<
    CallTarget,
    | 'caseId'
    | 'kind'
    | 'debtor'
    | 'siret'
    | 'creditor'
    | 'creditorId'
    | 'contact'
    | 'role'
    | 'amount'
    | 'daysLate'
    | 'reference'
    | 'reason'
    | 'slot'
    | 'priority'
    | 'coordinates'
  >,
): CallTarget => ({
  ...item,
  coordinateHistory: [],
  invoices: [{ number: `F-${item.reference.slice(4)}`, due: '2026-10-12', amount: item.amount }],
  note: '',
  doneOutcome: null,
  history: HISTORY,
  ai: callbackAi(item.contact, item.creditor),
});
const seed = (): CallTarget[] => [
  {
    ...base({
      caseId: 'demo',
      kind: 'CALL',
      debtor: 'Bâtiplus SAS',
      siret: '512 334 871 00088',
      creditor: 'Matériaux Delta',
      creditorId: 'md',
      contact: 'Julien Ferrand',
      role: 'gérant',
      amount: 4820000,
      daysLate: 64,
      reference: 'DOS-2026-0142',
      reason: 'Promesse non tenue · relance n°3',
      slot: 'Maintenant',
      priority: 'HIGH',
      coordinates: [
        phone('p0', 'Standard', '0472184590', 'VERIFIED', true, 'vérifié le 19/11'),
        phone('p1', 'Mobile', '0612487703', 'UNVERIFIED', false, 'importé de l’ERP du créancier'),
        email('e0', 'Direction', 'j.ferrand@batiplus.example', 'INVALID', true, 'rebond Resend le 12/11'),
        email('e1', 'Comptabilité', 'compta@batiplus.example', 'VERIFIED', false, 'dernière ouverture le 05/11'),
      ],
    }),
    invoices: [
      { number: 'F-2026-0712', due: '2026-09-14', amount: 1860000 },
      { number: 'F-2026-0745', due: '2026-09-27', amount: 1640000 },
      { number: 'F-2026-0790', due: '2026-10-10', amount: 1320000 },
    ],
    coordinateHistory: [
      { when: '19/11 10:12', text: 'Camille Laurent · standard 04 72 18 45 90 vérifié par appel' },
      { when: '12/11 08:03', text: 'Resend · e-mail non remis (boîte inexistante)' },
      { when: '02/09 14:40', text: 'Import Matériaux Delta · création des coordonnées' },
    ],
    note: 'M. Ferrand confirme un virement de 18 600 € pour F-2026-0712 d’ici le 28/11. Demande un échéancier pour le solde.',
    ai: {
      lines: [
        { who: 'Vous', text: 'Je vous appelle au sujet des trois factures Matériaux Delta, pour 48 200 € au total.' },
        { who: 'Julien Ferrand', text: 'On a eu un gros retard de chantier. Je peux régler la F-2026-0712 tout de suite.' },
        { who: 'Julien Ferrand', text: 'Les 18 600 € partent par virement d’ici vendredi 28, pour le reste il me faut un échéancier.' },
      ],
      chips: ['Promesse 18 600 €', 'Paiement le 28/11', 'F-2026-0712', 'Demande d’échéancier pour le solde'],
      summary:
        'Julien Ferrand reconnaît la dette et explique le retard par un décalage de chantier. Il s’engage à virer 18 600 € (facture F-2026-0712) au plus tard le 28/11 et demande un échéancier pour le solde de 29 600 €.',
      outcome: 'PROMISE_TO_PAY',
      facts: [
        { k: 'Résultat', v: 'Promesse de paiement' },
        { k: 'Montant', v: '18 600 € · virement' },
        { k: 'Date', v: '28/11/2026' },
        { k: 'Factures', v: 'F-2026-0712' },
        { k: 'Prochaine action', v: 'Vérifier le virement le 29/11, proposer un échéancier pour 29 600 €' },
      ],
      amount: 1860000,
      date: '2026-11-28',
      invoices: ['F-2026-0712'],
    },
  },
  base({
    caseId: 'valmont',
    kind: 'CALL',
    debtor: 'Garage Valmont',
    siret: '193 786 571 00094',
    creditor: 'TransAlp Leasing',
    creditorId: 'tl',
    contact: 'Paul Valmont',
    role: 'gérant',
    amount: 2390000,
    daysLate: 97,
    reference: 'DOS-2026-0098',
    reason: 'Avant mise en demeure',
    slot: '10:30',
    priority: 'HIGH',
    coordinates: [phone('p0', 'Standard', '0472112233', 'VERIFIED', true), email('e0', 'Contact', 'contact@garage-valmont.example', 'VERIFIED', true)],
  }),
  base({
    caseId: 'helio',
    kind: 'CALLBACK',
    debtor: 'Groupe Hélio',
    siret: '319 935 185 00011',
    creditor: 'Médiatel',
    creditorId: 'mt',
    contact: 'Nadia Roussel',
    role: 'responsable comptable',
    amount: 3675000,
    daysLate: 38,
    reference: 'DOS-2026-0151',
    reason: 'Rappel demandé par le client',
    slot: '11:00',
    priority: 'MEDIUM',
    coordinates: [
      phone('p0', 'Ligne directe', '0145678901', 'VERIFIED', true),
      email('e0', 'Comptabilité', 'n.roussel@groupe-helio.example', 'VERIFIED', true),
    ],
  }),
  base({
    caseId: 'durand',
    kind: 'CALL',
    debtor: 'Fromagerie Durand',
    siret: '655 979 714 00012',
    creditor: 'Énergies Rhône',
    creditorId: 'er',
    contact: 'Marc Durand',
    role: 'gérant',
    amount: 624000,
    daysLate: 21,
    reference: 'DOS-2026-0181',
    reason: 'Premier contact téléphonique',
    slot: '14:00',
    priority: 'NORMAL',
    coordinates: [phone('p0', 'Standard', '0385223344', 'UNVERIFIED', true), email('e0', 'Comptabilité', 'compta@fromagerie-durand.example', 'VERIFIED', true)],
  }),
  base({
    caseId: 'orsay',
    kind: 'MISSED',
    debtor: 'Cabinet Orsay',
    siret: '725 276 018 00084',
    creditor: 'Médiatel',
    creditorId: 'mt',
    contact: 'Léa Martin',
    role: 'associée',
    amount: 1480000,
    daysLate: 12,
    reference: 'DOS-2026-0177',
    reason: 'Appel manqué à 09:12 · rappeler',
    slot: '15:30',
    priority: 'NORMAL',
    coordinates: [phone('p0', 'Standard', '0156789012', 'VERIFIED', true), email('e0', 'Associée', 'l.martin@cabinet-orsay.example', 'VERIFIED', true)],
  }),
];
let targets = seed();
export const callState = {
  tcx: 'CONNECTED' as 'CONNECTED' | 'DOWN',
  active: true,
  aiEnabled: true,
  incoming: false,
  decisions: [] as string[],
  sheets: [] as CallQualification[],
};
export const resetCalls = () => {
  targets = seed();
  Object.assign(callState, { tcx: 'CONNECTED', active: true, aiEnabled: true, incoming: false, decisions: [], sheets: [] });
};
const onTarget = (resolve: (item: CallTarget, info: Info) => Response | Promise<Response>) =>
  guarded<Info>(staffWithCases, (info, session) => {
    const item = targets.find((entry) => entry.caseId === info.params.id);
    if (!item) return notFound();
    const allowed = session.role !== 'DIRECTOR' && readable(session).some((entry) => entry.id === item.caseId);
    return allowed ? resolve(item, info) : forbidden();
  });

export const callHandlers = [
  http.get(
    '/api/calls',
    guarded(staffWithCases, (_info, session) => {
      const allowed = session.role === 'DIRECTOR' ? [] : readable(session).map((item) => item.id);
      const visible = targets.filter((item) => allowed.includes(item.caseId)).map((item) => (callState.aiEnabled ? item : { ...item, ai: null }));
      return HttpResponse.json({
        campaign: 'Retards 60 j +',
        line: '01 87 88 02 98',
        extension: session.extension,
        tcx: callState.tcx,
        targets: visible,
        active: callState.active && visible[0]?.caseId === 'demo' ? { caseId: 'demo', seconds: 272, announced: true, phone: '0472184590' } : null,
        colleagues: [
          { extension: '102', name: 'Hugo Benali', state: 'Disponible', available: true },
          { extension: '103', name: 'Sarah Morel', state: 'En pause', available: true },
          { extension: '104', name: 'Thomas Giraud', state: 'Absent', available: false },
          { extension: '800', name: 'File « Recouvrement »', state: '2 agents libres', available: true },
        ],
        stats: { calls: 18, target: 40, reached: 11, promises: '4 · 31 200 €', duration: '3 min 42', corrected: 3 },
      });
    }),
  ),
  http.get(
    '/api/calls/incoming',
    guarded(
      () => true,
      (_info, session) =>
        HttpResponse.json(
          callState.incoming && staffWithCases(session)
            ? {
                caseId: 'demo',
                name: 'Julien Ferrand',
                company: 'Bâtiplus SAS',
                phone: '04 72 18 45 90',
                reference: 'DOS-2026-0142',
                creditor: 'Matériaux Delta',
                last: 'Dernier échange : demande d’échéancier par e-mail ce matin, 10:24',
              }
            : null,
        ),
    ),
  ),
  http.put('/api/calls/incoming', () => {
    if (!currentSession()) return unauthorized();
    callState.incoming = false;
    return done();
  }),
  http.post(
    '/api/calls/:id/hangup',
    onTarget(() => done()),
  ),
  http.post(
    '/api/calls/:id/qualification',
    onTarget(async (item, { request }) => {
      const parsed = callQualification.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      item.doneOutcome = parsed.data.outcome;
      callState.sheets.push(parsed.data);
      return done();
    }),
  ),
  http.delete(
    '/api/calls/:id/qualification',
    onTarget((item) => {
      item.doneOutcome = null;
      return done();
    }),
  ),
  http.post(
    '/api/calls/:id/ai-decision',
    onTarget(async (_item, { request }) => {
      callState.decisions.push(((await request.json()) as { decision: string }).decision);
      return done();
    }),
  ),
  http.post(
    '/api/cases/:id/coordinates',
    onTarget(async (item, { request }) => {
      const body = (await request.json()) as { kind: Coordinate['kind']; label: string; value: string; primary: boolean; replaces: string | null };
      item.coordinates = [
        ...item.coordinates.map((entry) => ({
          ...entry,
          primary: body.primary && entry.kind === body.kind ? false : entry.primary,
          status: entry.id === body.replaces ? ('INVALID' as const) : entry.status,
        })),
        {
          id: `n${item.coordinates.length}`,
          kind: body.kind,
          label: body.label,
          value: body.value,
          status: 'NEW',
          primary: body.primary,
          note: 'ajouté le 21/11',
        },
      ];
      item.coordinateHistory = [{ when: '21/11', text: `Ajout de ${body.value}` }, ...item.coordinateHistory];
      return done();
    }),
  ),
  http.put(
    '/api/cases/:id/coordinates/:coordinateId',
    onTarget(async (item, { request, params }) => {
      const body = (await request.json()) as Partial<Coordinate>;
      const target = item.coordinates.find((entry) => entry.id === params.coordinateId);
      if (!target) return notFound();
      item.coordinates = item.coordinates.map((entry) =>
        entry.id === target.id ? { ...entry, ...body } : body.primary && entry.kind === target.kind ? { ...entry, primary: false } : entry,
      );
      return done();
    }),
  ),
];
