import { acceptsBody, hasDelegation, isFirmIdentity, loginRequest, PROOF_MINUTES, sensitiveAction, type Dashboard, type ShellData } from '@legarec/contracts';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { ACCOUNTS, DEMO_PASSWORD } from './accounts';
import dashboardData from './dashboard.json';
import { documentHandlers } from './routes/documents';
import { memberOf, steeringHandlers } from './routes/steering';
import { accountHandlers, BACKUP_CODES } from './routes/account';
import { settingsHandlers } from './routes/settings';
import { templateHandlers } from './routes/templates';
import { callHandlers } from './routes/calls';
import { messageHandlers } from './routes/messages';
import { caseHandlers, readable } from './routes/cases';
import { collectionHandlers } from './routes/collection';
import { canSeeCreditor, creditorHandlers } from './routes/creditors';
import { mayRead } from './visibility';
import { done, forbidden, unauthorized } from './http';
import { currentSession, setAccount, state } from './state';

const MAX_FAILURES = 5;

const CREDITORS: ShellData['creditors'] = [
  { id: 'all', name: 'Tous les créanciers', initials: '', count: 248 },
  { id: 'md', name: 'Matériaux Delta', initials: 'MD', siren: '401 228 975', count: 64 },
  { id: 'er', name: 'Énergies Rhône', initials: 'ER', siren: '626 018 154', count: 71 },
  { id: 'mt', name: 'Médiatel', initials: 'MT', siren: '183 016 617', count: 52 },
  { id: 'tl', name: 'TransAlp Leasing', initials: 'TL', siren: '418 609 137', count: 33 },
  { id: 'ch', name: 'Crédit Horizon', initials: 'CH', siren: '199 603 085', count: 28 },
];
const NOTIFICATIONS: ShellData['notifications'] = [
  {
    id: 'n1',
    kind: 'PAYMENT',
    unread: true,
    text: 'Nordis Logistique a versé 12 500 € (promesse tenue)',
    meta: 'Énergies Rhône · il y a 10 min',
    href: '/debiteurs/demo',
  },
  {
    id: 'n2',
    kind: 'MESSAGE',
    unread: true,
    text: 'Julien Ferrand (Bâtiplus SAS) demande un échéancier',
    meta: 'Matériaux Delta · il y a 25 min',
    href: '/e-mails',
  },
  {
    id: 'n3',
    kind: 'DEADLINE',
    unread: true,
    text: 'Le délai de mise en demeure de Charpentes Bellet expire dans 9 jours',
    meta: 'Contentieux · il y a 1 h',
    href: '/contentieux',
  },
  {
    id: 'n4',
    kind: 'CREDITOR',
    unread: true,
    text: 'Matériaux Delta a validé l’échéancier de 8 mois pour Bâtiplus SAS',
    meta: 'Accord créancier · il y a 2 h',
    href: '/echeanciers',
  },
  { id: 'n5', kind: 'MESSAGE', unread: false, text: 'E-mail non remis à Garage Valmont : adresse invalide', meta: 'TransAlp Leasing · hier', href: '/e-mails' },
  { id: 'n6', kind: 'SYSTEM', unread: false, text: 'Import terminé : 96 nouvelles factures pour Médiatel', meta: 'Import · hier', href: '/creanciers/demo' },
  {
    id: 'n7',
    kind: 'PAYMENT',
    unread: false,
    text: 'Échéance impayée : Transports Lemaire (5 250 €)',
    meta: 'TransAlp Leasing · 19 nov.',
    href: '/echeanciers',
  },
];
const searchIndex = (session: NonNullable<ReturnType<typeof currentSession>>) => [
  ...readable(session).map((item) => ({
    id: `d:${item.id}`,
    kind: 'DEBTOR',
    title: item.name,
    sub: `${item.identifier} · ${item.creditor} · ${item.statusLabel}`,
    href: `/debiteurs/${item.id}`,
    initials: item.name.slice(0, 2).toUpperCase(),
  })),
  ...CREDITORS.filter((item) => item.id !== 'all' && canSeeCreditor(session, item.id)).map((item) => ({
    id: `c:${item.id}`,
    kind: 'CREDITOR',
    title: item.name,
    sub: `SIREN ${item.siren} · ${item.count} débiteurs`,
    href: `/creanciers/${item.id}`,
    initials: item.initials,
  })),
];
const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Five wrong codes close the sign-in under way. */
const wrongCode = () => {
  if (!state.pending) return unauthorized();
  state.wrongCodes += 1;
  if (state.wrongCodes < MAX_FAILURES) return HttpResponse.json({ code: 'INVALID_CODE', attemptsLeft: MAX_FAILURES - state.wrongCodes }, { status: 401 });
  state.pending = null;
  return HttpResponse.json({ code: 'LOCKED' }, { status: 423 });
};

/** What the API would refuse is refused here too: every body matches its contract. */
const checkBody = http.all('/api/*', async ({ request }) => {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return undefined;
  const path = new URL(request.url).pathname.replace('/api', '');
  return acceptsBody('staff', request.method, path, await request.clone().text()) ? undefined : HttpResponse.json({ code: 'INVALID' }, { status: 422 });
});

/** Before what matters most, as the API: a role that may not do it is refused first. */
const checkProof = http.all('/api/*', async ({ request }) => {
  const session = currentSession();
  const path = new URL(request.url).pathname.replace('/api', '');
  const action = sensitiveAction(request.method, path);
  if (!session || !action || Date.now() - state.provedAt <= PROOF_MINUTES * 60_000) return undefined;
  if (action === 'PUT /settings/:scope/:id') {
    const sent = (await request.clone().json()) as Record<string, unknown>;
    if (!Object.keys(sent).some((field) => isFirmIdentity(path.split('/').at(-1) ?? '', field))) return undefined;
  }
  const mayDo =
    session.role === 'DIRECTOR' ||
    action.includes('/account/') ||
    (action.includes('/secrets')
      ? hasDelegation(session, 'TECHNICAL')
      : action.includes('/delegations') || action.includes('/settings')
        ? false
        : session.role !== 'CLAIMS_OFFICER');
  return mayDo ? HttpResponse.json({ code: 'PROOF_REQUIRED' }, { status: 403 }) : undefined;
});

export const handlers: HttpHandler[] = [
  checkBody,
  checkProof,
  http.get('/api/auth/proof', () => {
    const session = currentSession();
    return session ? HttpResponse.json({ methods: session.twoFactorEnabled ? ['TOTP', 'WEBAUTHN'] : ['PASSWORD'] }) : unauthorized();
  }),
  http.post('/api/auth/proof/webauthn', () =>
    currentSession() ? HttpResponse.json({ challenge: 'ZGVtby1jaGFsbGVuZ2U', rpId: 'localhost', allowCredentials: [], timeout: 60000 }) : unauthorized(),
  ),
  http.post('/api/auth/proof', async ({ request }) => {
    const session = currentSession();
    if (!session) return unauthorized();
    const given = (await request.json()) as { method: string; code?: string; password?: string };
    if ((given.method === 'PASSWORD') === session.twoFactorEnabled) return HttpResponse.json({ code: 'INVALID', fields: ['method'] }, { status: 422 });
    if (state.wrongProofs >= MAX_FAILURES) return HttpResponse.json({ code: 'LOCKED', closed: false }, { status: 423 });
    const accepted =
      given.method === 'PASSWORD'
        ? given.password === DEMO_PASSWORD
        : given.method === 'WEBAUTHN' || (given.method === 'BACKUP_CODE' ? given.code?.replace(/\D/gu, '') === '48217730' : given.code === '123456');
    if (accepted) {
      state.provedAt = Date.now();
      state.wrongProofs = 0;
      return done();
    }
    state.wrongProofs += 1;
    if (state.wrongProofs < MAX_FAILURES) return HttpResponse.json({ code: 'INVALID_PROOF', attemptsLeft: MAX_FAILURES - state.wrongProofs }, { status: 422 });
    setAccount('none');
    return HttpResponse.json({ code: 'LOCKED', closed: true }, { status: 423 });
  }),
  ...documentHandlers,
  ...settingsHandlers,
  ...templateHandlers,
  ...accountHandlers,
  ...steeringHandlers,
  ...callHandlers,
  ...messageHandlers,
  ...caseHandlers,
  ...collectionHandlers,
  ...creditorHandlers,
  http.get('/api/auth/session', () => {
    const session = currentSession();
    return session ? HttpResponse.json(session) : unauthorized();
  }),
  http.put('/api/auth/preferences', async ({ request }) => {
    const session = currentSession();
    if (!session) return unauthorized();
    state.preferences.set(session.userId, (await request.json()) as never);
    return done();
  }),
  http.post('/api/auth/login', async ({ request }) => {
    const body = loginRequest.parse(await request.json());
    const email = body.email.toLowerCase();
    const failures = state.failures.get(email) ?? 0;
    if (failures >= MAX_FAILURES) return HttpResponse.json({ code: 'LOCKED' }, { status: 423 });
    const staff = ACCOUNTS.find((item) => item.email === email);
    const creditor = email === 'c.besson@materiauxdelta.example';
    if (body.password !== DEMO_PASSWORD || (!staff && !creditor)) {
      state.failures.set(email, failures + 1);
      return failures + 1 >= MAX_FAILURES
        ? HttpResponse.json({ code: 'LOCKED' }, { status: 423 })
        : HttpResponse.json({ code: 'INVALID_CREDENTIALS', attemptsLeft: MAX_FAILURES - failures - 1 }, { status: 401 });
    }
    state.failures.delete(email);
    if (creditor) return HttpResponse.json({ status: 'WRONG_PORTAL', portal: 'partenaires', url: 'https://partenaires.legarec.fr' });
    const member = memberOf(email);
    if (staff && (staff.twoFactorEnabled || member?.twoFactorRequired)) {
      state.pending = staff.userId;
      state.setUp = member?.twoFactor === true || staff.twoFactorEnabled;
      return HttpResponse.json(state.setUp ? { status: 'TWO_FACTOR', methods: ['TOTP', 'WEBAUTHN'] } : { status: 'SETUP_REQUIRED' });
    }
    setAccount(staff?.userId ?? null);
    return HttpResponse.json({ status: 'OK', session: currentSession() });
  }),
  http.post('/api/auth/two-factor', async ({ request }) => {
    const { method, code } = (await request.json()) as { method: string; code?: string };
    const accepted = method === 'WEBAUTHN' || (method === 'BACKUP_CODE' ? code === '4821-7730' : code === '123456');
    if (!state.pending || !accepted) return wrongCode();
    setAccount(state.pending);
    state.pending = null;
    state.wrongCodes = 0;
    return HttpResponse.json({ status: 'OK', session: currentSession() });
  }),
  http.post('/api/auth/setup/totp', () =>
    state.pending && !state.setUp
      ? HttpResponse.json({ uri: 'otpauth://totp/Legarec:demo?secret=DEMODEMODEMODEMO&issuer=Legarec', key: 'DEMO DEMO DEMO DEMO' })
      : unauthorized(),
  ),
  http.post('/api/auth/setup/totp/verify', async ({ request }) => {
    const { code } = (await request.json()) as { code: string };
    if (!state.pending || state.setUp) return unauthorized();
    if (code !== '123456') return wrongCode();
    setAccount(state.pending);
    state.pending = null;
    return HttpResponse.json({ backupCodes: BACKUP_CODES, session: currentSession() });
  }),
  http.post('/api/auth/two-factor/webauthn', () =>
    state.pending ? HttpResponse.json({ challenge: 'ZGVtby1jaGFsbGVuZ2U', rpId: 'localhost', allowCredentials: [], timeout: 60000 }) : unauthorized(),
  ),
  http.post('/api/auth/logout', () => {
    setAccount('none');
    return done();
  }),
  http.post('/api/auth/forgot-password', () => done()),
  http.get('/api/auth/reset/:token', ({ params }) =>
    params.token === 'expire'
      ? HttpResponse.json({ code: 'EXPIRED' }, { status: 410 })
      : HttpResponse.json({ email: 'cl@legarec.fr', firstName: 'Camille', twoFactorRequired: false }),
  ),
  http.post('/api/auth/reset/:token', () => done()),
  http.get('/api/auth/invitation/:token', ({ params }) =>
    params.token === 'expire'
      ? HttpResponse.json({ code: 'EXPIRED' }, { status: 410 })
      : HttpResponse.json({ email: 'nk@legarec.fr', firstName: 'Nadia', invitedBy: 'Camille Laurent', role: 'CLAIMS_OFFICER', twoFactorRequired: false }),
  ),
  http.post('/api/auth/invitation/:token/password', () => HttpResponse.json({ totpKey: 'DEMO DEMO DEMO DEMO' })),
  http.post('/api/auth/invitation/:token/totp', async ({ request }) =>
    ((await request.json()) as { code: string }).code === '123456'
      ? HttpResponse.json({ backupCodes: BACKUP_CODES })
      : HttpResponse.json({ code: 'INVALID_CODE' }, { status: 401 }),
  ),
  http.get('/api/shell', () => {
    const session = currentSession();
    if (!session) return unauthorized();
    const noCase = session.role === 'DEVELOPER';
    return HttpResponse.json({
      creditors: noCase ? [] : CREDITORS.filter((item) => item.id === 'all' || canSeeCreditor(session, item.id)),
      counts: noCase
        ? { teamOnline: 0, remindersToday: 0, litigationUrgent: 0, callQueue: 0, unreadEmails: 0, unreadSms: 0 }
        : { teamOnline: 3, remindersToday: 7, litigationUrgent: 2, callQueue: 24, unreadEmails: 12, unreadSms: 3 },
      notifications: NOTIFICATIONS.filter((item) => mayRead(session, item.text)).map((item) => ({
        ...item,
        unread: item.unread && !state.readNotifications.has(item.id),
      })),
    } satisfies ShellData);
  }),
  http.post('/api/notifications/read', async ({ request }) => {
    if (!currentSession()) return unauthorized();
    for (const id of ((await request.json()) as { ids: string[] }).ids) state.readNotifications.add(id);
    return done();
  }),
  http.post('/api/search', async ({ request }) => {
    const session = currentSession();
    if (!session) return unauthorized();
    if (session.role === 'DEVELOPER') return HttpResponse.json([]);
    const query = normalize(((await request.json()) as { query: string }).query);
    const digits = query.replace(/\s/g, '');
    const visible = searchIndex(session);
    return HttpResponse.json(
      visible.filter((item) => {
        const text = normalize(`${item.title} ${item.sub}`);
        return text.includes(query) || (/^\d{3,}$/.test(digits) && text.replace(/\s/g, '').includes(digits));
      }),
    );
  }),
  http.get('/api/dashboard', () => {
    const session = currentSession();
    if (!session) return unauthorized();
    if (session.role === 'DEVELOPER') return forbidden();
    const base = dashboardData as Dashboard;
    const priorities = base.priorities.map((item) => ({ ...item, done: state.priorities.get(item.id) ?? item.done }));
    if (session.role === 'CLAIMS_OFFICER')
      return HttpResponse.json({
        ...base,
        scope: 'PERSONAL',
        outstanding: 31240000,
        debtors: 62,
        invoices: 418,
        overdue30: 9870000,
        priorities: priorities.filter((item) => mayRead(session, `${item.title} ${item.meta}`)),
        topDebtors: base.topDebtors.filter((item) => mayRead(session, item.name)),
        creditors: base.creditors.filter((item) => canSeeCreditor(session, item.id)),
        team: [],
        feed: base.feed.filter((item) => mayRead(session, item.text)),
      });
    return HttpResponse.json({ ...base, scope: session.role === 'DIRECTOR' ? 'GLOBAL' : 'TEAM', priorities });
  }),
  http.put('/api/dashboard/priorities/:id', async ({ params, request }) => {
    if (!currentSession()) return unauthorized();
    state.priorities.set(String(params.id), ((await request.json()) as { done: boolean }).done);
    return done();
  }),
];
