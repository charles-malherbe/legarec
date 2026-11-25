import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import { Database } from '../database/database';
import { createLogger } from '../logging/logger';
import { purge } from './maintenance';

let test: TestDatabase;
let s: Seed;
let jobs: Database;
const logger = createLogger('debug', new Writable({ write: (_chunk, _encoding, done) => done() }));
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const hash = () => randomBytes(32);

beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  jobs = new Database(test.url('jobs'));
});
afterAll(async () => {
  await jobs.close();
  await test.drop();
});

describe('sign-ins', () => {
  it('are forgotten 48 hours after their end', async () => {
    const session = (label: string, expires: string, seen: string, revoked = 'NULL') =>
      rows(
        `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at, last_seen_at, revoked_at)
         VALUES ($1, 'STAFF', $2, $3, false, now() + interval '${expires}', now() - interval '${seen}', ${revoked})`,
        [s.officerA, hash(), label],
      );
    await session('open', '1 hour', '1 minute');
    await session('closed a moment ago', '1 hour', '1 hour', "now() - interval '1 hour'");
    await session('closed for long', '1 hour', '50 hours', "now() - interval '49 hours'");
    await session('expired for long', '-49 hours', '1 minute');
    await session('expired a moment ago', '-47 hours', '47 hours');
    await session('silent for long', '1 hour', '49 hours');
    const link = (name: string, expires: string, used = 'NULL') =>
      rows(`INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at, used_at) VALUES ('RESET', $1, $2, now() + interval '${expires}', ${used})`, [
        s.officerA,
        Buffer.from(name),
      ]);
    await link('live', '1 hour');
    await link('used a moment ago', '1 hour', "now() - interval '1 hour'");
    await link('used for long', '1 hour', "now() - interval '49 hours'");
    await link('expired for long', '-49 hours');
    await rows(
      "INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'kept', now() + interval '1 day'), ($1, $3, 'gone', now() - interval '1 minute')",
      [s.officerA, hash(), hash()],
    );
    await rows(
      "INSERT INTO lockouts (key_hash, scope, failures, last_failure_at) VALUES ($1, 'SIGN_IN', 1, now() - interval '13 months'), ($2, 'SIGN_IN', 1, now() - interval '11 months')",
      [hash(), hash()],
    );
    expect(await purge(jobs, logger)).toMatchObject({ 'sign-ins': 7 });
    expect((await rows<{ device_label: string }>('SELECT device_label FROM user_sessions ORDER BY 1')).map((row) => row.device_label)).toEqual([
      'closed a moment ago',
      'expired a moment ago',
      'open',
    ]);
    expect((await rows<{ name: string }>("SELECT convert_from(token_hash, 'UTF8') AS name FROM auth_tokens ORDER BY 1")).map((row) => row.name)).toEqual([
      'live',
      'used a moment ago',
    ]);
    expect(await rows('SELECT label FROM user_devices')).toEqual([{ label: 'kept' }]);
    expect(await rows('SELECT 1 FROM lockouts')).toHaveLength(1);
  });

  it('keep the session that a question of a security key still refers to', async () => {
    const [session] = await rows<{ id: string }>(
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at)
       VALUES ($1, 'STAFF', $2, 'asked', true, now() - interval '49 hours') RETURNING id`,
      [s.officerB, hash()],
    );
    await rows("INSERT INTO auth_tokens (purpose, user_id, session_id, token_hash, expires_at) VALUES ('WEBAUTHN', $1, $2, $3, now() - interval '47 hours')", [
      s.officerB,
      session!.id,
      hash(),
    ]);
    await purge(jobs, logger);
    expect(await rows('SELECT 1 FROM user_sessions WHERE id = $1', [session!.id])).toHaveLength(1);
    await rows("UPDATE auth_tokens SET expires_at = now() - interval '49 hours' WHERE session_id = $1", [session!.id]);
    await purge(jobs, logger);
    expect(await rows('SELECT 1 FROM user_sessions WHERE id = $1', [session!.id])).toEqual([]);
  });
});

describe('accounts', () => {
  const disabled = async (since: string) =>
    (
      await rows<{ id: string }>(
        `INSERT INTO users (role, status, first_name, last_name, email, extension, password_hash, disabled_at, disabled_by, disabled_reason)
         VALUES ('CLAIMS_OFFICER', 'DISABLED', 'Prénom-MARK', 'Nom-MARK', $1, '118', 'hash-MARK', now() - interval '${since}', $2, 'Motif-MARK') RETURNING id`,
        [`mark${Math.random().toString().slice(2)}@mark.test`, s.director],
      )
    )[0]!.id;

  it('disabled for two years are nobody any more, and leave everything that refers to them', async () => {
    const [old, recent] = [await disabled('25 months'), await disabled('23 months')];
    for (const id of [old, recent]) {
      await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [id]);
      await rows("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, 'x')", [id]);
      await rows(
        "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'x', false, now() + interval '1 hour')",
        [id, hash()],
      );
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [id, hash()]);
      await rows("INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'x', now() + interval '1 day')", [id, hash()]);
      await rows("INSERT INTO notification_preferences (user_id, kind, in_app, email) VALUES ($1, 'payment', true, true)", [id]);
      await rows("INSERT INTO notifications (user_id, kind, action, actor_id, target_id) VALUES ($1, 'SUPPORT_ACTION', 'RESET_LINK', $2, $1)", [
        id,
        s.developer,
      ]);
      await rows("INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ($1, 'mark', $2)", [id, s.director]);
    }
    await rows(
      "INSERT INTO case_events (case_id, creditor_id, kind, title, actor_kind, actor_id, actor_label) VALUES ($1, $2, 'NOTE', 'Note', 'STAFF', $3, 'Prénom Nom')",
      [s.cases.ofA, s.creditorA, old],
    );
    await rows('UPDATE users SET substitute_id = $1 WHERE id = ANY ($2::uuid[])', [s.officerB, [old, recent]]);
    expect(await purge(jobs, logger)).toMatchObject({ accounts: 1 });
    expect(await rows('SELECT substitute_id FROM users WHERE id = ANY ($1::uuid[]) ORDER BY id = $2', [[old, recent], recent])).toEqual([
      { substitute_id: null },
      { substitute_id: s.officerB },
    ]);
    const [user] = await rows(
      'SELECT status::text, first_name, last_name, email::text, extension, password_hash, disabled_reason, anonymized_at IS NOT NULL AS anonymized FROM users WHERE id = $1',
      [old],
    );
    expect(user).toEqual({
      status: 'DISABLED',
      first_name: 'Compte',
      last_name: 'anonymisé',
      email: `${old}@anonyme.invalid`,
      extension: null,
      password_hash: null,
      disabled_reason: null,
      anonymized: true,
    });
    for (const table of [
      'second_factors',
      'backup_codes',
      'user_sessions',
      'auth_tokens',
      'user_devices',
      'notification_preferences',
      'notifications',
      'mailbox_requests',
    ]) {
      expect(await rows(`SELECT 1 FROM ${table} WHERE user_id = $1`, [old]), table).toEqual([]);
      expect(await rows(`SELECT 1 FROM ${table} WHERE user_id = $1`, [recent]), table).toHaveLength(1);
    }
    expect(await rows('SELECT first_name FROM users WHERE id = $1', [recent])).toEqual([{ first_name: 'Prénom-MARK' }]);
    // The history of the case still knows that somebody wrote.
    expect(await rows('SELECT actor_id FROM case_events WHERE actor_id = $1', [old])).toHaveLength(1);
    // Once is enough, and nothing happens to the others.
    expect(await purge(jobs, logger)).toMatchObject({ accounts: 0 });
    expect(await rows("SELECT 1 FROM users WHERE status = 'ACTIVE' AND anonymized_at IS NOT NULL")).toEqual([]);
  });

  it('invited a year ago, and never opened, are removed', async () => {
    const invited = async (email: string, since: string, hash: string | null = null) =>
      (
        await rows<{ id: string }>(
          `INSERT INTO users (role, status, first_name, last_name, email, invited_at, password_hash) VALUES ('CLAIMS_OFFICER', 'INVITED', 'A', 'B', $1, now() - interval '${since}', $2) RETURNING id`,
          [email, hash],
        )
      )[0]!.id;
    const [old, recent, opened] = [
      await invited('old@mark.test', '13 months'),
      await invited('recent@mark.test', '11 months'),
      await invited('opened@mark.test', '13 months', 'hash'),
    ];
    for (const id of [old, recent]) {
      await rows("INSERT INTO mailbox_requests (user_id, local, requested_by) VALUES ($1, 'x', $2)", [id, s.director]);
      await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('INVITATION', $1, $2, now() + interval '1 hour')", [id, hash()]);
    }
    expect(await purge(jobs, logger)).toMatchObject({ accounts: 1 });
    expect(
      (await rows<{ id: string }>('SELECT id FROM users WHERE id = ANY ($1::uuid[]) ORDER BY email', [[old, recent, opened]])).map((row) => row.id),
    ).toEqual([opened, recent]);
    expect(await rows('SELECT 1 FROM mailbox_requests WHERE user_id = $1 UNION ALL SELECT 1 FROM auth_tokens WHERE user_id = $1', [old])).toEqual([]);
    await rows("DELETE FROM users WHERE email IN ('opened@mark.test')");
  });

  it('of someone who came back are kept', async () => {
    const id = await disabled('25 months');
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = $1", [id]);
    expect(await purge(jobs, logger)).toMatchObject({ accounts: 0 });
  });

  it('opened again while they are being forgotten are kept whole', async () => {
    const id = await disabled('25 months');
    const other = new pg.Client({ connectionString: test.adminUrl });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query("UPDATE users SET status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL WHERE id = $1", [id]);
      expect(await purge(jobs, logger)).toMatchObject({ accounts: 0 });
      await other.query('COMMIT');
    } finally {
      await other.end();
    }
    expect(await rows('SELECT status, last_name, anonymized_at FROM users WHERE id = $1', [id])).toEqual([
      { status: 'ACTIVE', last_name: 'Nom-MARK', anonymized_at: null },
    ]);
  });
});

describe('notifications and questions to the support', () => {
  it('are kept for two years', async () => {
    await rows('DELETE FROM notifications');
    for (const [number, age] of [
      ['2024-0001', '25 months'],
      ['2025-0001', '23 months'],
    ] as const) {
      const [ticket] = await rows<{ id: string }>(
        `INSERT INTO support_tickets (number, user_id, subject, message, created_at) VALUES ($1, $2, 'Sujet', 'Une question.', now() - interval '${age}') RETURNING id`,
        [number, s.officerA],
      );
      await rows(
        `INSERT INTO notifications (user_id, kind, ticket_id, actor_id, created_at) VALUES ($1, 'SUPPORT_TICKET', $2, $3, now() - interval '${age}')`,
        [s.developer, ticket!.id, s.officerA],
      );
    }
    expect(await purge(jobs, logger)).toMatchObject({ notifications: 1, 'support-tickets': 1 });
    expect(await rows('SELECT number FROM support_tickets')).toEqual([{ number: '2025-0001' }]);
  });
});
