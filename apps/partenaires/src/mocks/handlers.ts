import type { ImportReport, PartnerSession, PlanApproval, PortalCase, PortalStatus } from '@legarec/contracts';
import { acceptsBody, loginRequest, newClaim } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';

type Info = { request: Request; params: Record<string, string | readonly string[] | undefined> };
const PASSWORD = 'motdepasse12';
/** Fictitious creditors. The second one exists to prove the isolation. */
const ACCOUNTS: PartnerSession[] = [
  {
    userId: 'cb',
    firstName: 'Claire',
    lastName: 'Besson',
    email: 'c.besson@materiauxdelta.example',
    creditor: { id: 'md', name: 'Matériaux Delta', initials: 'MD', siren: '401 228 975' },
    officer: 'Thomas Giraud',
  },
  {
    userId: 'pr',
    firstName: 'Paul',
    lastName: 'Roche',
    email: 'p.roche@energiesrhone.example',
    creditor: { id: 'er', name: 'Énergies Rhône', initials: 'ER', siren: '626 018 154' },
    officer: 'Camille Laurent',
  },
];
const STORAGE = 'msw-demo-partner';
const read = () => {
  try {
    return sessionStorage.getItem(STORAGE) ?? 'cb';
  } catch {
    return 'cb';
  }
};
export const state = { accountId: read(), failures: new Map<string, number>() };
export const partnerOf = (email: string) => ACCOUNTS.find((item) => item.email === email)?.userId ?? 'none';
export function setPartner(id: string) {
  state.accountId = id;
  try {
    sessionStorage.setItem(STORAGE, id);
  } catch {
    /* storage unavailable */
  }
}

type Owned<T> = T & { creditorId: string };
const file = (
  creditorId: string,
  id: string,
  status: PortalStatus,
  debtor: string,
  externalReference: string,
  reference: string,
  invoices: string,
  entrusted: number,
  recovered: number,
  last: string,
  steps: [string, string][],
): Owned<PortalCase> => ({
  creditorId,
  id,
  status,
  debtor,
  externalReference,
  reference,
  invoices,
  entrusted: entrusted * 100,
  recovered: recovered * 100,
  last,
  steps: steps.map(([title, date]) => ({ title, date })),
});
const seedCases = () => [
  file('md', 'f1', 'REMINDING', 'Bâtiplus SAS', 'CLI-08812', 'LGR-2026-00142', '3 factures', 48200, 0, 'Appel le 21/11 : promesse de 18 600 €', [
    ['Rappel amiable par e-mail', '21/09'],
    ['Relance ferme', '12/11'],
    ['Appel : promesse de paiement', '21/11'],
  ]),
  file('md', 'f2', 'LITIGATION', 'Charpentes Bellet', 'CLI-07740', 'LGR-2026-00109', '4 factures', 29300, 2000, 'Mise en demeure reçue le 18/11', [
    ['Relances amiables (3)', '14/09 → 28/10'],
    ['Votre accord pour le contentieux', '05/11'],
    ['Mise en demeure LRAR', '16/11'],
  ]),
  file('md', 'f3', 'PLAN', 'SCI Les Tilleuls', 'CLI-09120', 'LGR-2026-00175', '2 factures', 14070, 7034, 'Échéance 2/4 payée le 05/11', [
    ['Échéancier signé (4 mois)', '03/10'],
    ['Échéance 1/4 payée', '05/10'],
    ['Échéance 2/4 payée', '05/11'],
  ]),
  file('md', 'f4', 'REMINDING', 'Menuiserie Rivoire', 'CLI-09311', 'LGR-2026-00188', '5 factures', 15640, 0, 'Relance n°1 envoyée le 18/11', [
    ['Prise en charge', '14/11'],
    ['Relance n°1 par e-mail', '18/11'],
  ]),
  file('md', 'f5', 'SETTLED', 'Menuiserie Arnal', 'CLI-06655', 'LGR-2026-00061', '2 factures', 9800, 9800, 'Soldé le 30/10', [
    ['Relance ferme', '02/10'],
    ['Paiement intégral', '30/10'],
  ]),
  file('md', 'f6', 'NEW', 'Bâtir Sud Rénovation', 'CLI-09402', 'LGR-2026-00199', '1 facture', 4380, 0, 'Déposé le 20/11', [
    ['Créance déposée par vous', '20/11'],
  ]),
  file('md', 'f7', 'LOST', 'Atelier Corbin', 'CLI-05120', 'LGR-2026-00033', '1 facture', 2150, 0, 'Liquidation judiciaire du débiteur', [
    ['Procédure collective constatée', '12/09'],
    ['Déclaration de créance conseillée', '13/09'],
  ]),
  file('er', 'g1', 'REMINDING', 'Fromagerie Durand', 'ER-1180', 'LGR-2026-00181', '2 factures', 6240, 1000, 'Virement de 1 000 € reçu le 14/11', [
    ['Relance amiable', '02/11'],
  ]),
];
const seedPlans = (): Owned<PlanApproval>[] => [
  {
    creditorId: 'md',
    id: 'p1',
    caseId: 'f1',
    debtor: 'Bâtiplus SAS',
    reference: 'LGR-2026-00142',
    months: 8,
    installment: 370000,
    total: 2960000,
    firstOn: '2026-12-28',
    reason: 'Cette durée dépasse les 6 mois prévus à votre mandat.',
    status: 'PENDING',
  },
  {
    creditorId: 'er',
    id: 'p2',
    caseId: 'g1',
    debtor: 'Fromagerie Durand',
    reference: 'LGR-2026-00181',
    months: 10,
    installment: 53200,
    total: 532000,
    firstOn: '2026-12-05',
    reason: 'Cette durée dépasse les 6 mois prévus à votre mandat.',
    status: 'PENDING',
  },
];
let cases = seedCases();
let plans = seedPlans();
let imports: Owned<ImportReport>[] = [];
export const resetPortal = () => {
  cases = seedCases();
  plans = seedPlans();
  imports = [];
  state.failures.clear();
};

const done = () => new HttpResponse(null, { status: 204 });
const notFound = () => HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
const unauthorized = () => HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
const current = () => ACCOUNTS.find((item) => item.userId === state.accountId);
/** Only runs with a session, and only ever receives the creditor of that session. */
const owned =
  (resolve: (creditorId: string, info: Info) => Response | Promise<Response>) =>
  async (info: Info): Promise<Response> => {
    const user = current();
    return user ? resolve(user.creditor.id, info) : unauthorized();
  };
const mine = <T extends { creditorId: string }>(items: T[], creditorId: string) =>
  items.filter((item) => item.creditorId === creditorId).map(({ creditorId: _creditorId, ...item }) => item);
const COUNTS: Record<string, Record<PortalStatus, number>> = {
  md: { NEW: 6, REMINDING: 31, PLAN: 9, LITIGATION: 4, SETTLED: 12, LOST: 2 },
  er: { NEW: 0, REMINDING: 1, PLAN: 0, LITIGATION: 0, SETTLED: 0, LOST: 0 },
};

/** What the API would refuse is refused here too: every body matches its contract. */
const checkBody = http.all('/api/*', async ({ request }) => {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return undefined;
  const path = new URL(request.url).pathname.replace('/api', '');
  return acceptsBody('partner', request.method, path, await request.clone().text()) ? undefined : HttpResponse.json({ code: 'INVALID' }, { status: 422 });
});

export const handlers = [
  checkBody,
  http.get('/api/auth/session', () => {
    const user = current();
    return user ? HttpResponse.json(user) : unauthorized();
  }),
  http.post('/api/auth/login', async ({ request }) => {
    const body = loginRequest.parse(await request.json());
    const email = body.email.toLowerCase();
    const failures = state.failures.get(email) ?? 0;
    if (failures >= 5) return HttpResponse.json({ code: 'LOCKED' }, { status: 423 });
    if (email.endsWith('@legarec.fr') && body.password === PASSWORD)
      return HttpResponse.json({ status: 'WRONG_PORTAL', portal: 'espace', url: 'https://espace.legarec.fr' });
    const account = ACCOUNTS.find((item) => item.email === email);
    if (!account || body.password !== PASSWORD) {
      state.failures.set(email, failures + 1);
      return failures + 1 >= 5
        ? HttpResponse.json({ code: 'LOCKED' }, { status: 423 })
        : HttpResponse.json({ code: 'INVALID_CREDENTIALS', attemptsLeft: 4 - failures }, { status: 401 });
    }
    setPartner(account.userId);
    return HttpResponse.json({ status: 'OK', session: null });
  }),
  http.post('/api/auth/logout', () => {
    setPartner('none');
    return done();
  }),
  http.post('/api/auth/forgot-password', () => done()),
  http.get('/api/auth/reset/:token', ({ params }) =>
    params.token === 'demo'
      ? HttpResponse.json({ email: 'c.besson@materiauxdelta.example', firstName: 'Claire', twoFactorRequired: false })
      : HttpResponse.json({ code: 'EXPIRED' }, { status: 410 }),
  ),
  http.post('/api/auth/reset/:token', () => done()),
  http.get('/api/auth/invitation/:token', ({ params }) =>
    params.token === 'demo'
      ? HttpResponse.json({
          email: 'p.roche@energiesrhone.example',
          firstName: 'Paul',
          invitedBy: 'Camille Laurent',
          role: 'CREDITOR',
          twoFactorRequired: false,
        })
      : HttpResponse.json({ code: 'EXPIRED' }, { status: 410 }),
  ),
  http.post('/api/auth/invitation/:token/password', () => HttpResponse.json({ totpKey: 'DEMO DEMO DEMO DEMO' })),
  http.post('/api/auth/invitation/:token/totp', async ({ request }) =>
    ((await request.json()) as { code: string }).code === '123456'
      ? HttpResponse.json({ backupCodes: ['4821-7730', '1093-5562', '7740-2218', '3365-9014', '6628-1047', '9950-3381', '2074-8816', '5517-4493'] })
      : HttpResponse.json({ code: 'INVALID_CODE', attemptsLeft: 4 }, { status: 401 }),
  ),
  http.get(
    '/api/portal/dashboard',
    owned((creditorId) =>
      HttpResponse.json({
        kpis:
          creditorId === 'md'
            ? [
                { label: 'Montant confié en 2026', value: '836 700 €', hint: '412 factures · 64 débiteurs' },
                { label: 'Montant recouvré', value: '450 300 €', hint: 'dont 52 340 € en novembre' },
                { label: 'Taux de recouvrement', value: '54 %', hint: 'sur les dossiers ouverts en 2026' },
                { label: 'Délai moyen de recouvrement', value: '38 jours', hint: 'de la prise en charge au paiement' },
              ]
            : [
                { label: 'Montant confié en 2026', value: '6 240 €', hint: '2 factures · 1 débiteur' },
                { label: 'Montant recouvré', value: '1 000 €', hint: 'dont 1 000 € en novembre' },
              ],
        statuses: (Object.entries(COUNTS[creditorId] ?? {}) as [PortalStatus, number][]).map(([status, count]) => ({ status, count })),
        months: ['Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.'].map((label, index) => ({
          label,
          amount: creditorId === 'md' ? [38, 41, 33, 46, 44, 52][index]! * 100_000 : index === 5 ? 100_000 : 0,
        })),
        activity:
          creditorId === 'md'
            ? [
                { id: 'a1', who: 'Bâtiplus SAS', what: 'promesse de paiement de 18 600 € pour le 28/11', when: 'Aujourd’hui 09:12', tone: 'warning' },
                { id: 'a2', who: 'Charpentes Bellet', what: 'accusé de réception de la mise en demeure', when: '18/11', tone: 'danger' },
                { id: 'a3', who: 'Reversement', what: '38 420 € versés sur votre compte', when: '15/11', tone: 'success' },
                { id: 'a4', who: 'SCI Les Tilleuls', what: 'échéance 2/4 de 3 517 € payée', when: '05/11', tone: 'success' },
              ]
            : [{ id: 'b1', who: 'Fromagerie Durand', what: 'virement de 1 000 € reçu', when: '14/11', tone: 'success' }],
        approvals: mine(plans, creditorId),
      }),
    ),
  ),
  http.get(
    '/api/portal/cases',
    owned((creditorId) => HttpResponse.json({ items: mine(cases, creditorId), counts: COUNTS[creditorId] ?? {} })),
  ),
  http.get(
    '/api/portal/cases/:id',
    owned((creditorId, { params }) => {
      const item = mine(cases, creditorId).find((entry) => entry.id === params.id);
      return item ? HttpResponse.json(item) : notFound();
    }),
  ),
  http.post(
    '/api/portal/plans/:id/decision',
    owned(async (creditorId, { params, request }) => {
      const item = plans.find((entry) => entry.id === params.id && entry.creditorId === creditorId);
      if (!item) return notFound();
      const { accepted, reason } = (await request.json()) as { accepted: boolean; reason: string };
      if (!accepted && !reason) return HttpResponse.json({ code: 'REASON_REQUIRED' }, { status: 422 });
      plans = plans.map((entry) => (entry === item ? { ...entry, status: accepted ? 'ACCEPTED' : 'REFUSED' } : entry));
      return done();
    }),
  ),
  http.post(
    '/api/portal/attachments',
    owned(() => HttpResponse.json({ id: crypto.randomUUID() })),
  ),
  http.post(
    '/api/portal/claims',
    owned(async (_creditorId, { request }) => {
      const parsed = newClaim.safeParse(await request.json());
      if (!parsed.success) return HttpResponse.json({ code: 'INVALID' }, { status: 422 });
      // As the API: the claim waits for the team before it becomes a case (question 155); nothing shows before.
      return done();
    }),
  ),
  http.post(
    '/api/portal/imports',
    owned((creditorId, { request }) => {
      if (/html|javascript/.test(request.headers.get('content-type') ?? '')) return HttpResponse.json({ code: 'UNREADABLE' }, { status: 422 });
      const report: ImportReport = {
        id: `i${imports.length + 1}`,
        lines: 24,
        valid: 22,
        total: 4831000,
        errors: [
          { line: 7, message: 'Échéance manquante pour la facture MD-73102' },
          { line: 19, message: 'Montant illisible (« 1.2OO,00 »)' },
        ],
      };
      imports = [...imports, { ...report, creditorId }];
      return HttpResponse.json(report);
    }),
  ),
  http.post(
    '/api/portal/imports/:id/confirm',
    owned((creditorId, { params }) => {
      const report = imports.find((item) => item.id === params.id && item.creditorId === creditorId);
      if (!report) return notFound();
      imports = imports.filter((item) => item !== report);
      return HttpResponse.json({ created: report.valid, pending: report.errors.length });
    }),
  ),
  http.get(
    '/api/portal/payouts',
    owned((creditorId) =>
      HttpResponse.json({
        rateLabel: 'Sommes encaissées pour votre compte, commission de 8 % HT retenue, versées le 15 de chaque mois.',
        next:
          creditorId === 'md'
            ? { date: '15 déc. 2026', net: 2291000, collected: 2490200, fee: 199200 }
            : { date: '15 déc. 2026', net: 92000, collected: 100000, fee: 8000 },
        year: creditorId === 'md' ? { paid: 41427600, recovered: 45030000, fees: 3602400 } : { paid: 0, recovered: 100000, fees: 8000 },
        items:
          creditorId === 'md'
            ? [
                { id: 'r1', date: '15 nov. 2026', count: 12, collected: 4176100, fee: 334100, net: 3842000 },
                { id: 'r2', date: '15 oct. 2026', count: 15, collected: 4483700, fee: 358700, net: 4125000 },
                { id: 'r3', date: '15 sept. 2026', count: 9, collected: 3088000, fee: 247000, net: 2841000 },
                { id: 'r4', date: '15 août 2026', count: 11, collected: 3621000, fee: 289700, net: 3331300 },
              ]
            : [],
      }),
    ),
  ),
  http.get(
    '/api/portal/documents',
    owned((creditorId) =>
      HttpResponse.json({
        items:
          creditorId === 'md'
            ? [
                ['Rapport mensuel – novembre 2026', 'Disponible le 05/12/2026', 'PDF'],
                ['Relevé de reversement – 15/11/2026', 'PDF · 210 Ko', 'PDF'],
                ['Rapport mensuel – octobre 2026', 'PDF · 340 Ko', 'PDF'],
                ['Relevé de reversement – 15/10/2026', 'PDF · 196 Ko', 'PDF'],
                ['Détail des dossiers au 21/11/2026', 'Excel · généré à la demande', 'XLSX'],
                ['Convention de mandat signée', 'PDF · 12/03/2024', 'PDF'],
              ].map(([name, meta, extension], index) => ({ id: `o${index}`, name, meta, extension, available: index > 0 }))
            : [],
      }),
    ),
  ),
];
