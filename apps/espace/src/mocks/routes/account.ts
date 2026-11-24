import { ROLE_LABELS, type AccountData, type Session } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, guarded, notFound } from '../http';
import { currentSession, state } from '../state';

type Info = { request: Request; params: Record<string, unknown> };
const staff = (session: Session) => session.role !== 'CREDITOR';
const PREFS: [string, string, string, boolean, boolean][] = [
  ['payment', 'Paiement reçu', 'Virement rapproché ou chèque encaissé', true, true],
  ['promise', 'Promesse non tenue', 'Le jour suivant la date promise', true, true],
  ['message', 'Réponse d’un débiteur', 'E-mail, SMS ou message de l’espace débiteur', true, false],
  ['deadline', 'Délai judiciaire proche', '10 jours, 3 jours et la veille', true, true],
  ['creditor', 'Décision d’un créancier', 'Accord ou refus d’échéancier, de contentieux', true, true],
  ['failure', 'Échec d’envoi', 'E-mail rejeté, SMS non distribué', true, false],
  ['import', 'Import de factures terminé', 'Nouvelles créances confiées', true, false],
  ['mention', 'Mention par un collègue', 'Dans une note de dossier', true, true],
];
const seed = (session: Session): AccountData => ({
  signature: [],
  absence: { substituteId: '', from: '', to: '', autoReply: false },
  substitutes: [
    { id: 'hb', name: 'Hugo Benali' },
    { id: 'sm', name: 'Sarah Morel' },
    { id: 'tg', name: 'Thomas Giraud' },
  ].filter((item) => item.id !== session.userId),
  passwordChangedOn: '2026-09-02',
  twoFactor: session.twoFactorEnabled
    ? { enabled: true, method: 'TOTP', mandatory: session.role === 'DEVELOPER', since: '2026-01-14' }
    : { enabled: false, method: null, mandatory: session.role === 'DEVELOPER', since: null },
  sessions: [
    { id: 's1', device: 'Chrome · Windows', meta: 'Paris · actuellement', mobile: false, current: true },
    { id: 's2', device: 'Navigateur mobile · iPhone', meta: 'Paris · il y a 2 h', mobile: true, current: false },
    { id: 's3', device: 'Edge · Windows (poste accueil)', meta: 'Paris · 18 nov. 2026', mobile: false, current: false },
  ],
  notifications: PREFS.map(([id, label, detail, inApp, email]) => ({ id, label, detail, inApp, email })),
  dailySummary: true,
  quietHours: true,
});
const accounts = new Map<string, AccountData>();
export const resetAccounts = () => {
  accounts.clear();
  state.delegations = ['TECHNICAL', 'ADMINISTRATIVE'];
  state.names.clear();
};
const own = (session: Session) => {
  const item = accounts.get(session.userId) ?? seed(session);
  accounts.set(session.userId, item);
  return item;
};
const withoutCases = new Set(['payment', 'promise', 'message', 'deadline', 'creditor', 'failure', 'import', 'mention']);

export const accountHandlers = [
  http.get(
    '/api/account',
    guarded(staff, (_info, session) => {
      const data = own(session);
      // The signature is built by the API: name, role label, mailbox. Nothing is typed by hand.
      const signature = [`${session.firstName} ${session.lastName}`, ROLE_LABELS[session.role], session.email];
      return HttpResponse.json({
        ...data,
        signature,
        notifications: session.role === 'DEVELOPER' ? data.notifications.filter((item) => !withoutCases.has(item.id)) : data.notifications,
      });
    }),
  ),
  http.put(
    '/api/account/profile',
    guarded<Info>(staff, async ({ request }, session) => {
      state.names.set(session.userId, (await request.json()) as { firstName: string; lastName: string });
      return done();
    }),
  ),
  http.put(
    '/api/account/absence',
    guarded<Info>(staff, async ({ request }, session) => {
      own(session).absence = (await request.json()) as AccountData['absence'];
      return done();
    }),
  ),
  http.put(
    '/api/account/notifications',
    guarded<Info>(staff, async ({ request }, session) => {
      Object.assign(own(session), (await request.json()) as Partial<AccountData>);
      return done();
    }),
  ),
  http.put(
    '/api/account/password',
    guarded<Info>(staff, async ({ request }, session) => {
      const { current } = (await request.json()) as { current: string };
      if (current === 'mauvais') return HttpResponse.json({ code: 'INVALID_CREDENTIALS' }, { status: 422 });
      own(session).passwordChangedOn = '2026-11-24';
      return done();
    }),
  ),
  http.post(
    '/api/account/two-factor/totp',
    guarded(staff, () => HttpResponse.json({ uri: 'otpauth://totp/Legarec:demo?secret=DEMODEMODEMODEMO&issuer=Legarec', key: 'DEMO DEMO DEMO DEMO' })),
  ),
  http.post(
    '/api/account/two-factor/totp/verify',
    guarded<Info>(staff, async ({ request }, session) => {
      const { code } = (await request.json()) as { code: string };
      if (code !== '123456') return HttpResponse.json({ code: 'INVALID_CODE' }, { status: 422 });
      own(session).twoFactor = { ...own(session).twoFactor, enabled: true, method: 'TOTP', since: '2026-11-24' };
      return done();
    }),
  ),
  http.post(
    '/api/account/two-factor/webauthn',
    guarded(staff, (_info, session) =>
      HttpResponse.json({
        challenge: 'ZGVtby1jaGFsbGVuZ2U',
        rp: { name: 'Legarec', id: 'localhost' },
        user: { id: 'ZGVtbw', name: session.userId, displayName: 'Compte Legarec' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        timeout: 60000,
      }),
    ),
  ),
  http.post(
    '/api/account/two-factor/webauthn/verify',
    guarded(staff, (_info, session) => {
      own(session).twoFactor = { ...own(session).twoFactor, enabled: true, method: 'WEBAUTHN', since: '2026-11-24' };
      return done();
    }),
  ),
  http.delete(
    '/api/account/two-factor',
    guarded(staff, (_info, session) => {
      if (session.role === 'DEVELOPER') return forbidden();
      own(session).twoFactor = { enabled: false, method: null, mandatory: false, since: null };
      return done();
    }),
  ),
  http.delete(
    '/api/account/sessions/:id',
    guarded<Info>(staff, ({ params }, session) => {
      const data = own(session);
      const target = data.sessions.find((item) => item.id === params.id);
      if (!target) return notFound();
      if (target.current) return forbidden();
      data.sessions = data.sessions.filter((item) => item !== target);
      return done();
    }),
  ),
  http.delete(
    '/api/account/sessions',
    guarded(staff, (_info, session) => {
      const data = own(session);
      data.sessions = data.sessions.filter((item) => item.current);
      return done();
    }),
  ),
  // Only the Director gives or withdraws a delegation: a delegate can never take one.
  http.put(
    '/api/delegations/:kind',
    guarded<Info>(
      (session) => session.role === 'DIRECTOR',
      async ({ params, request }) => {
        const { active } = (await request.json()) as { active: boolean };
        const kind = params.kind === 'technical' ? 'TECHNICAL' : 'ADMINISTRATIVE';
        state.delegations = active ? [...new Set([...state.delegations, kind] as const)] : state.delegations.filter((item) => item !== kind);
        return done();
      },
    ),
  ),
  http.get(
    '/api/delegations',
    guarded(
      (session) => session.role === 'DIRECTOR',
      () =>
        HttpResponse.json({
          technical: state.delegations.includes('TECHNICAL'),
          administrative: state.delegations.includes('ADMINISTRATIVE'),
          developer: 'Nora Petit',
          manager: 'Camille Laurent',
        }),
    ),
  ),
  http.post('/api/support-tickets', () => (currentSession() ? HttpResponse.json({ number: '2026-1184' }) : new HttpResponse(null, { status: 401 }))),
];
