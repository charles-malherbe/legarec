import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_PARITY, filled, PARTNER_PARITY, type Parity, type ParityRole } from '../../../packages/contracts/test/accounts.parity';
import { AuthKeys } from '../src/modules/auth/keys';
import { newToken } from '../src/platform/crypto/keyring';
import { CHEAP, startApp, type TestApp } from './app';

/** The simulations answer the same: `src/mocks/parity.test.ts` of each portal. */
let test: TestApp;
let ids: Record<string, string>;
let partnerIds: Record<string, string>;
const AS: Record<ParityRole, string | undefined> = {
  director: 'director',
  manager: 'manager',
  developer: 'developer',
  officer: 'officerA',
  partner: 'partnerA',
  nobody: undefined,
};

beforeAll(async () => {
  test = await startApp();
  const { s, database } = test;
  const hash = await CHEAP.hash('motdepasse12');
  const rename = (id: string, email: string) => database.admin.query('UPDATE users SET email = $2, password_hash = $3 WHERE id = $1', [id, email, hash]);
  await rename(s.officerA, 'hb@legarec.fr');
  await rename(s.partnerA, 'c.besson@materiauxdelta.example');
  // Live links.
  const keys = new AuthKeys(test.config);
  const link = async (purpose: string, userId: string) => {
    const token = newToken();
    await database.admin.query("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [
      purpose,
      userId,
      keys.linkHash(token),
    ]);
    return token;
  };
  const { rows } = await database.admin.query<{ id: string }>(
    "INSERT INTO users (role, status, first_name, last_name, email, invited_by, invited_at) VALUES ('CLAIMS_OFFICER', 'INVITED', 'Nadia', 'Kaci', 'nk@legarec.fr', $1, now()) RETURNING id",
    [s.manager],
  );
  ids = {
    director: s.director,
    manager: s.manager,
    developer: s.developer,
    officer: s.officerA,
    creditor: s.partnerA,
    creditorId: s.creditorA,
    reset: await link('RESET', s.officerA),
    invitation: await link('INVITATION', rows[0]!.id),
  };
  const invited = await database.admin.query<{ id: string }>(
    `INSERT INTO users (role, status, first_name, last_name, email, creditor_id, invited_by, invited_at)
     VALUES ('CREDITOR', 'INVITED', 'Paul', 'Roche', 'p.roche@energiesrhone.example', $1, $2, now()) RETURNING id`,
    [s.creditorB, s.manager],
  );
  partnerIds = { reset: await link('RESET', s.partnerA), invitation: await link('INVITATION', invited.rows[0]!.id) };
});
// As the simulations, which start again with each request.
beforeEach(async () => {
  const { admin } = test.database;
  await admin.query("UPDATE users SET two_factor_required = (role = 'DEVELOPER')");
  await admin.query('DELETE FROM second_factors');
  await admin.query(
    "INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) SELECT id, 'TOTP', '\\x00', now() FROM users WHERE id = ANY ($1::uuid[])",
    [[test.s.officerA, test.s.developer]],
  );
});
afterAll(() => test.stop());

const named = (list: Parity[]) => list.map((item) => [`${item.as}: ${item.request} ${JSON.stringify(item.body ?? '')} → ${item.status}`, item] as const);
async function ask(portal: 'staff' | 'partner', item: Parity, with_: Record<string, string>) {
  const [method = '', path = ''] = (filled(item.request, with_) as string).split(' ');
  const answer = await test.call(method, `/${portal}${path}`, {
    as: AS[item.as],
    body: filled(item.body, with_),
    headers: { 'x-forwarded-for': `10.${randomBytes(3).join('.')}`, ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }) },
  });
  expect(answer.status).toBe(item.status);
  if (item.answer) expect(item.answer.parse(answer.body)).toEqual(answer.body);
}

describe('as the simulations', () => {
  it.each(named(ACCOUNT_PARITY))('team, %s', (_name, item) => ask('staff', item, ids));
  it.each(named(PARTNER_PARITY))('creditors, %s', (_name, item) => ask('partner', item, partnerIds));
});
