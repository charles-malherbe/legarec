import {
  accountData,
  delegationsData,
  linkInfo,
  loginResponse,
  membersData,
  notificationItem,
  partnerSession,
  secretsData,
  settingsHub,
  settingsSection,
  session,
  ticketSent,
  totpSetup,
  webauthnOptions,
} from '@legarec/contracts';
import { z } from 'zod';

export type ParityRole = 'director' | 'manager' | 'developer' | 'officer' | 'partner' | 'nobody';
export interface Parity {
  as: ParityRole;
  /** `{officer}`, `{creditor}`… stand for the identifiers of each side. */
  request: string;
  body?: unknown;
  status: number;
  /** Body of the answer: nothing more than the contract, nothing less. */
  answer?: z.ZodType;
}
const code = (value: string) => z.strictObject({ code: z.literal(value) });
const refused = (value: string) => z.looseObject({ code: z.literal(value) });
/** What was asked no longer holds. */
const CHANGED = { status: 409, answer: code('CHANGED') };
const UNKNOWN = '00000000-0000-7000-8000-000000000000';
const person = { firstName: 'Iris', lastName: 'Test' };
const STAFF = ['director', 'manager', 'developer', 'officer'] as const;
const each = <T extends ParityRole>(roles: readonly T[], of: (as: T) => Omit<Parity, 'as'>): Parity[] => roles.map((as) => ({ as, ...of(as) }));

/** The same requests, to the simulations and to the API: the screens meet the same answers. */
export const ACCOUNT_PARITY: Parity[] = [
  ...each(STAFF, () => ({ request: 'GET /auth/session', status: 200, answer: session })),
  ...['GET /auth/session', 'GET /account', 'GET /members', 'GET /delegations'].map((request) => ({
    as: 'nobody' as const,
    request,
    status: 401,
    answer: code('UNAUTHORIZED'),
  })),
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'inconnu@exemple.test', password: 'faux', portal: 'espace' },
    status: 401,
    answer: refused('INVALID_CREDENTIALS'),
  },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'pas-une-adresse', password: 'faux', portal: 'espace' },
    status: 422,
    answer: refused('INVALID'),
  },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'hb@legarec.fr', password: 'motdepasse12', portal: 'espace' },
    status: 200,
    answer: loginResponse,
  },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'c.besson@materiauxdelta.example', password: 'motdepasse12', portal: 'espace' },
    status: 200,
    answer: loginResponse,
  },
  { as: 'nobody', request: 'POST /auth/two-factor', body: { method: 'TOTP', code: '000000' }, status: 401, answer: code('UNAUTHORIZED') },
  { as: 'nobody', request: 'POST /auth/setup/totp', status: 401, answer: code('UNAUTHORIZED') },
  { as: 'nobody', request: 'POST /auth/setup/totp/verify', body: { code: '000000' }, status: 401, answer: code('UNAUTHORIZED') },
  { as: 'nobody', request: 'POST /auth/forgot-password', body: { email: 'personne@exemple.test' }, status: 204 },
  { as: 'nobody', request: 'GET /auth/reset/expire', status: 410, answer: code('EXPIRED') },
  { as: 'nobody', request: 'GET /auth/invitation/expire', status: 410, answer: code('EXPIRED') },
  { as: 'nobody', request: 'GET /auth/reset/{reset}', status: 200, answer: linkInfo },
  { as: 'nobody', request: 'GET /auth/invitation/{invitation}', status: 200, answer: linkInfo },
  { as: 'nobody', request: 'POST /auth/logout', status: 204 },
  { as: 'officer', request: 'PUT /auth/preferences', body: { theme: 'dark', density: 'compact', lowVision: false }, status: 204 },
  { as: 'officer', request: 'PUT /auth/preferences', body: { theme: 'pink', density: 'compact', lowVision: false }, status: 422, answer: refused('INVALID') },

  ...each(STAFF, () => ({ request: 'GET /account', status: 200, answer: accountData })),
  { as: 'officer', request: 'PUT /account/profile', body: person, status: 204 },
  { as: 'officer', request: 'PUT /account/profile', body: { firstName: ' ', lastName: 'Test' }, status: 422, answer: refused('INVALID') },
  { as: 'manager', request: 'PUT /account/absence', body: { substituteId: '{officer}', from: '2026-12-21', to: '2026-12-31', autoReply: true }, status: 204 },
  {
    as: 'officer',
    request: 'PUT /account/absence',
    body: { substituteId: '', from: '2026-12-31', to: '2026-12-21', autoReply: false },
    status: 422,
    answer: refused('INVALID'),
  },
  { as: 'officer', request: 'PUT /account/notifications', body: { quietHours: false }, status: 204 },
  {
    as: 'officer',
    request: 'PUT /account/password',
    body: { current: 'mauvais', next: 'Un-mot-de-passe-9!' },
    status: 422,
    answer: code('INVALID_CREDENTIALS'),
  },
  { as: 'officer', request: 'PUT /account/password', body: { current: 'mauvais', next: 'court' }, status: 422, answer: refused('INVALID') },
  { as: 'officer', request: 'POST /account/two-factor/totp', status: 200, answer: totpSetup },
  { as: 'officer', request: 'POST /account/two-factor/totp/verify', body: { code: 'xxxxxx' }, status: 422, answer: code('INVALID_CODE') },
  { as: 'officer', request: 'POST /account/two-factor/webauthn', status: 200, answer: webauthnOptions },
  { as: 'officer', request: 'DELETE /account/two-factor', status: 204 },
  { as: 'developer', request: 'DELETE /account/two-factor', status: 403, answer: code('FORBIDDEN') },
  { as: 'officer', request: `DELETE /account/sessions/${UNKNOWN}`, status: 404, answer: code('NOT_FOUND') },
  { as: 'officer', request: 'DELETE /account/sessions', status: 204 },

  ...each(['director', 'manager', 'developer'], () => ({ request: 'GET /members', status: 200, answer: membersData })),
  { as: 'officer', request: 'GET /members', status: 403, answer: code('FORBIDDEN') },
  { as: 'director', request: 'POST /members', body: { ...person, role: 'CLAIMS_OFFICER', email: 'iris@legarec.fr' }, status: 204 },
  { as: 'manager', request: 'POST /members', body: { ...person, role: 'CREDITOR', email: 'iris@client.example', creditorId: '{creditorId}' }, status: 204 },
  { as: 'director', request: 'POST /members', body: { ...person, role: 'CLAIMS_OFFICER', email: 'HB@legarec.fr' }, status: 409, answer: code('EMAIL_TAKEN') },
  { as: 'director', request: 'POST /members', body: { ...person, role: 'DEVELOPER', email: 'iris2@legarec.fr' }, status: 409, answer: refused('ROLE_TAKEN') },
  {
    as: 'director',
    request: 'POST /members',
    body: { ...person, role: 'CLAIMS_OFFICER', email: 'recouvrement@legarec.fr' },
    status: 422,
    answer: refused('INVALID'),
  },
  { as: 'developer', request: 'POST /members', body: { ...person, role: 'CLAIMS_OFFICER', email: 'iris3@legarec.fr' }, status: 403, answer: code('FORBIDDEN') },
  { as: 'director', request: `DELETE /members/${UNKNOWN}`, status: 404, answer: code('NOT_FOUND') },
  { as: 'director', request: 'DELETE /members/{officer}', status: 404, answer: code('NOT_FOUND') },
  { as: 'manager', request: 'POST /members/{officer}/disable', body: { reason: 'Départ', cases: 9999 }, status: 409, answer: code('CHANGED') },
  { as: 'manager', request: 'POST /members/{director}/disable', body: { reason: 'Départ', cases: 0 }, status: 403, answer: code('FORBIDDEN') },
  { as: 'manager', request: 'POST /members/{manager}/disable', body: { reason: 'Départ', cases: 0 }, status: 403, answer: code('FORBIDDEN') },
  { as: 'developer', request: 'POST /members/{officer}/disable', body: { reason: 'Départ', cases: 0 }, status: 403, answer: code('FORBIDDEN') },
  { as: 'manager', request: 'POST /members/{officer}/enable', status: 403, answer: code('FORBIDDEN') },
  { as: 'manager', request: 'PUT /members/{manager}/role', body: { role: 'DIRECTOR' }, status: 403, answer: code('FORBIDDEN') },
  { as: 'manager', request: 'PUT /members/{creditor}/role', body: { role: 'CLAIMS_OFFICER' }, status: 403, answer: code('FORBIDDEN') },
  { as: 'director', request: 'PUT /members/{officer}/role', body: { role: 'DEVELOPER' }, status: 409, answer: refused('ROLE_TAKEN') },
  { as: 'director', request: 'PUT /members/{officer}/role', body: { role: 'CREDITOR' }, status: 422, answer: refused('INVALID') },
  { as: 'developer', request: 'PUT /members/{officer}/extension', body: { extension: '118' }, status: 204 },
  { as: 'developer', request: 'PUT /members/{officer}/extension', body: { extension: '1' }, status: 422, answer: refused('INVALID') },
  { as: 'director', request: 'PUT /members/{officer}/extension', body: { extension: '118' }, status: 403, answer: code('FORBIDDEN') },
  // Nothing is locked; the officer and the Developer have a second factor, the creditor has none.
  ...['reset-link', 'require-2fa', 'reset-2fa', 'unlock'].flatMap((action): Parity[] => [
    { as: 'director', request: `POST /members/{officer}/${action}`, ...(action === 'unlock' ? CHANGED : { status: 204 }) },
    { as: 'developer', request: `POST /members/{officer}/${action}`, ...(action === 'unlock' ? CHANGED : { status: 204 }) },
    {
      as: 'manager',
      request: `POST /members/{officer}/${action}`,
      ...(action === 'reset-2fa' ? { status: 403, answer: code('FORBIDDEN') } : action === 'unlock' ? CHANGED : { status: 204 }),
    },
    { as: 'manager', request: `POST /members/{creditor}/${action}`, ...(action === 'unlock' || action === 'reset-2fa' ? CHANGED : { status: 204 }) },
    { as: 'manager', request: `POST /members/{director}/${action}`, status: 403, answer: code('FORBIDDEN') },
    { as: 'officer', request: `POST /members/{developer}/${action}`, status: 403, answer: code('FORBIDDEN') },
    { as: 'developer', request: `POST /members/{developer}/${action}`, status: 403, answer: code('FORBIDDEN') },
    { as: 'developer', request: `POST /members/{creditor}/${action}`, status: 404, answer: code('NOT_FOUND') },
    { as: 'director', request: `POST /members/${UNKNOWN}/${action}`, status: 404, answer: code('NOT_FOUND') },
  ]),
  { as: 'developer', request: 'POST /members/{director}/require-2fa', status: 403, answer: code('FORBIDDEN') },
  { as: 'developer', request: 'POST /members/{director}/reset-link', status: 204 },
  { as: 'director', request: 'POST /members/{developer}/reset-2fa', status: 204 },

  { as: 'director', request: 'GET /delegations', status: 200, answer: delegationsData },
  ...each(['manager', 'developer', 'officer'], () => ({ request: 'GET /delegations', status: 403, answer: code('FORBIDDEN') })),
  ...each(['manager', 'developer', 'officer'], () => ({
    request: 'PUT /delegations/technical',
    body: { active: true },
    status: 403,
    answer: code('FORBIDDEN'),
  })),
  { as: 'director', request: 'PUT /delegations/technical', body: { active: true }, status: 204 },
  { as: 'director', request: 'PUT /delegations/autre', body: { active: true }, status: 404, answer: code('NOT_FOUND') },

  ...each(STAFF, () => ({
    request: 'POST /support-tickets',
    body: { subject: 'Accès', message: 'Une question assez longue.' },
    status: 200,
    answer: ticketSent,
  })),
  { as: 'officer', request: 'POST /support-tickets', body: { subject: '', message: 'court' }, status: 422, answer: refused('INVALID') },
  ...each(STAFF, () => ({ request: 'GET /notifications', status: 200, answer: z.array(notificationItem) })),
  { as: 'officer', request: 'PUT /notifications', body: { ids: [UNKNOWN], unread: false }, status: 204 },
  { as: 'officer', request: 'POST /notifications/read', body: { ids: [UNKNOWN] }, status: 204 },

  ...each(['director', 'developer'], () => ({ request: 'GET /secrets', status: 200, answer: secretsData })),
  ...each(['manager', 'officer'], () => ({ request: 'GET /secrets', status: 403, answer: code('FORBIDDEN') })),
  { as: 'director', request: 'POST /secrets', body: { name: 'AI_API_KEY', value: 'valeur-fictive', rotation: '90' }, status: 204 },
  { as: 'developer', request: 'POST /secrets', body: { name: 'AI_API_KEY', value: 'autre', rotation: '90' }, status: 409, answer: code('SECRET_EXISTS') },
  { as: 'developer', request: 'POST /secrets', body: { name: 'SCW_ACCESS_KEY', value: 'valeur-fictive', rotation: 'MANUAL' }, status: 204 },
  { as: 'manager', request: 'POST /secrets', body: { name: 'AI_API_KEY', value: 'valeur-fictive', rotation: '90' }, status: 403, answer: code('FORBIDDEN') },
  { as: 'director', request: 'POST /secrets', body: { name: 'INCONNU', value: 'valeur-fictive', rotation: '90' }, status: 422, answer: refused('INVALID') },
  { as: 'director', request: `POST /secrets/${UNKNOWN}/rotate`, body: { value: 'valeur-fictive' }, status: 404, answer: code('NOT_FOUND') },
  { as: 'developer', request: `POST /secrets/${UNKNOWN}/revoke`, status: 404, answer: code('NOT_FOUND') },
  { as: 'developer', request: `POST /secrets/${UNKNOWN}/keep`, status: 403, answer: code('FORBIDDEN') },

  ...each(STAFF, () => ({ request: 'GET /settings/firm', status: 200, answer: settingsHub })),
  ...each(STAFF, () => ({ request: 'GET /settings/firm/cabinet', status: 200, answer: settingsSection })),
  ...each(['director', 'developer'], () => ({ request: 'GET /settings/techniques', status: 200, answer: settingsHub })),
  ...each(['director', 'developer'], () => ({ request: 'GET /settings/techniques/audit', status: 200, answer: settingsSection })),
  ...each(['manager', 'officer'], () => ({ request: 'GET /settings/techniques', status: 403, answer: code('FORBIDDEN') })),
  ...each(['manager', 'officer'], () => ({ request: 'GET /settings/techniques/audit', status: 403, answer: code('FORBIDDEN') })),
  { as: 'director', request: 'GET /settings/autre', status: 404, answer: code('NOT_FOUND') },
  { as: 'director', request: 'GET /settings/firm/autre', status: 404, answer: code('NOT_FOUND') },
  ...each(['director', 'manager'], () => ({ request: 'PUT /settings/firm/relances', body: { calls: '3' }, status: 204 })),
  ...each(['developer', 'officer'], () => ({ request: 'PUT /settings/firm/relances', body: { calls: '3' }, status: 403, answer: code('FORBIDDEN') })),
  { as: 'developer', request: 'PUT /settings/techniques/securite', body: { x5: false }, status: 204 },
  { as: 'manager', request: 'PUT /settings/firm/cabinet', body: { chequePayee: 'LEGAREC' }, status: 403, answer: code('FORBIDDEN') },
  { as: 'director', request: 'PUT /settings/firm/cabinet', body: { chequePayee: 'LEGAREC' }, status: 204 },
  { as: 'director', request: 'PUT /settings/firm/cabinet', body: { iban: 'FR00' }, status: 422, answer: refused('INVALID') },
  { as: 'director', request: 'PUT /settings/firm/relances', body: { calls: '99' }, status: 422, answer: refused('INVALID') },
  { as: 'director', request: 'PUT /settings/firm/autre', body: {}, status: 404, answer: code('NOT_FOUND') },
];

/** Sign-in of the creditors. */
export const PARTNER_PARITY: Parity[] = [
  { as: 'partner', request: 'GET /auth/session', status: 200, answer: partnerSession },
  { as: 'nobody', request: 'GET /auth/session', status: 401, answer: code('UNAUTHORIZED') },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'inconnu@exemple.test', password: 'faux', portal: 'partenaires' },
    status: 401,
    answer: refused('INVALID_CREDENTIALS'),
  },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'c.besson@materiauxdelta.example', password: 'motdepasse12', portal: 'partenaires' },
    status: 200,
    answer: loginResponse,
  },
  {
    as: 'nobody',
    request: 'POST /auth/login',
    body: { email: 'hb@legarec.fr', password: 'motdepasse12', portal: 'partenaires' },
    status: 200,
    answer: loginResponse,
  },
  { as: 'nobody', request: 'POST /auth/forgot-password', body: { email: 'personne@exemple.test' }, status: 204 },
  { as: 'nobody', request: 'GET /auth/reset/expire', status: 410, answer: code('EXPIRED') },
  { as: 'nobody', request: 'GET /auth/reset/{reset}', status: 200, answer: linkInfo },
  { as: 'nobody', request: 'GET /auth/invitation/expire', status: 410, answer: code('EXPIRED') },
  { as: 'nobody', request: 'GET /auth/invitation/{invitation}', status: 200, answer: linkInfo },
  { as: 'nobody', request: 'POST /auth/logout', status: 204 },
];

/** Same request with the identifiers of one side. */
export function filled(value: unknown, ids: Record<string, string>): unknown {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : (JSON.parse(text.replace(/\{(\w+)\}/gu, (whole, name: string) => ids[name] ?? whole)) as unknown);
}
