import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { acceptsBody, REQUEST_BODIES, requestBody } from './requests';
import { TEMPLATE_MAX_BYTES } from './templates';

describe('bodies of the requests', () => {
  it('find the schema of a real path, the most precise one first', () => {
    expect(requestBody('staff', 'POST', '/cases/reminders')).toBe(REQUEST_BODIES.staff['POST /cases/reminders']);
    expect(requestBody('staff', 'POST', '/cases/demo/reminders')).toBe(REQUEST_BODIES.staff['POST /cases/:id/reminders']);
    expect(requestBody('staff', 'PUT', '/cases/demo/reminders')).toBeNull();
    expect(requestBody('partner', 'POST', '/portal/claims')).toBe(REQUEST_BODIES.partner['POST /portal/claims']);
  });

  it('refuse what the contract refuses, and any body on a route that takes none', () => {
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{"text":"Bonjour"}')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{"text":""}')).toBe(false);
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{}')).toBe(false);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '{}')).toBe(true);
    expect(acceptsBody('staff', 'POST', '/mailboxes/b1/password', '{"password":"x"}')).toBe(false);
  });

  it('limit every text: no body without a ceiling reaches a message or a letter', () => {
    const long = 'x'.repeat(30_000);
    for (const [path, body] of [
      ['/cases/demo/portal-messages', { text: long }],
      ['/cases/demo/reminders', { channel: 'E-mail', template: 'x', recipient: 'x', message: long }],
      ['/sms/s1/messages', { text: long }],
      ['/emails/e1/replies', { text: long }],
    ] as const)
      expect(acceptsBody('staff', 'POST', path, JSON.stringify(body)), path).toBe(false);
  });
});

type Portal = keyof typeof REQUEST_BODIES;
const INVOICE = { number: 'F-2026-1132', externalRef: 'MA-2410', issuedOn: '2026-10-12', dueOn: '2026-11-11', amount: 264000, left: 164000 };
const IDENTITY = {
  legalName: 'X SAS',
  name: 'X',
  sector: '',
  vatNumber: '',
  address: '6 rue du Four',
  postalCode: '69100',
  city: 'Villeurbanne',
  managerId: null,
  portalEnabled: true,
};
const CONTACTS = [{ name: 'Élodie Rivaud', title: '', email: 'e.rivaud@exemple.test', phone: '', isMain: true }];
const MANDATE = {
  startsOn: '2026-01-01',
  endsOn: null,
  amicableRateBp: 800,
  litigationRateBp: 1200,
  openingFeeCents: 0,
  planMonthsWithoutConsent: 6,
  discountMaxBp: 500,
  litigationNeedsConsent: true,
  deferSmallRemittances: false,
  interestMode: 'NONE',
  contractRateBp: null,
  fixedIndemnity: true,
  reportingDay: 5,
  scenario: 'BUSINESS',
};
const passkey = {
  id: 'cle',
  rawId: 'cle',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {},
};
const auth = {
  'POST /auth/two-factor': [
    { method: 'TOTP', code: '123456' },
    { method: 'BACKUP_CODE', code: 'ABCD-2345' },
    { method: 'WEBAUTHN', response: passkey },
  ],
  'POST /auth/forgot-password': [{ email: 'cl@legarec.fr' }],
  'POST /auth/reset/:token': [{ password: 'motdepasse12' }],
  'POST /auth/invitation/:token/password': [{ password: 'motdepasse12' }],
  'POST /auth/invitation/:token/totp': [{ code: '123456' }],
  'POST /auth/setup/totp/verify': [{ code: '123456' }],
};
const qualification = {
  tcxCode: 'ABSENT',
  interlocutor: 'Julien Ferrand',
  notes: 'M. Ferrand confirme un virement de 18 600 € pour F-2026-0712 d’ici le 28/11.',
  promise: null,
  alreadyPaid: null,
  dispute: null,
  absent: null,
  months: null,
  recall: null,
  announced: true,
  sendRecap: false,
};
const letter = { channel: 'Lettre recommandée avec AR (MySendingBox)', delay: 8, months: 4, options: { table: true, pay: true, indemnity: true } };

/** Bodies as the screens send them: the calls of the portals, and the demonstration data of the mockup. */
const BODIES: { [P in Portal]: Record<keyof (typeof REQUEST_BODIES)[P], readonly unknown[]> } = {
  staff: {
    'POST /auth/login': [{ email: 'cl@legarec.fr', password: 'motdepasse12', portal: 'espace', remember: false }],
    ...auth,
    'POST /auth/proof': [
      { method: 'PASSWORD', password: 'x' },
      { method: 'TOTP', code: '123456' },
      { method: 'BACKUP_CODE', code: '4821-7730' },
      { method: 'WEBAUTHN', response: { id: 'x' } },
    ],
    'PUT /auth/preferences': [{ theme: 'light', density: 'comfortable', lowVision: true }],
    'POST /notifications/read': [{ ids: ['n1', 'n2'] }, { ids: [] }],
    'PUT /notifications': [{ ids: ['n1', 'n2', 'n3', 'n4'], unread: false }],
    'POST /search': [{ query: 'batiplus' }, { query: '' }],
    'PUT /dashboard/priorities/:id': [{ done: true }],
    'PUT /account/profile': [{ firstName: 'Camille', lastName: 'Laurent' }],
    'PUT /account/absence': [
      { substituteId: 'tg', from: '2026-12-01', to: '2026-12-05', autoReply: true },
      { substituteId: '', from: '', to: '', autoReply: false },
    ],
    'PUT /account/password': [{ current: 'motdepasse12', next: 'Nouveau-mot-2026' }],
    'PUT /account/notifications': [
      { dailySummary: true },
      { quietHours: false },
      { notifications: [{ id: 'promise', label: 'Promesse non tenue', detail: 'Le jour même', inApp: true, email: false }] },
    ],
    'POST /account/two-factor/totp/verify': [{ code: '123456' }],
    'POST /account/two-factor/webauthn/verify': [
      { id: 'cle', rawId: 'cle', type: 'public-key', response: { clientDataJSON: 'e30', attestationObject: 'AA' }, authenticatorAttachment: 'platform' },
    ],
    'PUT /delegations/:kind': [{ active: false }],
    'POST /support-tickets': [{ subject: 'Question sur une fonctionnalité', message: 'Comment exporter la liste des dossiers ?' }],
    'PUT /calls/incoming': [{ answered: true }],
    'POST /calls/:id/qualification': [
      { ...qualification, outcome: 'ABSENT', absent: { voicemail: true, smsLink: false } },
      {
        ...qualification,
        outcome: 'PROMISE_TO_PAY',
        tcxCode: 'PROMESSE',
        promise: { amount: 1_860_000, date: '2026-11-28', method: 'TRANSFER', invoices: ['F-2026-0712'] },
        sendRecap: true,
      },
      { ...qualification, outcome: 'ALREADY_PAID', tcxCode: 'DEJA_PAYE', alreadyPaid: { paidOn: '2026-11-20', reference: 'VIR-123' } },
      {
        ...qualification,
        outcome: 'DISPUTE',
        tcxCode: 'LITIGE',
        dispute: { reason: 'La prestation n’est pas conforme', suspendReminders: true, askCreditor: true },
      },
      { ...qualification, outcome: 'PAYMENT_PLAN', tcxCode: 'ECHEANCIER', months: 4 },
      { ...qualification, outcome: 'CALLBACK', tcxCode: 'RAPPEL', recall: 'tomorrow' },
      { ...qualification, outcome: 'NO_ANSWER', tcxCode: 'NON_REPONSE', interlocutor: '', notes: '', announced: false },
    ],
    'POST /calls/:id/ai-decision': [{ decision: 'ACCEPTED' }, { decision: 'IGNORED' }],
    'POST /cases': [
      {
        creditorId: 'md',
        mandateId: 'md-m1',
        externalReference: '',
        kind: 'COMPANY',
        number: '732 829 320 00074',
        name: 'Menuiserie Arnal',
        nameConfirmed: true,
        legalForm: '5499',
        address: '18 chemin des Scieurs',
        postalCode: '38500',
        city: 'Voiron',
        contactName: '',
        contactTitle: '',
        contacts: [{ kind: 'PHONE', label: 'Standard', value: '04 76 00 00 21', primary: true }],
        invoices: [INVOICE],
        scenario: 'BUSINESS',
        toMe: true,
        expected: { principal: 164000, invoices: 1 },
      },
    ],
    'POST /cases/check': [{ creditorId: 'md', number: '732 829 320 00074' }],
    'POST /cases/:id/invoices': [{ version: 1, invoices: [INVOICE], expected: { principal: 164000, invoices: 1 } }],
    'POST /creditors': [{ siren: '732829320', identity: IDENTITY, contacts: CONTACTS, mandate: MANDATE }],
    'PUT /creditors/:id': [{ version: 1, identity: IDENTITY, contacts: CONTACTS }],
    'POST /creditors/:id/amendments': [{ amends: 'm1', mandate: MANDATE }],
    'POST /creditors/:id/bank-accounts': [
      { replaces: null, account: { holder: 'X', iban: 'GB82 WEST 1234 5698 7654 32', bic: 'PSSTFRPPXXX', confirmedWith: '' } },
    ],
    'POST /creditors/:id/bank-accounts/:accountId/confirm': [{ confirmedWith: 'Élodie Rivaud' }],
    'POST /cases/:id/access-code/regenerate': [{ version: 1 }],
    'POST /cases/:id/coordinates': [
      { kind: 'PHONE', label: 'Mobile', value: '0611223344', primary: false, replaces: 'p1', source: 'CALL' },
      { kind: 'EMAIL', label: 'Comptabilité', value: 'compta@batiplus.example', primary: true, replaces: null, source: 'CREDITOR' },
    ],
    'PUT /cases/:id/coordinates/:coordinateId': [
      { status: 'VERIFIED' },
      { status: 'PENDING' },
      { status: 'UNVERIFIED' },
      { status: 'INVALID', primary: false },
      { primary: true },
    ],
    'POST /cases/search': [{ query: '' }, { query: 'batiplus' }],
    'POST /cases/reminders': [{ ids: ['demo', 'lagarde'] }],
    'POST /cases/litigation': [{ ids: ['demo'], reason: 'Promesses non tenues' }],
    'POST /cases/assign': [{ ids: ['helio'], officerId: 'hb' }],
    'POST /cases/:id/portal-messages': [{ text: 'Bien reçu, merci.' }],
    'POST /cases/:id/payments': [
      { method: 'TRANSFER', amount: 10_000, receivedOn: '2026-11-24', label: 'Virement', reconciled: true },
      { method: 'CHEQUE', amount: 150_050, chequeNumber: '1234567', bank: 'Banque test', receivedOn: '2026-11-25', depositedOn: null },
    ],
    'PUT /cases/:id/payments/:paymentId': [
      { status: 'BOUNCED', reason: 'Provision insuffisante', version: 1 },
      { status: 'CASHED', version: 2 },
      { status: 'RECONCILED', version: 1 },
    ],
    'POST /cases/:id/reminders': [{ channel: 'E-mail', template: 'Relance n°1', recipient: 'compta@batiplus.example', message: 'Bonjour' }],
    'POST /gdpr/requests': [{ caseId: 'meunier', kind: 'ACCESS', origin: 'Courrier' }],
    'PUT /gdpr/requests/:id': [
      { status: 'ANSWERED', reason: 'Copie envoyée par courrier' },
      { status: 'REFUSED', reason: 'Demande déjà traitée' },
    ],
    'POST /reminders': [
      { caseId: 'demo', type: 'CALL', date: '2026-11-21', time: '', title: 'Point sur la promesse' },
      { caseId: 'demo', type: 'EMAIL', date: '2026-11-24', time: '10:00', title: 'Relance' },
    ],
    'PUT /reminders/:id': [{ date: '2026-11-22' }, { done: true }, { done: false }],
    'POST /payment-plans': [{ caseId: 'demo', months: 4, method: 'TRANSFER', expected: 2_960_000 }],
    'PUT /payment-plans/requests/:id': [
      { decision: 'REFUSED', reason: 'Accord refusé', version: 1 },
      { decision: 'APPROVED', version: 2 },
    ],
    'PUT /interest-rates': [{ kind: 'ECB', validFrom: '2026-07-01', rateBp: 215, expected: null }],
    'POST /documents/compose': [
      { ...letter, template: 'FORMAL_NOTICE', caseIds: ['demo'], filters: null, expected: 1 },
      { ...letter, template: 'FRIENDLY', caseIds: null, filters: { creditor: 'md', age: '31-60' }, expected: 13 },
      { ...letter, template: 'FRIENDLY', caseIds: null, filters: null, expected: 38 },
    ],
    'POST /documents/compose/draft': [{ template: 'FRIENDLY', caseId: 'demo' }],
    'POST /emails/messages': [{ to: 'compta@batiplus.example', subject: 'Votre dossier', paragraphs: ['Bonjour'], caseId: 'demo', statement: false }],
    'POST /emails/drafts': [
      { to: '', subject: 'Confirmation de votre engagement', text: 'Bonjour,\n\nMerci.', caseId: null },
      { id: 'd1', to: 'compta@batiplus.example', subject: 'Point', text: 'Bonjour', caseId: 'demo' },
    ],
    'PUT /emails/:id/archive': [{ archived: true }],
    'PUT /emails/:id/category': [{ category: 'OTHER' }],
    'POST /emails/:id/replies': [{ text: 'Bonjour Monsieur Ferrand,\n\nMerci pour votre message.', statement: false }],
    'POST /sms/:id/messages': [{ text: 'Legarec : votre règlement est attendu. 01 87 88 02 98. STOP au 36105' }],
    'POST /sms/:id/link': [{ caseId: 'demo' }],
    'POST /billing': [
      {
        type: 'INVOICE',
        templateId: 'commission',
        clientId: 'md',
        lines: [{ quantity: 1, unitPrice: 497_440, label: 'Commission de recouvrement · 8 % de 62 180,00 € encaissés en novembre 2026' }],
        terms: [],
        draft: false,
      },
      { type: 'CONTRACT', templateId: 'mandat', clientId: 'md', lines: [], terms: [{ id: 'rate', label: 'Taux', value: '8 %' }], draft: true },
    ],
    'PUT /reports/scheduled/:id': [{ active: true }],
    'POST /members': [
      { firstName: 'Ana', lastName: 'Costa', role: 'CLAIMS_OFFICER', email: 'ac@legarec.fr' },
      { firstName: 'Ana', lastName: 'Costa', role: 'CREDITOR', email: 'a@exemple.fr', creditorId: 'md' },
    ],
    'PUT /members/:id/role': [{ role: 'CLAIMS_OFFICER' }],
    'POST /members/:id/disable': [{ reason: 'Départ', cases: 12 }],
    'PUT /members/:id/extension': [{ extension: '104' }, { extension: null }],
    'PUT /settings/:scope/:id': [{ duration: '12 mois' }, { iban: '[IBAN DU COMPTE DÉDIÉ]' }, { dailyCap: true }],
    'POST /secrets': [{ name: 'AI_API_KEY', value: 'valeur-fictive-de-test', rotation: '90' }],
    'POST /secrets/:id/rotate': [{ value: 'valeur-fictive-de-test' }, {}],
    'POST /mailboxes': [
      { local: 'ac', holderId: null, sizeMb: 5000, requestId: '646c222a-4b11-4a27-acc8-6cf1909fc115' },
      { local: 'ac', holderId: 'hb', sizeMb: 5000 },
    ],
    'POST /mailboxes/:id/redirections': [{ to: 'recouvrement@legarec.fr' }],
    'PUT /mailboxes/:id/redirections/:redirectionId': [{ to: 'recouvrement@legarec.fr' }],
    'PUT /mailboxes/:id/auto-reply': [
      { text: 'Bonjour, je ne fais plus partie du cabinet.', until: null },
      { text: 'Bonjour, je suis absent.', until: '2026-12-05' },
    ],
    'POST /templates/:id/import': [{ fileName: 'mise-en-demeure-v5.html', source: '<p>{{debiteur.raison_sociale}}</p>' }],
    'POST /templates/:id/restore': [{}, { version: 3 }],
    'POST /templates/:id/submit': [{ acknowledged: true }],
    'POST /templates/:id/review': [{ approved: true, reason: '' }, { approved: true }, { approved: false, reason: 'Mention absente' }],
  },
  partner: {
    'POST /auth/login': [{ email: 'c.besson@materiauxdelta.example', password: 'motdepasse12', portal: 'partenaires', remember: false }],
    ...auth,
    'POST /portal/plans/:id/decision': [
      { accepted: true, reason: '' },
      { accepted: false, reason: 'Délai trop long' },
    ],
    'POST /portal/claims': [
      {
        debtor: 'Menuiserie Test',
        siret: '',
        email: 'contact@exemple.fr',
        phone: '',
        address: '1 rue du Test',
        invoices: [{ number: 'F-1', issuedOn: '2026-09-01', dueOn: '2026-10-01', amount: 125_050 }],
        attachments: ['piece-1'],
      },
    ],
    'POST /portal/messages/:id': [{ text: 'Bonjour, une facture a été réglée.' }],
  },
  debtor: {
    'POST /debtor/access': [
      { identifier: { kind: 'SIREN', value: '732829320' }, code: 'KXPM', remember: false },
      { identifier: { kind: 'REFERENCE', value: 'LGR-2026-00181' }, code: 'KXPM', remember: true },
    ],
    'POST /debtor/code-by-sms': [
      { kind: 'SIREN', value: '732829320' },
      { kind: 'REFERENCE', value: 'LGR-2026-00181' },
    ],
    'POST /debtor/limited/messages': [
      { name: 'Test', email: '', reference: '', text: 'Bonjour', attachments: [] },
      { name: 'Test', email: 'a@exemple.fr', reference: 'LGR-2026-00181', text: 'Bonjour', attachments: [{ id: 'f1', name: 'virement.pdf' }] },
    ],
    'POST /debtor/cases/:id/messages': [{ text: 'Bonjour', attachmentKind: 'TRANSFER_PROOF', attachments: [{ id: 'f1', name: 'virement.pdf' }] }],
    'POST /debtor/cases/:id/requests': [
      { kind: 'PLAN', months: 6, note: '' },
      {
        kind: 'DISPUTE',
        reason: 'Le montant est erroné',
        text: 'La facture porte sur dix unités livrées sur douze.',
        attachments: [{ id: 'f1', name: 'bon.pdf' }],
      },
      { kind: 'ALREADY_PAID', paidOn: '2026-11-20', amount: 125_050, method: 'TRANSFER', attachments: [] },
      { kind: 'CALLBACK', phone: '06 12 34 56 78', slot: 'MORNING' },
    ],
  },
};
/** Only here may a body be empty: nothing to change, or a version to restore that is not named. */
const MAY_BE_EMPTY = [
  'POST /secrets/:id/rotate',
  'PUT /account/notifications',
  'PUT /cases/:id/coordinates/:coordinateId',
  'PUT /reminders/:id',
  'PUT /settings/:scope/:id',
  'POST /templates/:id/restore',
  'POST /account/two-factor/webauthn/verify',
];
/** Answers of the browser, fields of a setting, terms of a contract: their content is checked further by the API. */
const OPEN = ['POST /account/two-factor/webauthn/verify', 'PUT /settings/:scope/:id'];
const ROUTES = (Object.keys(BODIES) as Portal[]).flatMap((portal) =>
  Object.entries(BODIES[portal] as Record<string, readonly unknown[]>).map(([route, bodies]) => ({
    portal,
    route,
    bodies,
    schema: (REQUEST_BODIES[portal] as Record<string, z.ZodType>)[route]!,
  })),
);
const real = (route: string) => route.split(' ') as [string, string];
const concrete = (path: string) => path.replace(/:\w+/gu, 'x1');

describe('every body of the portals', () => {
  it.each(ROUTES)('$portal $route: accepts what its screen sends, and loses nothing of it', ({ portal, route, bodies, schema }) => {
    expect(bodies.length).toBeGreaterThan(0);
    const [method, path] = real(route);
    for (const body of bodies) {
      expect(acceptsBody(portal, method, concrete(path), JSON.stringify(body)), JSON.stringify(body)).toBe(true);
      // A field that the contract does not know would never reach the API.
      expect(schema.parse(body)).toEqual(expect.objectContaining(body as object));
    }
  });

  it.each(ROUTES)('$portal $route: refuses an empty body, unless nothing is mandatory', ({ portal, route, schema }) => {
    expect(schema.safeParse({}).success).toBe(MAY_BE_EMPTY.includes(route));
    for (const nothing of [undefined, null, [], '', 'x', 0, true]) expect(schema.safeParse(nothing).success, JSON.stringify(nothing)).toBe(false);
    const [method, path] = real(route);
    expect(acceptsBody(portal, method, concrete(path), '{}')).toBe(MAY_BE_EMPTY.includes(route));
    expect(acceptsBody(portal, method, concrete(path), '[]')).toBe(false);
  });

  it('checks the type of each field, and drops the fields it does not know', () => {
    for (const { route, bodies, schema } of ROUTES.filter((item) => !OPEN.includes(item.route))) {
      for (const body of bodies as Record<string, unknown>[]) {
        for (const field of Object.keys(body)) {
          // The answer of a security key is opaque: checked by the API itself.
          if (field === 'response') continue;
          for (const wrong of [{ zz: 1 }, Number.NaN]) expect(schema.safeParse({ ...body, [field]: wrong }).success, `${route} ${field}`).toBe(false);
        }
        for (const forged of ['creditor_id', 'actorId', 'officer_id', 'isAdmin'])
          expect(schema.parse({ ...body, [forged]: 'zz' }), `${route} ${forged}`).not.toHaveProperty(forged);
      }
    }
  });

  it('is found by its own path, by no other method, and only in its portal', () => {
    for (const { portal, route, schema } of ROUTES) {
      const [method, path] = real(route);
      expect(requestBody(portal, method, concrete(path)), route).toBe(schema);
      expect(requestBody(portal, method, `${concrete(path)}/more`), route).not.toBe(schema);
      for (const other of ['GET', 'DELETE', 'PATCH', method.toLowerCase()]) expect(requestBody(portal, other, concrete(path)), `${other} ${path}`).toBeNull();
      if (portal === 'debtor') for (const other of ['staff', 'partner'] as const) expect(requestBody(other, method, concrete(path)), route).toBeNull();
    }
  });

  it('refuses the absence of a mandatory body', () => {
    for (const { portal, route } of ROUTES.filter((item) => !MAY_BE_EMPTY.includes(item.route))) {
      const [method, path] = real(route);
      expect(acceptsBody(portal, method, concrete(path), ''), route).toBe(false);
    }
  });
  it('refuses a body that is not JSON', () => {
    expect(acceptsBody('staff', 'POST', '/cases/demo/portal-messages', '{')).toBe(false);
  });
});

describe('ceilings', () => {
  const LONG = 40_000;
  const TEXTS = ['x'.repeat(LONG), `${'x'.repeat(LONG)}@legarec.fr`, 'Aa1!'.repeat(LONG / 4)];
  type Place = (string | number)[];
  const places = (value: unknown, path: Place = []): Place[] => {
    if (Array.isArray(value)) return value.length ? [path, ...places(value[0], [...path, 0])] : [];
    if (value && typeof value === 'object') return Object.entries(value).flatMap(([name, child]) => places(child, [...path, name]));
    return ['string', 'number'].includes(typeof value) ? [path] : [];
  };
  const change = (value: unknown, [head, ...tail]: Place, made: (current: unknown) => unknown): unknown => {
    if (head === undefined) return made(value);
    if (Array.isArray(value)) return value.map((item: unknown, index) => (index === head ? change(item, tail, made) : item));
    return { ...(value as object), [head]: change((value as Record<string, unknown>)[head], tail, made) };
  };
  /** Texts, lists and numbers of the body that may be as long or as big as the caller likes. */
  const open = (schema: z.ZodType, bodies: readonly unknown[]) => {
    const found = new Set<string>();
    for (const body of bodies) {
      for (const path of places(body)) {
        const name = path.map((part) => (typeof part === 'number' ? '[]' : `.${part}`)).join('');
        const list = (current: unknown) => Array.from({ length: 5_000 }, () => (current as unknown[])[0]);
        const tries = [...TEXTS, 1e12, -1e12].map((value) => change(body, path, (current) => (Array.isArray(current) ? list(current) : value)));
        // Spaces inside a valid text: what a check that removes them lets through, if nothing else stops it.
        const spaced: unknown[] = [];
        change(body, path, (current) => {
          // Inside, between two signs: around them, `trim()` takes them away.
          if (typeof current === 'string' && current.trim().length >= 2)
            spaced.push(change(body, path, () => `${current.slice(0, 1)}${' '.repeat(LONG)}${current.slice(1)}`));
          return current;
        });
        if ([...tries, ...spaced].some((attempt) => schema.safeParse(attempt).success)) found.add(name.slice(1));
      }
    }
    return [...found].sort();
  };

  it('are measured on real bodies', () => {
    const sample = z.object({
      a: z.string(),
      b: z.string().max(3),
      c: z.array(z.string().max(3)),
      d: z.array(z.string()).max(2),
      e: z.enum(['X']),
      f: z.email(),
      g: z.number().max(3),
      h: z.number().min(0).max(3),
    });
    expect(open(sample, [{ a: 'x', b: 'x', c: ['x'], d: ['x'], e: 'X', f: 'a@exemple.fr', g: 1, h: 1 }])).toEqual(['a', 'c', 'd[]', 'f', 'g']);
  });

  /** The file of a template is longer than any text: its own ceiling is proven below. */
  const FILES: Record<string, string[]> = { 'POST /templates/:id/import': ['source'] };
  it.each(ROUTES)('$portal $route: every text, every list and every number has one', ({ route, schema, bodies }) => {
    // The answer of a security key is opaque: checked by the API itself.
    if (OPEN.includes(route)) return;
    expect(open(schema, bodies).filter((place) => !place.startsWith('response'))).toEqual(FILES[route] ?? []);
  });

  it('bound what has no shape: the answer of a security key, and the settings', () => {
    const key = (size: number) => JSON.stringify({ method: 'WEBAUTHN', response: { id: 'x'.repeat(size) } });
    expect([1_000, 30_000].map((size) => acceptsBody('staff', 'POST', '/auth/two-factor', key(size)))).toEqual([true, false]);
    const settings = (count: number) => JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, index) => [`s${index}`, 'x'])));
    expect([100, 101].map((count) => acceptsBody('staff', 'PUT', '/settings/firm/rules', settings(count)))).toEqual([true, false]);
  });

  it('leave to the file of a template the size announced on its screen, and stop at the megabyte that the API reads', () => {
    const accepts = (size: number) =>
      acceptsBody('staff', 'POST', '/templates/t1/import', JSON.stringify({ fileName: 'modele.html', source: 'x'.repeat(size) }));
    expect([accepts(TEMPLATE_MAX_BYTES), accepts(1_000_000), accepts(1_000_001)]).toEqual([true, true, false]);
  });
});
