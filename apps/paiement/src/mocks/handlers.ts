import {
  acceptsBody,
  debtorAccess,
  debtorIdentifier,
  debtorRequest,
  sirenOf,
  type DebtorCase,
  type DebtorIdentifier,
  type PaymentInfo,
} from '@legarec/contracts';
import { http, HttpResponse } from 'msw';

type Info = { request: Request; params: Record<string, string | readonly string[] | undefined> };
type Message = { id: string; mine: boolean; who: string; when: string; text: string; attachments: { id: string; name: string }[]; receipt: string | null };
type Stored = { id: string; greeting: string; siren: string | null; references: string[]; code: string; cases: DebtorCase[] };

const payment = (reference: string | null): PaymentInfo => ({
  beneficiary: 'LEGAREC – compte dédié aux fonds',
  iban: '[IBAN DU COMPTE DÉDIÉ]',
  bic: '[BIC]',
  reference,
  chequeOrder: '[ORDRE DES CHÈQUES]',
  chequeAddress: '[ADRESSE D’ENVOI DES CHÈQUES]',
});
const item = (id: string, reference: string, debtor: string, creditor: string, data: Partial<DebtorCase>): DebtorCase => ({
  id,
  reference,
  debtor,
  creditor,
  officer: 'Camille Laurent',
  isIndividual: false,
  balance: 0,
  statusLabel: 'Paiement attendu',
  statusTone: 'warning',
  principal: 0,
  interest: 0,
  indemnity: 0,
  paid: 0,
  invoices: [],
  payments: [],
  next: null,
  lastMessage: null,
  unread: 0,
  plan: null,
  payment: payment(reference),
  ...data,
});
/** Fictitious debtors. Access codes only exist in this simulated API. */
const seed = (): Stored[] => [
  {
    id: 'durand',
    greeting: 'Monsieur Durand',
    siren: '732829320',
    references: ['LGR-2026-00181', 'LGR-2026-00204'],
    code: 'KXPM',
    cases: [
      item('c1', 'LGR-2026-00181', 'Fromagerie Durand', 'Énergies Rhône', {
        principal: 624000,
        indemnity: 8000,
        paid: 100000,
        balance: 532000,
        invoices: [
          { id: 'i1', number: 'F-2026-0902', dueOn: '2026-10-31', amount: 312000 },
          { id: 'i2', number: 'F-2026-0927', dueOn: '2026-11-07', amount: 312000 },
        ],
        payments: [{ id: 'p1', amount: 100000, date: '2026-11-14', method: 'TRANSFER', receiptId: 'q1' }],
        next: { date: '2026-12-05', amount: 532000 },
        unread: 1,
        lastMessage: {
          who: 'Camille Laurent',
          when: '23/11/2026',
          text: 'Nous avons bien reçu votre virement de 1 000 €. Pouvez-vous nous indiquer quand vous pensez régler le solde ?',
        },
      }),
      item('c2', 'LGR-2026-00204', 'Fromagerie Durand', 'Médiatel', {
        principal: 90000,
        indemnity: 4000,
        balance: 62667,
        paid: 31333,
        statusLabel: 'Échéancier',
        statusTone: 'info',
        invoices: [{ id: 'i3', number: 'M-5521', dueOn: '2026-09-15', amount: 90000 }],
        payments: [{ id: 'p2', amount: 31333, date: '2026-11-05', method: 'CHEQUE', receiptId: 'q2' }],
        next: { date: '2026-12-05', amount: 31333 },
        plan: {
          acceptedOn: '2026-10-20',
          installments: [
            { number: 1, dueOn: '2026-11-05', amount: 31333, status: 'PAID' },
            { number: 2, dueOn: '2026-12-05', amount: 31333, status: 'DUE' },
            { number: 3, dueOn: '2027-01-05', amount: 31334, status: 'UPCOMING' },
          ],
        },
      }),
    ],
  },
  {
    id: 'meunier',
    greeting: 'Paul Meunier',
    siren: null,
    references: ['LGR-2026-00220'],
    code: 'BRTV',
    cases: [
      item('c3', 'LGR-2026-00220', 'Paul Meunier', 'Crédit Horizon', {
        isIndividual: true,
        principal: 84000,
        balance: 84000,
        invoices: [{ id: 'i4', number: 'CH-118', dueOn: '2026-08-31', amount: 84000 }],
      }),
    ],
  },
];
const seedMessages = (): Record<string, Message[]> => ({
  c1: [
    {
      id: 'm1',
      mine: true,
      who: 'Vous',
      when: '14/11/2026',
      text: 'Bonjour, je viens de faire un virement de 1 000 €.',
      attachments: [{ id: 'a1', name: 'justificatif.pdf' }],
      receipt: 'Reçu par Legarec le 14/11/2026 à 10:12',
    },
    {
      id: 'm2',
      mine: false,
      who: 'Camille Laurent',
      when: '23/11/2026',
      text: 'Nous avons bien reçu votre virement de 1 000 €. Pouvez-vous nous indiquer quand vous pensez régler le solde ?',
      attachments: [],
      receipt: null,
    },
  ],
});
const STORAGE = 'msw-demo-debtor';
const read = () => {
  try {
    return sessionStorage.getItem(STORAGE);
  } catch {
    return null;
  }
};
let debtors = seed();
let messages = seedMessages();
let failures = new Map<string, number>();
let smsSent = new Map<string, number>();
let addressFailures = 0;
let sessionId: string | null = read();
/** Unverified messages of the limited access, as the staff portal would receive them. */
export let unverified: unknown[] = [];
export const resetDebtors = () => {
  debtors = seed();
  messages = seedMessages();
  failures = new Map();
  smsSent = new Map();
  addressFailures = 0;
  unverified = [];
  openSession(null);
};
export function openSession(id: string | null) {
  sessionId = id;
  try {
    if (id) sessionStorage.setItem(STORAGE, id);
    else sessionStorage.removeItem(STORAGE);
  } catch {
    /* storage unavailable */
  }
}

const done = () => new HttpResponse(null, { status: 204 });
const notFound = () => HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
const unauthorized = () => HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
const current = () => debtors.find((entry) => entry.id === sessionId);
const find = (identifier: DebtorIdentifier) =>
  debtors.find((entry) =>
    identifier.kind === 'SIREN' ? entry.siren === sirenOf(identifier.value) : entry.siren === null && entry.references.includes(identifier.value),
  );
/** One counter per debtor, whatever the reference typed. */
const keyOf = (identifier: DebtorIdentifier) => find(identifier)?.id ?? (identifier.kind === 'SIREN' ? sirenOf(identifier.value) : identifier.value);
/** Failures allowed from one address, all identifiers together. */
const ADDRESS_LIMIT = 20;
const sessionOf = (debtor: Stored) => ({
  greeting: debtor.greeting,
  debtor: debtor.cases[0]?.debtor ?? '',
  cases: debtor.cases.map(({ id, reference, creditor, balance, statusLabel, statusTone }) => ({ id, reference, creditor, balance, statusLabel, statusTone })),
});
const onCase =
  (resolve: (entry: DebtorCase, info: Info) => Response | Promise<Response>) =>
  async (info: Info): Promise<Response> => {
    const debtor = current();
    if (!debtor) return unauthorized();
    const entry = debtor.cases.find((candidate) => candidate.id === info.params.id);
    return entry ? resolve(entry, info) : notFound();
  };
const post = (caseId: string, text: string, attachments: Message['attachments'] = []) => {
  messages[caseId] = [
    ...(messages[caseId] ?? []),
    { id: `m${Date.now()}`, mine: true, who: 'Vous', when: 'à l’instant', text, attachments, receipt: 'Reçu par Legarec à l’instant' },
  ];
};
const REQUEST_TEXT = {
  PLAN: 'Demande d’échéancier',
  DISPUTE: 'Contestation de la créance',
  ALREADY_PAID: 'Paiement déjà effectué',
  CALLBACK: 'Demande de rappel',
};

/** What the API would refuse is refused here too: every body matches its contract. */
const checkBody = http.all('/api/*', async ({ request }) => {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return undefined;
  const path = new URL(request.url).pathname.replace('/api', '');
  return acceptsBody('debtor', request.method, path, await request.clone().text()) ? undefined : HttpResponse.json({ code: 'INVALID' }, { status: 422 });
});

export const handlers = [
  checkBody,
  http.get('/api/debtor/session', () => {
    const debtor = current();
    return debtor ? HttpResponse.json(sessionOf(debtor)) : unauthorized();
  }),
  http.post('/api/debtor/logout', () => {
    openSession(null);
    return done();
  }),
  http.get('/api/debtor/links/:token', ({ params }) =>
    params.token === 'demo'
      ? HttpResponse.json({ identifier: { kind: 'SIREN', value: '732 829 320' } })
      : HttpResponse.json({ code: 'UNKNOWN_LINK' }, { status: 404 }),
  ),
  http.post('/api/debtor/access', async ({ request }) => {
    const parsed = debtorAccess.safeParse(await request.json());
    if (!parsed.success) return HttpResponse.json({ code: 'INVALID', attemptsLeft: 5 }, { status: 401 });
    if (addressFailures >= ADDRESS_LIMIT) return HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 });
    const key = keyOf(parsed.data.identifier);
    const count = failures.get(key) ?? 0;
    if (count >= 10) return HttpResponse.json({ code: 'BLOCKED' }, { status: 423 });
    if (count === 5) {
      // The simulated lock opens at the next try: the API waits for 15 minutes.
      failures.set(key, 5.5);
      return HttpResponse.json({ code: 'LOCKED', minutes: 15 }, { status: 423 });
    }
    const debtor = find(parsed.data.identifier);
    if (!debtor || debtor.code !== parsed.data.code) {
      addressFailures += 1;
      const next = Math.floor(count) + 1;
      failures.set(key, next);
      if (next >= 10) return HttpResponse.json({ code: 'BLOCKED' }, { status: 423 });
      if (next === 5) return HttpResponse.json({ code: 'LOCKED', minutes: 15 }, { status: 423 });
      return HttpResponse.json({ code: 'INVALID', attemptsLeft: (next < 5 ? 5 : 10) - next }, { status: 401 });
    }
    failures.delete(key);
    openSession(debtor.id);
    return HttpResponse.json(sessionOf(debtor));
  }),
  http.post('/api/debtor/code-by-sms', async ({ request }) => {
    const parsed = debtorIdentifier.safeParse(await request.json());
    if (!parsed.success) return HttpResponse.json({ code: 'TOO_MANY' }, { status: 422 });
    const key = keyOf(parsed.data);
    const sent = (smsSent.get(key) ?? 0) + 1;
    if (sent > 3) return HttpResponse.json({ code: 'TOO_MANY' }, { status: 429 });
    smsSent.set(key, sent);
    return HttpResponse.json({ requested: true });
  }),
  http.get('/api/debtor/limited/payment', () => HttpResponse.json(payment(null))),
  http.post('/api/debtor/limited/messages', async ({ request }) => {
    unverified = [...unverified, { ...((await request.json()) as object), verified: false }];
    return done();
  }),
  http.post('/api/debtor/attachments', ({ request }) =>
    /pdf|png|jpe?g/.test(request.headers.get('content-type') ?? '')
      ? HttpResponse.json({ id: crypto.randomUUID() })
      : HttpResponse.json({ code: 'REFUSED' }, { status: 415 }),
  ),
  http.get(
    '/api/debtor/cases/:id',
    onCase((entry) => HttpResponse.json(entry)),
  ),
  http.get(
    '/api/debtor/cases/:id/messages',
    onCase((entry) => HttpResponse.json({ items: messages[entry.id] ?? [] })),
  ),
  http.post(
    '/api/debtor/cases/:id/messages',
    onCase(async (entry, { request }) => {
      const { text, attachments } = (await request.json()) as { text: string; attachments: Message['attachments'] };
      post(entry.id, text, attachments);
      return done();
    }),
  ),
  http.post(
    '/api/debtor/cases/:id/messages/read',
    onCase((entry) => {
      entry.unread = 0;
      return done();
    }),
  ),
  http.post(
    '/api/debtor/cases/:id/requests',
    onCase(async (entry, { request }) => {
      const parsed = debtorRequest.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      post(entry.id, REQUEST_TEXT[parsed.data.kind], 'attachments' in parsed.data ? parsed.data.attachments : []);
      if (parsed.data.kind === 'PLAN') Object.assign(entry, { statusLabel: 'Échéancier demandé', statusTone: 'info' });
      if (parsed.data.kind === 'DISPUTE') Object.assign(entry, { statusLabel: 'Contestation en cours', statusTone: 'violet' });
      return done();
    }),
  ),
];
