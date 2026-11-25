import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routesOf, type RouteInfo } from '../src/platform/access/routes';
import { isOpen } from '../src/platform/access/access';
import { startApp, type TestApp } from './app';
import { Browser, emailOf, givePassword, newAccount, setUpTotp } from './browser';
import { MATRIX } from './matrix';

/** Every route that asks to be signed in, with a real cookie that opens nothing. */
let test: TestApp;
let routes: RouteInfo[];
const cookies: Record<string, { staff?: string; partner?: string }> = {};
const rows = (sql: string, values: unknown[] = []) => test.database.admin.query(sql, values);

beforeAll(async () => {
  test = await startApp([], { sessions: true });
  routes = routesOf(test.app);
  const { s } = test;
  const open = async (email: string, portal: 'staff' | 'partner' = 'staff') => {
    const browser = new Browser(test, portal);
    await browser.login(email);
    return browser;
  };
  const both = async (of: (portal: 'staff' | 'partner') => Promise<string | undefined>) => ({ staff: await of('staff'), partner: await of('partner') });
  const account = (portal: 'staff' | 'partner') => newAccount(test, portal === 'staff' ? {} : { role: 'CREDITOR', creditorId: s.creditorA });

  cookies['a disabled account'] = await both(async (portal) => {
    const { id, email } = await account(portal);
    const { token } = await open(email, portal);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    return token;
  });
  cookies['an account invited again'] = await both(async (portal) => {
    const { id, email } = await account(portal);
    const { token } = await open(email, portal);
    await rows("UPDATE users SET status = 'INVITED' WHERE id = $1", [id]);
    return token;
  });
  cookies['a session without its second factor'] = await both(async (portal) => {
    const { id, email } = await account(portal);
    if (portal === 'staff') await setUpTotp(await open(email));
    else await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
    return (await open(email, portal)).token;
  });
  cookies['a session whose second factor is to be set up'] = await both(async (portal) => {
    const { id, email } = await account(portal);
    await rows('UPDATE users SET two_factor_required = true WHERE id = $1', [id]);
    return (await open(email, portal)).token;
  });
  cookies['a session closed'] = await both(async (portal) => {
    const { email } = await account(portal);
    const browser = await open(email, portal);
    const { token } = browser;
    await browser.post('/auth/logout');
    return token;
  });
  cookies['a session of the other portal'] = {
    staff: (await open((await account('partner')).email, 'partner')).token,
    partner: (await open((await account('staff')).email)).token,
  };
  // An account whose role was changed behind its session.
  cookies['a creditor who became a collaborator, and the other way round'] = await both(async (portal) => {
    const { id, email } = await account(portal);
    const { token } = await open(email, portal);
    if (portal === 'staff') await rows("UPDATE users SET role = 'CREDITOR', creditor_id = $2 WHERE id = $1", [id, s.creditorA]);
    else await rows("UPDATE users SET role = 'CLAIMS_OFFICER', creditor_id = NULL WHERE id = $1", [id]);
    return token;
  });
  await givePassword(test, s.partnerB);
  const partner = await open(await emailOf(test, s.partnerB), 'partner');
  await rows('UPDATE creditors SET portal_enabled = false WHERE id = $1', [s.creditorB]);
  cookies['a closed portal'] = { partner: partner.token };
});
afterAll(() => test.stop());

const names = [
  'a disabled account',
  'an account invited again',
  'a session without its second factor',
  'a session whose second factor is to be set up',
  'a session closed',
  'a session of the other portal',
  'a creditor who became a collaborator, and the other way round',
  'a closed portal',
];
describe('a cookie that opens nothing', () => {
  it.each(names)('%s: every route answers that nobody is signed in', async (name) => {
    let tried = 0;
    for (const { id, access } of routes) {
      const portal = access?.portal;
      if (!access || isOpen(access) || (portal !== 'staff' && portal !== 'partner')) continue;
      const token = cookies[name]![portal];
      if (!token) continue;
      const [method = '', path = ''] = id.split(' ');
      const entry = MATRIX[id]!;
      const target = ((await entry.path?.(test)) ?? path).slice(portal.length + 1);
      const answer = await new Browser(test, portal).put(portal, token).call(method, target, entry.body?.());
      expect({ status: answer.status, body: answer.body }, id).toEqual({ status: 401, body: { code: 'UNAUTHORIZED' } });
      tried += 1;
    }
    expect(tried).toBeGreaterThan(0);
  });
});
