import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import type { Actor } from './actor';
import { databaseCode } from './codes';
import { Database, type Transaction } from './database';

/** The tables of the accounts, in SQL: whatever the API does, or forgets. */
let test: TestDatabase;
let api: Database;
let jobs: Database;
let s: Seed;
const TABLES = ['user_devices', 'user_sessions', 'second_factors', 'backup_codes', 'auth_tokens'] as const;
const ALL = [...TABLES, 'lockouts', 'notification_preferences', 'notifications', 'support_tickets', 'mailbox_requests'] as const;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  api = new Database(test.url('app'));
  jobs = new Database(test.url('jobs'));
  for (const id of [s.officerA, s.officerB, s.director, s.partnerA]) {
    const [device, session, link] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await rows("UPDATE users SET password_hash = 'hash' WHERE id = $1", [id]);
    await rows("INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'Chrome', now() + interval '1 day')", [id, device]);
    await rows(
      "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'Chrome', false, now() + interval '1 hour')",
      [id, session],
    );
    await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
    await rows("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, 'hash')", [id]);
    await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [id, link]);
    await rows("INSERT INTO notification_preferences (user_id, kind, in_app, email) VALUES ($1, 'payment', true, true)", [id]);
    await rows("INSERT INTO notifications (user_id, kind, action, actor_id, target_id) VALUES ($1, 'SUPPORT_ACTION', 'RESET_LINK', $2, $1)", [id, s.developer]);
  }
  await rows("INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('2026-0001', $1, 'Sujet', 'Une question.')", [s.officerA]);
  await rows("INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ($1, 'alba', $2)", [s.officerA, s.director]);
  await rows("INSERT INTO lockouts (key_hash, scope, failures) VALUES ('\\x01', 'SIGN_IN', 2)");
});
afterAll(async () => {
  await Promise.all([api.close(), jobs.close()]);
  await test.drop();
});

type Staff = Extract<Actor, { kind: 'staff' }>;
const staff = (userId: string, role: Staff['role'], more: Partial<Staff> = {}): Actor => ({ kind: 'staff', userId, role, delegations: [], ...more });
const about = (subject?: string, proved = false): Actor => ({ kind: 'anonymous', ...(subject ? { subject } : {}), proved });
const run = <T>(actor: Actor, work: (tx: Transaction) => Promise<T>) => (actor.kind === 'worker' || actor.kind === 'retention' ? jobs : api).run(actor, work);
const count = (actor: Actor, table: string, where = '') =>
  run(actor, async (tx) => (await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} ${where}`))[0]!.n);
const OTHERS: [string, () => Actor][] = [
  ['the Director', () => staff(s.director, 'DIRECTOR')],
  ['the manager on behalf of the Director', () => staff(s.manager, 'COLLECTION_MANAGER', { actingFor: 'ADMINISTRATIVE' })],
  ['the Developer', () => staff(s.developer, 'DEVELOPER')],
  ['a claims officer', () => staff(s.officerA, 'CLAIMS_OFFICER')],
  ['someone who says they are the Director', () => staff(s.officerA, 'DIRECTOR')],
  ['a creditor', () => ({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA })],
  ['a debtor', () => ({ kind: 'debtor', debtorId: s.debtorA })],
  ['a provider', () => ({ kind: 'hook' })],
  ['a page without any account', () => ({ kind: 'public' })],
  ['a service account', () => ({ kind: 'service', accountId: randomUUID(), scopes: [] })],
];

describe('credentials', () => {
  it.each(TABLES)('%s: the sign-in sees one account at a time, the one it has found', async (table) => {
    expect(await count(about(), table)).toBe(0);
    expect(await count(about(randomUUID()), table)).toBe(0);
    expect(await count(about(s.officerA), table)).toBe(1);
    expect(await count(about(s.officerA, true), table)).toBe(1);
    expect(await count(about(s.officerA, true), table, `WHERE user_id = '${s.officerB}'`)).toBe(0);
  });

  it('are neither changed, added nor erased for another account than the one found', async () => {
    const before = async () => JSON.stringify(await Promise.all(TABLES.map((table) => rows(`SELECT * FROM ${table} ORDER BY id`))));
    const start = await before();
    const other = s.officerB;
    for (const statement of [
      `UPDATE user_sessions SET revoked_at = now() WHERE user_id = '${other}'`,
      `UPDATE user_devices SET label = 'x' WHERE user_id = '${other}'`,
      `UPDATE second_factors SET confirmed_at = now() WHERE user_id = '${other}'`,
      `DELETE FROM second_factors WHERE user_id = '${other}'`,
      `DELETE FROM backup_codes WHERE user_id = '${other}'`,
      `UPDATE backup_codes SET used_at = now() WHERE user_id = '${other}'`,
      `UPDATE auth_tokens SET used_at = now() WHERE user_id = '${other}'`,
      `UPDATE users SET password_hash = 'x' WHERE id = '${other}'`,
    ])
      expect(await run(about(s.officerA, true), (tx) => tx.$executeRawUnsafe(statement)), statement).toBe(0);
    for (const statement of [
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ('${other}', 'STAFF', '\\x99', 'x', false, now() + interval '1 hour')`,
      `INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ('${other}', 'TOTP', '\\x00', now())`,
      `INSERT INTO backup_codes (user_id, code_hash) VALUES ('${other}', 'x')`,
      `INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', '${other}', '\\x98', now() + interval '1 hour')`,
      `INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ('${other}', '\\x97', 'x', now())`,
    ])
      await expect(
        run(about(s.officerA, true), (tx) => tx.$executeRawUnsafe(statement)),
        statement,
      ).rejects.toThrow(/row-level security/u);
    expect(await before()).toBe(start);
  });

  it('do not change owner', async () => {
    for (const statement of [
      `UPDATE user_sessions SET user_id = '${s.officerB}'`,
      `UPDATE second_factors SET user_id = '${s.officerB}'`,
      `UPDATE auth_tokens SET user_id = '${s.officerB}'`,
      `UPDATE user_sessions SET portal = 'PARTNER'`,
      `UPDATE user_sessions SET second_factor_needed = false`,
      `UPDATE auth_tokens SET purpose = 'INVITATION'`,
      `UPDATE users SET role = 'DIRECTOR'`,
      `UPDATE users SET email = 'x@exemple.test'`,
      `UPDATE users SET two_factor_required = false`,
      `UPDATE users SET creditor_id = NULL`,
      `DELETE FROM user_sessions`,
      `DELETE FROM auth_tokens`,
      `DELETE FROM users`,
      `SELECT disabled_reason FROM users`,
    ])
      await expect(
        run(about(s.officerA, true), (tx) => tx.$executeRawUnsafe(statement)),
        statement,
      ).rejects.toThrow(/permission denied/u);
  });

  it.each(OTHERS)('are out of reach of %s', async (_name, actor) => {
    for (const table of [...TABLES, 'lockouts'] as const) {
      await expect(count(actor(), table), table).rejects.toThrow(/permission denied/u);
      await expect(
        run(actor(), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table}`)),
        table,
      ).rejects.toThrow(/permission denied/u);
    }
    await expect(run(actor(), (tx) => tx.$queryRaw`SELECT password_hash FROM users`)).rejects.toThrow(/permission denied/u);
    for (const call of [
      "SELECT app.account_of('alba@exemple.test'::citext)",
      "SELECT app.account_of_link('RESET', '{}')",
      "SELECT * FROM app.resume_session('STAFF', '{}', false)",
      "SELECT * FROM app.take_attempt('\\x01', 'SIGN_IN')",
      "SELECT app.clear_attempts('{}')",
      `SELECT app.close_account('${s.officerB}')`,
      `SELECT app.release_cases('${s.officerB}')`,
    ])
      await expect(
        run(actor(), (tx) => tx.$queryRawUnsafe(call)),
        call,
      ).rejects.toThrow(/permission denied/u);
  });

  it('are out of reach of the worker, but the links that it sends', async () => {
    const worker: Actor = { kind: 'worker', job: 'test' };
    for (const statement of [
      'SELECT password_hash FROM users',
      'SELECT secret_cipher FROM second_factors',
      'SELECT code_hash FROM backup_codes',
      'SELECT token_hash FROM auth_tokens',
      'SELECT token_hash FROM user_sessions',
      'SELECT * FROM user_devices',
      'SELECT * FROM lockouts',
      'UPDATE user_sessions SET revoked_at = NULL',
      'UPDATE auth_tokens SET used_at = NULL, token_hash = NULL',
      "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES (gen_random_uuid(), 'STAFF', '\\x96', 'x', false, now())",
    ])
      await expect(
        run(worker, (tx) => tx.$queryRawUnsafe(statement)),
        statement,
      ).rejects.toThrow(/permission denied/u);
    await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('WEBAUTHN', $1, '\\x95', now() + interval '1 hour')", [s.officerA]);
    expect(await count(worker, 'auth_tokens', "WHERE purpose = 'WEBAUTHN'")).toBe(0);
    await expect(
      run(worker, (tx) =>
        tx.$executeRawUnsafe(`INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('WEBAUTHN', '${s.officerA}', '\\x94', now())`),
      ),
    ).rejects.toThrow(/row-level security/u);
    await rows("DELETE FROM auth_tokens WHERE purpose = 'WEBAUTHN'");
  });

  it('belong to one account at a time: a disabled one is nobody, and none is opened but as active', async () => {
    const id = s.officerB;
    const label = (actor: Actor) =>
      run(actor, async (tx) => (await tx.$queryRaw<{ kind: string; id: string | null }[]>`SELECT app.actor_kind()::text AS kind, app.actor_id() AS id`)[0]);
    expect(await label(about(id))).toEqual({ kind: 'ANONYMOUS', id: null });
    expect(await label(about(id, true))).toEqual({ kind: 'STAFF', id });
    expect(await label(about(s.partnerA, true))).toEqual({ kind: 'CREDITOR', id: s.partnerA });
    expect(await label(about(randomUUID(), true))).toEqual({ kind: 'ANONYMOUS', id: null });
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
    expect(await label(about(id, true))).toEqual({ kind: 'ANONYMOUS', id: null });
    expect(await run(about(id, true), (tx) => tx.$executeRawUnsafe("UPDATE users SET status = 'ACTIVE'"))).toBe(0);
    await rows("UPDATE users SET status = 'INVITED', disabled_at = NULL WHERE id = $1", [id]);
    expect(await run(about(id), (tx) => tx.$executeRawUnsafe("UPDATE users SET status = 'ACTIVE'"))).toBe(0);
    await expect(run(about(id, true), (tx) => tx.$executeRawUnsafe("UPDATE users SET status = 'DISABLED'"))).rejects.toThrow(/row-level security/u);
    await rows("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [id]);
  });

  it('are those of the account found: the sign-in reads no other line of the accounts', async () => {
    expect(await count(about(), 'users')).toBe(0);
    expect(await count(about(randomUUID()), 'users')).toBe(0);
    for (const actor of [about(s.officerA), about(s.officerA, true)]) {
      expect(await count(actor, 'users')).toBe(1);
      expect(await count(actor, 'users', `WHERE id <> '${s.officerA}'`)).toBe(0);
    }
  });

  it('sign under the name of a collaborator, never under that of a creditor', async () => {
    const label = (actor: Actor) => run(actor, async (tx) => (await tx.$queryRaw<{ label: string }[]>`SELECT app.actor_label() AS label`)[0]!.label);
    expect(await label(about(s.officerB, true))).toBe('Beno Test');
    expect(await label(about(s.partnerA, true))).toBe('Créancier');
    // Nothing proved: a stranger, whatever the account.
    for (const actor of [about(), about(s.officerB), about(s.partnerA)]) expect(await label(actor)).toBe('Inconnu');
  });

  it('are asked for by the sign-in only once the account may sign in', async () => {
    const find = (email: string) =>
      run(about(), async (tx) => (await tx.$queryRaw<{ id: string | null }[]>`SELECT app.account_of(${email}::citext) AS id`)[0]!.id);
    expect(await find('ALBA@exemple.test')).toBe(s.officerA);
    expect(await find('devon@exemple.test')).toBeNull();
    expect(await find('paula@exemple.test')).toBe(s.partnerA);
    await rows('UPDATE creditors SET portal_enabled = false WHERE id = $1', [s.creditorA]);
    expect(await find('paula@exemple.test')).toBeNull();
    await rows('UPDATE creditors SET portal_enabled = true WHERE id = $1', [s.creditorA]);
  });
});

describe('session of a cookie', () => {
  const open = async (userId: string, { needed = false, seen = '2 minutes' } = {}) => {
    const hash = randomBytes(32);
    await rows(
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at, last_seen_at)
       VALUES ($1, 'STAFF', $2, 'Chrome', $3, now() + interval '1 hour', now() - $4::interval)`,
      [userId, hash, needed, seen],
    );
    return hash;
  };
  const resume = async (hash: Buffer, background = false) =>
    (
      await run(
        about(),
        (tx) =>
          tx.$queryRaw<
            { user_id: string; complete: boolean; delegations: string[] }[]
          >`SELECT user_id, complete, delegations FROM app.resume_session('STAFF', ${[hash.toString('hex')]}::text[], ${background})`,
      )
    )[0];
  /** Seconds since the session, then its account, were last seen. */
  const lastSeen = async (hash: Buffer) =>
    (
      await rows<{ session: number; account: number | null }>(
        `SELECT round(extract(epoch FROM now() - s.last_seen_at))::int AS session, round(extract(epoch FROM now() - u.last_seen_at))::int AS account
         FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
        [hash],
      )
    )[0]!;
  const forget = () => rows("UPDATE users SET last_seen_at = now() - interval '1 hour' WHERE id = $1", [s.officerA]);

  it('is prolonged, with its account, by what its holder asks, and once a minute at most', async () => {
    await forget();
    const active = await open(s.officerA);
    expect(await resume(active)).toMatchObject({ user_id: s.officerA, complete: true });
    const { session, account } = await lastSeen(active);
    expect([session, account]).toEqual([expect.toBeOneOf([0, 1]), expect.toBeOneOf([0, 1])]);
    await forget();
    const recent = await open(s.officerA, { seen: '50 seconds' });
    await resume(recent);
    expect((await lastSeen(recent)).session).toBeGreaterThanOrEqual(50);
    expect((await lastSeen(recent)).account).toBeGreaterThanOrEqual(3_600);
  });

  it('is not prolonged by what the screen asks by itself, nor before its second factor', async () => {
    await forget();
    for (const [hash, background] of [
      [await open(s.officerA), true],
      [await open(s.officerA, { needed: true }), false],
    ] as const) {
      expect(await resume(hash, background)).toMatchObject({ user_id: s.officerA, complete: background });
      const { session, account } = await lastSeen(hash);
      expect(session).toBeGreaterThanOrEqual(120);
      expect(account).toBeGreaterThanOrEqual(3_600);
    }
  });

  it('gives the delegation of its role, while it holds and while the Director who gave it is there', async () => {
    const held = async (userId: string) => (await resume(await open(userId)))?.delegations;
    expect(await held(s.developer)).toEqual(['TECHNICAL']);
    expect(await held(s.manager)).toEqual(['ADMINISTRATIVE']);
    for (const id of [s.director, s.officerA]) expect(await held(id)).toEqual([]);
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
    expect(await held(s.developer)).toEqual([]);
    expect(await held(s.manager)).toEqual(['ADMINISTRATIVE']);
    await rows("INSERT INTO delegations (kind, granted_by) VALUES ('TECHNICAL', $1)", [s.director]);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.director]);
    try {
      for (const id of [s.developer, s.manager]) expect(await held(id)).toEqual([]);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.director]);
    }
    expect(await held(s.developer)).toEqual(['TECHNICAL']);
  });
});

describe('what the tables refuse, whatever the API writes', () => {
  it.each<[string, (id: string) => string, RegExp]>([
    [
      'an absence that ends before it starts',
      (id) => `UPDATE users SET absent_from = '2026-12-31', absent_until = '2026-12-21' WHERE id = '${id}'`,
      /users_absence/u,
    ],
    ['someone replaced by themselves', (id) => `UPDATE users SET substitute_id = id WHERE id = '${id}'`, /users_substitute/u],
    [
      'a second application in use',
      (id) => `INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ('${id}', 'TOTP', '\\x01', now())`,
      /second_factors_totp/u,
    ],
    ['an application without its secret', (id) => `INSERT INTO second_factors (user_id, kind) VALUES ('${id}', 'TOTP')`, /second_factors_kind/u],
    [
      'an application that holds the key of a security key',
      (id) => `INSERT INTO second_factors (user_id, kind, secret_cipher, public_key) VALUES ('${id}', 'TOTP', '\\x01', '\\x02')`,
      /second_factors_kind/u,
    ],
    [
      'a security key without its public key',
      (id) => `INSERT INTO second_factors (user_id, kind, credential_id, sign_count, confirmed_at) VALUES ('${id}', 'WEBAUTHN', 'k', 0, now())`,
      /second_factors_kind/u,
    ],
    [
      'a security key that was never proved',
      (id) => `INSERT INTO second_factors (user_id, kind, credential_id, public_key, sign_count) VALUES ('${id}', 'WEBAUTHN', 'k', '\\x02', 0)`,
      /second_factors_kind/u,
    ],
    [
      'two sessions with the same token',
      (id) =>
        `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) SELECT '${id}', portal, token_hash, 'x', false, now() FROM user_sessions LIMIT 1`,
      /user_sessions_token_hash/u,
    ],
    [
      'two links with the same token',
      (id) => `INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) SELECT 'RESET', '${id}', token_hash, now() FROM auth_tokens LIMIT 1`,
      /auth_tokens_token_hash/u,
    ],
    [
      'two mailboxes asked for at once',
      (id) => `INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ('${id}', 'alba2', '${id}')`,
      /mailbox_requests_open/u,
    ],
    [
      'a mailbox whose name is not one',
      (id) => `INSERT INTO mailbox_requests (user_id, local, requested_by, status) VALUES ('${id}', 'a@b', '${id}', 'DONE')`,
      /mailbox_requests_local/u,
    ],
    [
      'a notice that does not say about whom',
      (id) => `INSERT INTO notifications (user_id, kind, action, actor_id) VALUES ('${id}', 'SUPPORT_ACTION', 'RESET_LINK', '${id}')`,
      /notifications_facts/u,
    ],
    [
      'a notice that does not say by whom',
      (id) => `INSERT INTO notifications (user_id, kind, action, target_id) VALUES ('${id}', 'SUPPORT_ACTION', 'RESET_LINK', '${id}')`,
      /notifications_facts/u,
    ],
    [
      'a notice of a question without the question',
      (id) => `INSERT INTO notifications (user_id, kind, actor_id) VALUES ('${id}', 'SUPPORT_TICKET', '${id}')`,
      /notifications_facts/u,
    ],
    [
      'a question without a word',
      (id) => `INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('2026-9001', '${id}', '', '')`,
      /support_tickets_message/u,
    ],
    [
      'a question too long',
      (id) => `INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('2026-9001', '${id}', '', repeat('x', 5001))`,
      /support_tickets_message/u,
    ],
    [
      'a subject too long',
      (id) => `INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('2026-9001', '${id}', repeat('x', 201), 'x')`,
      /support_tickets_subject/u,
    ],
    [
      'a number of question that is not one',
      (id) => `INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('1184', '${id}', '', 'x')`,
      /support_tickets_number/u,
    ],
    [
      'a kind of notification that is not one',
      (id) => `INSERT INTO notification_preferences (user_id, kind, in_app, email) VALUES ('${id}', 'Payment!', true, true)`,
      /notification_preferences_kind/u,
    ],
  ])('%s', async (_what, statement, refusal) => {
    await expect(test.admin.query(statement(s.officerA))).rejects.toThrow(refusal);
  });

  it('and nobody but an invited account is ever erased, even by the functions', async () => {
    const [invited] = await rows<{ id: string }>(
      "INSERT INTO users (role, first_name, last_name, email) VALUES ('CLAIMS_OFFICER', 'A', 'B', 'invited@exemple.test') RETURNING id",
    );
    await test.admin.query('BEGIN');
    try {
      await test.admin.query('SET LOCAL ROLE legarec_definer');
      const erase = async (id: string) => (await test.admin.query('DELETE FROM users WHERE id = $1', [id])).rowCount;
      expect(await erase(s.officerB)).toBe(0);
      expect(await erase(invited!.id)).toBe(1);
    } finally {
      await test.admin.query('ROLLBACK');
    }
    await rows('DELETE FROM users WHERE id = $1', [invited!.id]);
  });
});

describe('one’s own account', () => {
  it.each(['notification_preferences', 'notifications'])('%s: each reads their own', async (table) => {
    expect(await count(staff(s.officerA, 'CLAIMS_OFFICER'), table)).toBe(1);
    expect(await count(staff(s.officerA, 'DIRECTOR'), table, `WHERE user_id <> '${s.officerA}'`)).toBe(0);
    expect(await count(staff(s.director, 'DIRECTOR'), table, `WHERE user_id <> '${s.director}'`)).toBe(0);
    await expect(count({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA }, table)).rejects.toThrow(/permission denied/u);
    // A creditor account that would be taken for a collaborator.
    expect(await count(staff(s.partnerA, 'CLAIMS_OFFICER'), table)).toBe(0);
  });

  it('is changed by its holder, and nobody else’s is', async () => {
    const actor = staff(s.officerA, 'CLAIMS_OFFICER');
    expect(await run(actor, (tx) => tx.$executeRawUnsafe("UPDATE users SET first_name = 'Alba' "))).toBe(1);
    for (const statement of [
      `UPDATE users SET first_name = 'x' WHERE id = '${s.officerB}'`,
      `UPDATE notification_preferences SET email = false WHERE user_id = '${s.officerB}'`,
      `UPDATE notifications SET read_at = now() WHERE user_id = '${s.officerB}'`,
    ])
      expect(await run(actor, (tx) => tx.$executeRawUnsafe(statement)), statement).toBe(0);
    await expect(
      run(actor, (tx) =>
        tx.$executeRawUnsafe(`INSERT INTO notification_preferences (user_id, kind, in_app, email) VALUES ('${s.officerB}', 'message', true, true)`),
      ),
    ).rejects.toThrow(/row-level security/u);
    for (const statement of [
      "UPDATE users SET role = 'DIRECTOR'",
      "UPDATE users SET status = 'DISABLED'",
      "UPDATE users SET email = 'x@exemple.test'",
      "UPDATE users SET extension = '1'",
      'UPDATE users SET two_factor_required = false',
      `UPDATE users SET creditor_id = '${s.creditorA}'`,
      "UPDATE users SET password_hash = 'x'",
      `UPDATE notifications SET user_id = '${s.officerB}'`,
      `INSERT INTO notifications (user_id, kind, action, actor_id, target_id) VALUES ('${s.director}', 'SUPPORT_ACTION', 'RESET_LINK', '${s.officerA}', '${s.officerA}')`,
      `INSERT INTO support_tickets (number, user_id, subject, message) VALUES ('2026-0002', '${s.officerB}', 'x', 'x')`,
      "UPDATE support_tickets SET message = 'x'",
      'DELETE FROM notifications',
      "INSERT INTO users (role, first_name, last_name, email) VALUES ('CLAIMS_OFFICER', 'x', 'x', 'x@exemple.test')",
      'DELETE FROM users',
      `UPDATE delegations SET withdrawn_at = now()`,
      `INSERT INTO delegations (kind, granted_by) VALUES ('TECHNICAL', '${s.officerA}')`,
    ])
      await expect(
        run(actor, (tx) => tx.$executeRawUnsafe(statement)),
        statement,
      ).rejects.toThrow(/permission denied/u);
  });

  it('is changed without naming anyone, and by nobody who is not a collaborator any more', async () => {
    const all = ['UPDATE notifications SET read_at = now()', 'UPDATE notification_preferences SET email = true', "UPDATE users SET density = 'comfortable'"];
    for (const statement of all) expect(await run(staff(s.officerA, 'CLAIMS_OFFICER'), (tx) => tx.$executeRawUnsafe(statement)), statement).toBe(1);
    // A creditor taken for a collaborator, then an account closed since.
    for (const statement of all) expect(await run(staff(s.partnerA, 'CLAIMS_OFFICER'), (tx) => tx.$executeRawUnsafe(statement)), statement).toBe(0);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.officerB]);
    try {
      for (const statement of all) expect(await run(staff(s.officerB, 'CLAIMS_OFFICER'), (tx) => tx.$executeRawUnsafe(statement)), statement).toBe(0);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.officerB]);
    }
  });

  it('keeps the mailboxes to create for those who create them', async () => {
    expect(await count(staff(s.developer, 'DEVELOPER'), 'mailbox_requests')).toBe(1);
    expect(await count(staff(s.director, 'DIRECTOR'), 'mailbox_requests')).toBe(1);
    expect(await count(staff(s.manager, 'COLLECTION_MANAGER'), 'mailbox_requests')).toBe(0);
    expect(await count(staff(s.officerA, 'CLAIMS_OFFICER'), 'mailbox_requests')).toBe(0);
  });

  it('is in no table without its policies', async () => {
    const found = await rows<{ relname: string }>('SELECT relname FROM pg_class WHERE relname = ANY ($1) AND relrowsecurity AND relforcerowsecurity', [ALL]);
    expect(found.map((row) => row.relname).sort()).toEqual([...ALL].sort());
  });
});

describe('the Developer', () => {
  it('always needs a second factor, whatever is written', async () => {
    const [row] = await rows<{ id: string }>(
      "INSERT INTO users (role, status, first_name, last_name, email, disabled_at) VALUES ('DEVELOPER', 'DISABLED', 'A', 'B', 'dev2@exemple.test', now()) RETURNING id",
    );
    const required = async () => (await rows<{ required: boolean }>('SELECT two_factor_required AS required FROM users WHERE id = $1', [row!.id]))[0]!.required;
    expect(await required()).toBe(true);
    await rows('UPDATE users SET two_factor_required = false WHERE id = $1', [row!.id]);
    expect(await required()).toBe(true);
    await rows("UPDATE users SET role = 'CLAIMS_OFFICER', two_factor_required = false WHERE id = $1", [row!.id]);
    expect(await required()).toBe(false);
    await rows("UPDATE users SET role = 'DEVELOPER' WHERE id = $1", [row!.id]);
    expect(await required()).toBe(true);
    await rows('DELETE FROM users WHERE id = $1', [row!.id]);
  });
});

describe('first Director', () => {
  it('is created from the server only, once, and opens both delegations', async () => {
    const create = (actor: Actor) =>
      run(actor, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app.create_director('Dora', 'Test', 'premier@exemple.test'::citext) AS id`);
    for (const actor of [staff(s.director, 'DIRECTOR'), about(s.director, true), { kind: 'public' } as Actor])
      await expect(create(actor)).rejects.toThrow(/permission denied/u);
    await expect(create({ kind: 'worker', job: 'account-command' })).rejects.toThrow(/refused/u);
    const empty = await createTestDatabase();
    const database = new Database(empty.url('jobs'));
    try {
      const [created] = await database.run(
        { kind: 'worker', job: 'account-command' },
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app.create_director('Dora', 'Test', 'premier@exemple.test'::citext) AS id`,
      );
      expect((await empty.admin.query('SELECT 1 FROM delegations')).rows).toEqual([]);
      // Once their password is chosen.
      await empty.admin.query("UPDATE users SET status = 'ACTIVE' WHERE id = $1", [created!.id]);
      expect((await empty.admin.query('SELECT kind::text, granted_by, withdrawn_at FROM delegations ORDER BY 1')).rows).toEqual([
        { kind: 'ADMINISTRATIVE', granted_by: created!.id, withdrawn_at: null },
        { kind: 'TECHNICAL', granted_by: created!.id, withdrawn_at: null },
      ]);
      // Disabled then enabled again: what was withdrawn stays withdrawn.
      await empty.admin.query("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL'");
      await empty.admin.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [created!.id]);
      await empty.admin.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [created!.id]);
      expect((await empty.admin.query('SELECT kind::text FROM delegations WHERE withdrawn_at IS NULL')).rows).toEqual([{ kind: 'ADMINISTRATIVE' }]);
      // Another one once they have left, and not before.
      const another = () =>
        database.run(
          { kind: 'worker', job: 'account-command' },
          (tx) => tx.$queryRaw`SELECT app.create_director('Une', 'Autre', 'autre@exemple.test'::citext)`,
        );
      await expect(another()).rejects.toThrow(/refused/u);
      await empty.admin.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [created!.id]);
      await another();
      expect((await empty.admin.query("SELECT email::text FROM users WHERE role = 'DIRECTOR' AND status = 'INVITED'")).rows).toEqual([
        { email: 'autre@exemple.test' },
      ]);
    } finally {
      await database.close();
      await empty.drop();
    }
  });
});

describe('what is done to the account of someone else', () => {
  const ACTORS: [string, () => Actor][] = [
    ['a claims officer', () => staff(s.officerA, 'CLAIMS_OFFICER')],
    [
      'someone who says they act for the Director',
      () => staff(s.officerA, 'DIRECTOR', { delegations: ['TECHNICAL', 'ADMINISTRATIVE'], actingFor: 'ADMINISTRATIVE' }),
    ],
    ['the manager, who acts on behalf of nobody', () => staff(s.manager, 'COLLECTION_MANAGER')],
    ['the Developer, who acts on behalf of nobody', () => staff(s.developer, 'DEVELOPER')],
    ['the Developer, with the delegation of the manager', () => staff(s.developer, 'DEVELOPER', { actingFor: 'ADMINISTRATIVE' })],
    ['a creditor', () => ({ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA })],
    ['the sign-in of the Director', () => about(s.director, true)],
    ['the worker', () => ({ kind: 'worker', job: 'test' })],
  ];
  const account = async (status: 'ACTIVE' | 'INVITED' | 'DISABLED', role = 'CLAIMS_OFFICER', creditorId: string | null = null) =>
    (
      await rows<{ id: string }>(
        `INSERT INTO users (role, status, first_name, last_name, email, creditor_id, password_hash, disabled_at)
         VALUES ($1::user_role, $2::user_status, 'Nora', 'Test', $3, $4, 'hash', CASE WHEN $2 = 'DISABLED' THEN now() END) RETURNING id`,
        [role, status, `${randomUUID()}@exemple.test`, creditorId],
      )
    )[0]!.id;
  /** What PostgreSQL answers: `done`, or the code of its refusal. Nothing of it stays. */
  const answer = (actor: Actor, statement: string) =>
    run(actor, async (tx) => {
      await tx.$executeRawUnsafe(statement);
      throw new Error('undone');
    }).then(
      () => 'done',
      (error: unknown) => databaseCode(error) ?? ((error as Error).message === 'undone' ? 'done' : String(error)),
    );
  const manager = () => staff(s.manager, 'COLLECTION_MANAGER', { actingFor: 'ADMINISTRATIVE' });
  const developer = () => staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' });
  const director = () => staff(s.director, 'DIRECTOR');

  it.each(ACTORS)('is refused to %s', async (_name, actor) => {
    const [active, invited, disabled] = [await account('ACTIVE'), await account('INVITED'), await account('DISABLED')];
    // Each one on an account in the state that it expects.
    for (const statement of [
      `SELECT app.invite_member('CLAIMS_OFFICER', 'A', 'B', 'x${randomUUID()}@legarec.fr', NULL)`,
      `SELECT app.cancel_invitation('${invited}')`,
      `SELECT app.disable_member('${active}', 'x', 0)`,
      `SELECT app.enable_member('${disabled}')`,
      `SELECT app.set_member_role('${active}', 'COLLECTION_MANAGER')`,
      `SELECT app.set_extension('${active}', '118')`,
      ...['RESET_LINK', 'SECOND_FACTOR_REQUIRED', 'SECOND_FACTOR_RESET', 'ACCOUNT_UNLOCKED'].map(
        (action) => `SELECT app.support('${active}', '${action}', '{}')`,
      ),
      `SELECT app.set_delegation('TECHNICAL', false)`,
      `SELECT app.set_delegation('ADMINISTRATIVE', true)`,
    ])
      expect(await answer(actor(), statement), statement).toBe('42501');
  });

  it('is granted, and refused, by the state of the account and by the right of whoever asks', async () => {
    const [active, invited, disabled, creditor] = [
      await account('ACTIVE'),
      await account('INVITED'),
      await account('DISABLED'),
      await account('ACTIVE', 'CREDITOR', s.creditorA),
    ];
    const anonymized = await account('DISABLED');
    await rows('UPDATE users SET anonymized_at = now() WHERE id = $1', [anonymized]);
    const unknown = randomUUID();
    const [done, none, refused] = ['done', 'LG404', '42501'];
    const table: [Actor, string, string][] = [
      ...[director(), manager()].flatMap((actor): [Actor, string, string][] => [
        [actor, `SELECT app.cancel_invitation('${invited}')`, done],
        ...[active, disabled, creditor, unknown].map((id): [Actor, string, string] => [actor, `SELECT app.cancel_invitation('${id}')`, none]),
        [actor, `SELECT app.disable_member('${active}', 'x', 0)`, done],
        [actor, `SELECT app.disable_member('${creditor}', 'x', 0)`, done],
        // What was confirmed is what is done.
        [actor, `SELECT app.disable_member('${active}', 'x', 1)`, 'LG409'],
        ...[invited, disabled, unknown].map((id): [Actor, string, string] => [actor, `SELECT app.disable_member('${id}', 'x', 0)`, none]),
        ...[s.director, (actor as Extract<Actor, { kind: 'staff' }>).userId].map((id): [Actor, string, string] => [
          actor,
          `SELECT app.disable_member('${id}', 'x', 0)`,
          refused,
        ]),
        [actor, `SELECT app.enable_member('${disabled}')`, done],
        ...[active, invited, anonymized, unknown].map((id): [Actor, string, string] => [actor, `SELECT app.enable_member('${id}')`, none]),
        ...[invited, disabled, creditor].map((id): [Actor, string, string] => [actor, `SELECT app.set_member_role('${id}', 'CLAIMS_OFFICER')`, refused]),
        [actor, `SELECT app.set_member_role('${active}', 'CREDITOR')`, refused],
        [actor, `SELECT app.set_member_role('${active}', 'CLAIMS_OFFICER')`, done],
        [actor, `SELECT app.set_member_role('${unknown}', 'CLAIMS_OFFICER')`, none],
        [actor, `SELECT app.set_extension('${active}', '118')`, refused],
        ...[invited, disabled].map((id): [Actor, string, string] => [actor, `SELECT app.support('${id}', 'RESET_LINK', '{}')`, refused]),
        [actor, `SELECT app.support('${unknown}', 'RESET_LINK', '{}')`, none],
      ]),
      // The Developer supports the team, and sets its telephones: nothing else.
      [developer(), `SELECT app.invite_member('CLAIMS_OFFICER', 'A', 'B', 'x@legarec.fr', NULL)`, refused],
      [developer(), `SELECT app.cancel_invitation('${invited}')`, refused],
      [developer(), `SELECT app.disable_member('${active}', 'x', 0)`, refused],
      [developer(), `SELECT app.enable_member('${disabled}')`, refused],
      [developer(), `SELECT app.set_member_role('${active}', 'CLAIMS_OFFICER')`, refused],
      [developer(), `SELECT app.set_extension('${active}', '118')`, done],
      ...[creditor, invited, disabled, unknown].map((id): [Actor, string, string] => [developer(), `SELECT app.set_extension('${id}', '118')`, none]),
      ...[invited, disabled, creditor].map((id): [Actor, string, string] => [developer(), `SELECT app.support('${id}', 'RESET_LINK', '{}')`, refused]),
      [developer(), `SELECT app.set_delegation('TECHNICAL', true)`, refused],
      [manager(), `SELECT app.support('${s.developer}', 'SECOND_FACTOR_RESET', '{}')`, refused],
      [manager(), `SELECT app.set_delegation('ADMINISTRATIVE', true)`, refused],
      [director(), `SELECT app.set_delegation('ADMINISTRATIVE', false)`, done],
    ];
    for (const [actor, statement, expected] of table)
      expect(await answer(actor, statement), `${(actor as { role: string }).role}: ${statement}`).toBe(expected);
  });

  it('stops when the delegation is withdrawn while it is under way', async () => {
    for (const [actor, kind] of [
      [manager(), 'ADMINISTRATIVE'],
      [developer(), 'TECHNICAL'],
    ] as const) {
      const id = await account('ACTIVE');
      const under = run(actor, async (tx) => {
        await rows('UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = $1::delegation_kind AND withdrawn_at IS NULL', [kind]);
        await tx.$executeRawUnsafe(`SELECT app.support('${id}', 'SECOND_FACTOR_REQUIRED', '{}')`);
      });
      await expect(under).rejects.toThrow(/withdrawn/u);
      expect(await rows('SELECT two_factor_required FROM users WHERE id = $1', [id])).toEqual([{ two_factor_required: false }]);
      await rows('INSERT INTO delegations (kind, granted_by) VALUES ($1::delegation_kind, $2)', [kind, s.director]);
    }
  });

  it.each([
    ['disabled', (id: string) => `SELECT app.disable_member('${id}', 'x', 1)`],
    ['given another role', (id: string) => `SELECT app.set_member_role('${id}', 'COLLECTION_MANAGER')`],
  ])('leaves nothing open of an account %s: sessions, links, browsers, cases, replacements', async (_what, statement) => {
    const id = await account('ACTIVE');
    // The role is free for the time of the test.
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.manager]);
    const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name) VALUES ('INDIVIDUAL', 'Débiteur') RETURNING id");
    const [held] = await rows<{ id: string; version: number }>(
      'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ($1, $2, $3, $4) RETURNING id, version',
      [`LGR-2026-${String(10_000 + Math.floor(Math.random() * 80_000))}`, s.creditorA, debtor!.id, id],
    );
    await rows('UPDATE users SET substitute_id = $1 WHERE id = $2', [id, s.officerB]);
    await rows(
      "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'x', false, now() + interval '1 hour')",
      [id, randomBytes(32)],
    );
    for (const purpose of ['RESET', 'INVITATION', 'WEBAUTHN'])
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1::token_purpose, $2, $3, now() + interval '1 hour')", [
        purpose,
        id,
        randomBytes(32),
      ]);
    await rows("INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'x', now() + interval '1 day')", [id, randomBytes(32)]);
    try {
      await run(director(), (tx) => tx.$executeRawUnsafe(statement(id)));
    } finally {
      await rows("UPDATE users SET role = 'CLAIMS_OFFICER' WHERE id = $1", [id]);
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.manager]);
    }
    for (const table of ['user_sessions WHERE revoked_at IS NULL AND', 'auth_tokens WHERE used_at IS NULL AND', 'user_devices WHERE'])
      expect(await rows(`SELECT 1 FROM ${table} user_id = $1`, [id]), table).toEqual([]);
    expect(await rows('SELECT officer_id, version FROM cases WHERE id = $1', [held!.id])).toEqual([{ officer_id: null, version: held!.version + 1 }]);
    expect(await rows('SELECT substitute_id FROM users WHERE id = $1', [s.officerB])).toEqual([{ substitute_id: null }]);
    // Those of the others are left as they were.
    expect(await rows('SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [s.officerB])).not.toEqual([]);
    expect(await rows('SELECT 1 FROM user_devices WHERE user_id = $1', [s.officerB])).not.toEqual([]);
  });

  it('leaves an account as it is when it is given the role that it has', async () => {
    const id = await account('ACTIVE');
    await rows(
      "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'x', false, now() + interval '1 hour')",
      [id, randomBytes(32)],
    );
    await run(director(), (tx) => tx.$executeRawUnsafe(`SELECT app.set_member_role('${id}', 'CLAIMS_OFFICER')`));
    expect(await rows('SELECT 1 FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL', [id])).toHaveLength(1);
  });

  it('asks for a mailbox for a collaborator, and for nobody else', async () => {
    const invite = async (role: string, creditorId: string | null) => {
      const email = `Iris.${randomBytes(4).toString('hex')}@legarec.fr`;
      const [row] = await run(
        manager(),
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT app.invite_member(${role}::user_role, 'Iris', 'Test', ${email}::citext, ${creditorId}::uuid) AS id`,
      );
      return {
        local: email.split('@')[0]!.toLowerCase(),
        requests: await rows('SELECT local, requested_by, status::text FROM mailbox_requests WHERE user_id = $1', [row!.id]),
      };
    };
    const collaborator = await invite('CLAIMS_OFFICER', null);
    expect(collaborator.requests).toEqual([{ local: collaborator.local, requested_by: s.manager, status: 'OPEN' }]);
    expect((await invite('CREDITOR', s.creditorA)).requests).toEqual([]);
  });

  it('is refused on the account of the Director, and on one’s own, to whoever may otherwise act', async () => {
    const manager = staff(s.manager, 'COLLECTION_MANAGER', { actingFor: 'ADMINISTRATIVE' });
    const director = staff(s.director, 'DIRECTOR');
    const refused: [Actor, string][] = [
      [manager, `SELECT app.disable_member('${s.director}', 'x', 1)`],
      [manager, `SELECT app.set_member_role('${s.director}', 'CLAIMS_OFFICER')`],
      [manager, `SELECT app.support('${s.director}', 'RESET_LINK', '{}')`],
      [manager, `SELECT app.support('${s.manager}', 'RESET_LINK', '{}')`],
      [manager, `SELECT app.support('${s.officerB}', 'SECOND_FACTOR_RESET', '{}')`],
      [manager, `SELECT app.set_member_role('${s.manager}', 'DIRECTOR')`],
      [manager, `SELECT app.set_member_role('${s.partnerA}', 'CLAIMS_OFFICER')`],
      [manager, `SELECT app.set_member_role('${s.officerB}', 'CREDITOR')`],
      [director, `SELECT app.disable_member('${s.director}', 'x', 1)`],
      [director, `SELECT app.set_member_role('${s.director}', 'CLAIMS_OFFICER')`],
      [director, `SELECT app.support('${s.director}', 'SECOND_FACTOR_RESET', '{}')`],
      [director, `SELECT app.set_extension('${s.officerB}', '118')`],
      [staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' }), `SELECT app.support('${s.developer}', 'SECOND_FACTOR_RESET', '{}')`],
      [staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' }), `SELECT app.support('${s.partnerA}', 'RESET_LINK', '{}')`],
      [staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' }), `SELECT app.support('${s.director}', 'SECOND_FACTOR_REQUIRED', '{}')`],
      [staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' }), `SELECT app.invite_member('DIRECTOR', 'A', 'B', 'x@legarec.fr', NULL)`],
      [staff(s.developer, 'DEVELOPER', { actingFor: 'TECHNICAL' }), `SELECT app.set_member_role('${s.officerB}', 'DIRECTOR')`],
    ];
    for (const [actor, statement] of refused)
      await expect(
        run(actor, (tx) => tx.$queryRawUnsafe(statement)),
        statement,
      ).rejects.toThrow(/refused/u);
    // A second holder of a unique role, even by a defect of the API.
    for (const role of ['DIRECTOR', 'COLLECTION_MANAGER', 'DEVELOPER']) {
      await expect(run(director, (tx) => tx.$queryRawUnsafe(`SELECT app.set_member_role('${s.officerB}', '${role}')`))).rejects.toThrow(/users_single_role/u);
      await expect(run(director, (tx) => tx.$queryRawUnsafe(`SELECT app.invite_member('${role}', 'A', 'B', 'x@legarec.fr', NULL)`))).rejects.toThrow(
        /users_single_role/u,
      );
    }
  });

  it('opens a question for a collaborator, who is still one, and for nobody else', async () => {
    const ask = (actor: Actor) => answer(actor, "SELECT * FROM app.open_ticket('Sujet', 'Une question.')");
    // After those of the test.
    await rows("INSERT INTO number_sequences (kind, year, last_value) VALUES ('TICKET', extract(year FROM now() AT TIME ZONE 'Europe/Paris'), 5000)");
    expect(await ask(staff(s.officerA, 'CLAIMS_OFFICER'))).toBe('done');
    const [gone, invited] = [await account('DISABLED'), await account('INVITED')];
    // A creditor taken for a collaborator, an account closed since, one that was never opened.
    for (const id of [s.partnerA, gone, invited, randomUUID()]) expect(await ask(staff(id, 'CLAIMS_OFFICER')), id).toBe('42501');
    for (const actor of [about(s.officerA, true), { kind: 'partner', userId: s.partnerA, creditorId: s.creditorA }, { kind: 'worker', job: 'test' }] as Actor[])
      expect(await ask(actor)).toBe('42501');
    expect(await rows("SELECT 1 FROM support_tickets WHERE message = 'Une question.' AND user_id <> $1", [s.officerA])).toEqual([]);
  });

  it('gives a question to the Developer, otherwise to the Director, never to its author nor to anyone else', async () => {
    const reader = async (userId: string) => {
      const [ticket] = await rows<{ id: string }>("INSERT INTO support_tickets (number, user_id, subject, message) VALUES ($1, $2, '', 'x') RETURNING id", [
        `2026-${String(Math.floor(Math.random() * 1e9)).padStart(4, '0')}`,
        userId,
      ]);
      const [row] = await run(
        { kind: 'worker', job: 'test' },
        (tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app.ticket_reader(${ticket!.id}::uuid) AS id`,
      );
      return row!.id;
    };
    const set = (id: string, status: string) =>
      rows("UPDATE users SET status = $2::user_status, disabled_at = CASE WHEN $2 = 'DISABLED' THEN now() END WHERE id = $1", [id, status]);
    expect(await reader(s.officerA)).toBe(s.developer);
    expect(await reader(s.director)).toBe(s.developer);
    expect(await reader(s.developer)).toBe(s.director);
    await set(s.developer, 'DISABLED');
    try {
      for (const id of [s.officerA, s.manager, s.developer]) expect(await reader(id)).toBe(s.director);
      // Nobody is left: the question waits, and reaches neither the manager nor a colleague.
      expect(await reader(s.director)).toBeNull();
      await set(s.director, 'DISABLED');
      expect(await reader(s.officerA)).toBeNull();
    } finally {
      await set(s.director, 'ACTIVE');
      await set(s.developer, 'ACTIVE');
    }
  });

  it('names the manager to a creditor whose portal is open, and to nobody else', async () => {
    const officer = async (actor: Actor) => (await run(actor, (tx) => tx.$queryRaw<{ name: string | null }[]>`SELECT app.portal_officer() AS name`))[0]!.name;
    const partner = (creditorId: string): Actor => ({ kind: 'partner', userId: s.partnerA, creditorId });
    expect(await officer(partner(s.creditorA))).toBe('Remi Test');
    // Said to be of another creditor.
    expect(await officer(partner(s.creditorB))).toBeNull();
    await rows('UPDATE creditors SET portal_enabled = false WHERE id = $1', [s.creditorA]);
    expect(await officer(partner(s.creditorA))).toBeNull();
    await rows('UPDATE creditors SET portal_enabled = true WHERE id = $1', [s.creditorA]);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.manager]);
    expect(await officer(partner(s.creditorA))).toBeNull();
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.manager]);
    await expect(officer(staff(s.officerA, 'CLAIMS_OFFICER'))).rejects.toThrow(/denied/u);
  });

  it('tells the state of the accounts to those who administer or support them only', async () => {
    const states = (actor: Actor) => run(actor, (tx) => tx.$queryRawUnsafe<unknown[]>('SELECT * FROM app.account_states()'));
    const locked = (actor: Actor) => run(actor, (tx) => tx.$queryRawUnsafe<unknown[]>("SELECT app.locked(ARRAY['0202'])"));
    await rows("INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ('\\x0202', 'SIGN_IN', 5, now() + interval '1 minute')");
    expect(await states(staff(s.officerA, 'DIRECTOR'))).toEqual([]);
    expect(await locked(staff(s.officerA, 'DIRECTOR'))).toEqual([]);
    expect(await locked(staff(s.developer, 'DEVELOPER'))).toHaveLength(1);
    expect(JSON.stringify(await states(staff(s.developer, 'DEVELOPER')))).not.toContain(s.partnerA);
    expect(JSON.stringify(await states(staff(s.manager, 'COLLECTION_MANAGER')))).toContain(s.partnerA);
    for (const actor of [{ kind: 'partner', userId: s.partnerA, creditorId: s.creditorA }, about(s.director, true)] as Actor[]) {
      await expect(states(actor)).rejects.toThrow(/denied/u);
      await expect(locked(actor)).rejects.toThrow(/denied/u);
    }
  });

  it('counts the sessions that are open, the second factors that are proved, and the locks that hold', async () => {
    const id = await account('ACTIVE');
    const state = async () =>
      (
        await run(
          director(),
          (tx) =>
            tx.$queryRaw<{ second_factor: boolean; sessions: number }[]>`SELECT second_factor, sessions FROM app.account_states() WHERE user_id = ${id}::uuid`,
        )
      )[0];
    const session = (some: Record<string, string>) =>
      rows(
        `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, second_factor_at, expires_at, last_seen_at, revoked_at)
         VALUES ($1, 'STAFF', $2, 'x', ${some.needed ?? 'false'}, ${some.given ?? 'NULL'}, ${some.expires ?? "now() + interval '1 hour'"}, ${some.seen ?? 'now()'}, ${some.revoked ?? 'NULL'})`,
        [id, randomBytes(32)],
      );
    await session({ revoked: 'now()' });
    await session({ expires: "now() - interval '1 minute'" });
    await session({ seen: "now() - interval '31 minutes'" });
    await session({ needed: 'true' });
    await rows("INSERT INTO second_factors (user_id, kind, secret_cipher) VALUES ($1, 'TOTP', '\\x00')", [id]);
    expect(await state()).toEqual({ second_factor: false, sessions: 0 });
    await session({});
    await session({ needed: 'true', given: 'now()' });
    await rows('UPDATE second_factors SET confirmed_at = now() WHERE user_id = $1', [id]);
    expect(await state()).toEqual({ second_factor: true, sessions: 2 });
    const locked = (key: string) => run(director(), (tx) => tx.$queryRaw<unknown[]>`SELECT app.locked(${[key]}::text[])`);
    await rows(
      "INSERT INTO lockouts (key_hash, scope, failures, locked_until) VALUES ('\\x0303', 'SIGN_IN', 5, now() + interval '1 minute'), ('\\x0404', 'SIGN_IN', 5, now() - interval '1 minute'), ('\\x0505', 'SIGN_IN', 4, NULL)",
    );
    expect(await Promise.all(['0303', '0404', '0505', '0606'].map(async (key) => (await locked(key)).length))).toEqual([1, 0, 0, 0]);
  });
});
