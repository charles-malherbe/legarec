import { notificationItem } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';
import { Browser, newAccount } from '../../../test/browser';
import { newToken } from '../../platform/crypto/keyring';
import { AuthKeys } from '../auth/keys';

/** What the Director learns in the application, whoever would rather they did not. */
let test: TestApp;
let real: TestApp;
let keys: AuthKeys;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, path, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const read = async (as = 'director') =>
  z
    .array(notificationItem)
    .parse((await call(as, 'GET', '/staff/notifications')).body)
    .map((item) => item.text);
const support = (as: string, id: string, action: string) => call(as, 'POST', `/staff/members/${id}/${action}`);
const delegation = () => rows("SELECT withdrawn_by FROM delegations WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
const reset = async (id: string, portal: 'staff' | 'partner' = 'staff') => {
  const token = newToken();
  await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [
    id,
    keys.linkHash(token),
  ]);
  return new Browser(real, portal).post(`/auth/reset/${token}`, { password: 'Un-nouveau-mot-de-passe-9' });
};

beforeAll(async () => {
  test = await startApp();
  real = await startApp([], {
    sessions: true,
    next: test,
    env: { VAULT_MASTER_KEY: test.config.VAULT_MASTER_KEY, SESSION_SIGNING_KEY: test.config.SESSION_SIGNING_KEY },
  });
  keys = new AuthKeys(test.config);
});
beforeEach(async () => {
  await rows('DELETE FROM notifications');
  await rows("UPDATE users SET first_name = 'Devon', last_name = 'Test' WHERE id = $1", [test.s.developer]);
  await rows(
    "INSERT INTO delegations (kind, granted_by) SELECT 'TECHNICAL', $1 WHERE NOT EXISTS (SELECT 1 FROM delegations WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL)",
    [test.s.director],
  );
});
afterAll(async () => {
  await real.stop();
  await test.stop();
});

describe('support', () => {
  it('names the role of whoever acts, whatever name they give themselves', async () => {
    const { id } = await newAccount(test);
    await call('developer', 'PUT', '/staff/account/profile', { firstName: 'Remi', lastName: 'Test' });
    await support('developer', id, 'require-2fa');
    expect(await read()).toEqual(['Remi Test (Développeur) a exigé la double authentification pour Nora Test']);
    expect(await rows("SELECT action FROM audit_log WHERE actor_id = $1 AND action = 'NAME_CHANGED'", [test.s.developer])).toHaveLength(1);
  });

  it.each(['unlock', 'reset-2fa'])('refuses what has no object, so that nothing is buried under it: %s', async (action) => {
    const { id } = await newAccount(test);
    for (const as of ['developer', 'director']) expect(await support(as, id, action)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await read()).toEqual([]);
    expect(await rows("SELECT 1 FROM audit_log WHERE entity_id = $1 AND action IN ('ACCOUNT_UNLOCKED', 'SECOND_FACTOR_RESET')", [id])).toEqual([]);
  });

  it('is said once: what is already required is not required again', async () => {
    const { id } = await newAccount(test);
    expect((await support('developer', id, 'require-2fa')).status).toBe(204);
    expect((await support('developer', id, 'require-2fa')).status).toBe(409);
    expect(await read()).toHaveLength(1);
  });

  it('does not unlock an account whose lock is over', async () => {
    const { id } = await newAccount(test);
    await rows("INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'SECOND_FACTOR', 5, now() - interval '1 second')", [
      keys.attempt('second-factor', id),
    ]);
    expect((await support('developer', id, 'unlock')).status).toBe(409);
  });

  it('sends three links an hour at most to one account, whatever is asked by strangers, who are counted apart', async () => {
    const { id, email } = await newAccount(test);
    for (const as of ['developer', 'manager', 'director']) expect((await support(as, id, 'reset-link')).status).toBe(204);
    expect(await support('director', id, 'reset-link')).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    expect((await new Browser(test).post('/auth/forgot-password', { email: email.toUpperCase() })).status).toBe(204);
    for (let i = 0; i < 2; i += 1) expect((await new Browser(test).post('/auth/forgot-password', { email })).status).toBe(204);
    expect((await new Browser(test).post('/auth/forgot-password', { email })).status).toBe(429);
    expect(await read()).toHaveLength(2);
  });
});

describe('what else is done to an account', () => {
  it('shows and lifts the lock of Mon compte too, and a reset lifts it', async () => {
    const lock = (id: string) =>
      rows("INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ($1, 'PASSWORD', 5, now() + interval '15 minutes')", [
        keys.attempt('password', id),
      ]);
    const locked = () => rows('SELECT 1 FROM lockouts WHERE locked_until > now()');
    await rows('DELETE FROM lockouts');
    const { id } = await newAccount(test);
    await lock(id);
    const { body } = await call('director', 'GET', '/staff/members');
    expect((body as { members: { id: string; locked: boolean }[] }).members.filter((member) => member.locked).map((member) => member.id)).toEqual([id]);
    expect((await support('developer', id, 'unlock')).status).toBe(204);
    expect(await locked()).toEqual([]);
    await lock(id);
    expect((await reset(id)).status).toBe(204);
    expect(await locked()).toEqual([]);
  });

  it('invites the contacts of the creditors that are proposed, and of no other', async () => {
    await rows("UPDATE creditors SET status = 'ENDED' WHERE id = $1", [test.s.creditorB]);
    const body = { firstName: 'I', lastName: 'T', role: 'CREDITOR', email: 'i@client.test', creditorId: test.s.creditorB };
    expect(await call('director', 'POST', '/staff/members', body)).toMatchObject({ status: 422, body: { fields: ['creditorId'] } });
    await rows("UPDATE creditors SET status = 'ACTIVE' WHERE id = $1", [test.s.creditorB]);
  });

  it('gives a delegation once, however many clicks', async () => {
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
    const answers = await Promise.all([1, 2, 3, 4].map(() => call('director', 'PUT', '/staff/delegations/technical', { active: true })));
    expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204, 204]);
    expect(await delegation()).toHaveLength(1);
  });

  it.each(['a_b', 'a+b', "o'neil", '-a', 'a-', 'x'.repeat(33)])('refuses to a collaborator an address that no mailbox can have: %s@', async (local) => {
    const body = { firstName: 'I', lastName: 'T', role: 'CLAIMS_OFFICER', email: `${local}@legarec.fr` };
    expect(await call('director', 'POST', '/staff/members', body)).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['email'] } });
  });

  it('numbers more than 9,999 questions a year', async () => {
    const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date());
    await rows("INSERT INTO number_sequences (kind, year, last_value) VALUES ('TICKET', $1, 9999) ON CONFLICT (kind, year) DO UPDATE SET last_value = 9999", [
      Number(year),
    ]);
    const ask = () => call('officerA', 'POST', '/staff/support-tickets', { subject: '', message: 'Une question assez longue.' });
    expect((await ask()).body).toEqual({ number: `${year}-10000` });
    expect((await ask()).body).toEqual({ number: `${year}-10001` });
    for (let i = 0; i < 8; i += 1) expect((await ask()).status).toBe(200);
    // Each one is an e-mail.
    expect(await ask()).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    expect((await call('officerB', 'POST', '/staff/support-tickets', { subject: '', message: 'Une question assez longue.' })).status).toBe(200);
  });
});

describe('password reset by a link', () => {
  it('of a collaborator is told to the Director, theirs included', async () => {
    const { id } = await newAccount(test);
    expect((await reset(id)).status).toBe(204);
    expect((await reset(test.s.director)).status).toBe(204);
    expect(await read()).toEqual([
      'Le mot de passe de votre compte a été réinitialisé par le lien envoyé à votre adresse',
      'Le mot de passe de Nora Test (Gestionnaire de créances) a été réinitialisé par le lien envoyé à son adresse',
    ]);
    expect(await read('manager')).toEqual([]);
  });

  it('of a creditor is not', async () => {
    const { id } = await newAccount(test, { role: 'CREDITOR', creditorId: test.s.creditorA });
    expect((await reset(id, 'partner')).status).toBe(204);
    expect(await read()).toEqual([]);
  });
});

describe('what nobody can bury', () => {
  it('an unread notification, whatever was read since', async () => {
    const { id } = await newAccount(test);
    await support('developer', id, 'require-2fa');
    await rows(
      `INSERT INTO notifications (user_id, kind, action, actor_id, target_id, created_at, read_at)
       SELECT $1, 'SUPPORT_ACTION', 'ACCOUNT_UNLOCKED', $2, $3, now() + interval '1 second', now() FROM generate_series(1, 501)`,
      [test.s.director, test.s.developer, id],
    );
    const shown = await read();
    expect(shown).toHaveLength(500);
    // The oldest one, and still there.
    expect(shown.at(-1)).toBe('Devon Test (Développeur) a exigé la double authentification pour Nora Test');
  });

  it('the support, limited by whoever gives it, the Director apart', async () => {
    const { id } = await newAccount(test);
    const locked = async (as: string) => {
      const answers = [];
      for (let i = 0; i < 31; i += 1) answers.push((await support(as, id, 'unlock')).status);
      return answers;
    };
    // Nothing to unlock: each of them is refused, and counted.
    const answers = await locked('developer');
    expect([answers[0], answers.at(-1)]).toEqual([409, 429]);
    expect(new Set(await locked('director'))).toEqual(new Set([409]));
  });

  it('a link sent by the support, whoever has asked for one before', async () => {
    const { id, email } = await newAccount(test);
    for (let i = 0; i < 3; i += 1) expect((await new Browser(real).post('/auth/forgot-password', { email })).status).toBe(204);
    expect((await support('director', id, 'reset-link')).status).toBe(204);
  });
});

describe('the technical delegation', () => {
  const ENDED = 'Remi Test (Responsable du recouvrement) a changé le titulaire du rôle Développeur : la délégation technique a pris fin';
  const without = async (work: () => Promise<unknown>) => {
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.developer]);
    try {
      await work();
    } finally {
      await rows("DELETE FROM mailbox_requests; DELETE FROM users WHERE role = 'DEVELOPER' AND status = 'INVITED'");
      await rows("UPDATE users SET role = 'CLAIMS_OFFICER' WHERE role = 'DEVELOPER' AND id <> $1", [test.s.developer]);
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.developer]);
    }
  };

  it.each(['role', 'invitation', 'return'])('ends when a delegate puts someone in the place of its holder: %s', async (way) => {
    await without(async () => {
      const { id } = await newAccount(test);
      if (way === 'role') expect((await call('manager', 'PUT', `/staff/members/${id}/role`, { role: 'DEVELOPER' })).status).toBe(204);
      else if (way === 'invitation')
        expect(
          (await call('manager', 'POST', '/staff/members', { firstName: 'I', lastName: 'T', role: 'DEVELOPER', email: `d${Date.now() % 1e9}@legarec.fr` }))
            .status,
        ).toBe(204);
      else expect((await call('manager', 'POST', `/staff/members/${test.s.developer}/enable`)).status).toBe(204);
      expect(await delegation()).toEqual([]);
      expect(await read()).toEqual([ENDED]);
      // Withdrawn by the delegate, and given again by the Director alone.
      expect((await call('manager', 'PUT', '/staff/delegations/technical', { active: true })).status).toBe(403);
      expect((await call('director', 'PUT', '/staff/delegations/technical', { active: true })).status).toBe(204);
      expect(await delegation()).toHaveLength(1);
    });
  });

  it('is not said to end when it had been withdrawn already, but the new Developer is', async () => {
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
    await without(async () => {
      const { id } = await newAccount(test);
      expect((await call('manager', 'PUT', `/staff/members/${id}/role`, { role: 'DEVELOPER' })).status).toBe(204);
      expect(await delegation()).toEqual([]);
      expect(await read()).toEqual(['Remi Test (Responsable du recouvrement) a changé le titulaire du rôle Développeur']);
    });
  });

  it('stays when the Director chooses its holder, or when a delegate changes another role', async () => {
    await without(async () => {
      const { id } = await newAccount(test);
      expect((await call('director', 'PUT', `/staff/members/${id}/role`, { role: 'DEVELOPER' })).status).toBe(204);
      expect(await delegation()).toHaveLength(1);
    });
    expect(
      (await call('manager', 'POST', '/staff/members', { firstName: 'I', lastName: 'T', role: 'CLAIMS_OFFICER', email: `c${Date.now() % 1e9}@legarec.fr` }))
        .status,
    ).toBe(204);
    expect(await delegation()).toHaveLength(1);
    expect(await read()).toEqual([]);
  });
});
