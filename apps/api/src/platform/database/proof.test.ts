import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, seed, type Seed, type TestDatabase } from '../../../test/database';
import type { Actor } from './actor';
import { Database } from './database';

/** Before it has shown who it is, an account found by its address may be read, and nothing of it written. */
let test: TestDatabase;
let api: Database;
let s: Seed;
const rows = async (sql: string, values: unknown[] = []) => (await test.admin.query(sql, values)).rows as Record<string, unknown>[];
beforeAll(async () => {
  test = await createTestDatabase();
  s = await seed(test.admin);
  api = new Database(test.url('app'));
  await rows(
    "INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ($1, 'STAFF', $2, 'x', true, now() + interval '1 hour')",
    [s.officerA, randomBytes(32)],
  );
  await rows("INSERT INTO second_factors (user_id, kind, secret_cipher, confirmed_at) VALUES ($1, 'TOTP', '\\x00', now())", [s.officerA]);
  await rows("INSERT INTO backup_codes (user_id, code_hash) VALUES ($1, 'x')", [s.officerA]);
  await rows("INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', $1, $2, now() + interval '1 hour')", [
    s.officerA,
    randomBytes(32),
  ]);
  await rows("INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ($1, $2, 'x', now() + interval '1 hour')", [
    s.officerA,
    randomBytes(32),
  ]);
});
afterAll(async () => {
  await api.close();
  await test.drop();
});

const id = () => s.officerA;
const CHANGES: [string, () => string][] = [
  ['password', () => "UPDATE users SET password_hash = 'x'"],
  ['session', () => 'UPDATE user_sessions SET second_factor_at = now()'],
  ['second factor', () => 'UPDATE second_factors SET last_step = 0'],
  ['second factor removed', () => 'DELETE FROM second_factors'],
  ['backup code', () => 'UPDATE backup_codes SET used_at = now()'],
  ['backup codes removed', () => 'DELETE FROM backup_codes'],
  ['link', () => 'UPDATE auth_tokens SET used_at = now()'],
  ['browser', () => "UPDATE user_devices SET label = 'y'"],
];
const ADDITIONS: [string, () => string][] = [
  [
    'session',
    () =>
      `INSERT INTO user_sessions (user_id, portal, token_hash, device_label, second_factor_needed, expires_at) VALUES ('${id()}', 'STAFF', '\\x01', 'x', false, now() + interval '1 hour')`,
  ],
  ['second factor', () => `INSERT INTO second_factors (user_id, kind, secret_cipher) VALUES ('${id()}', 'TOTP', '\\x00')`],
  ['backup code', () => `INSERT INTO backup_codes (user_id, code_hash) VALUES ('${id()}', 'y')`],
  ['link', () => `INSERT INTO auth_tokens (purpose, user_id, token_hash, expires_at) VALUES ('RESET', '${id()}', '\\x02', now() + interval '1 hour')`],
  ['browser', () => `INSERT INTO user_devices (user_id, token_hash, label, expires_at) VALUES ('${id()}', '\\x03', 'x', now())`],
];
const about = (): Actor => ({ kind: 'anonymous', subject: id() });
const proved = (): Actor => ({ kind: 'anonymous', subject: id(), proved: true });
class Undone extends Error {}
/** Rolled back: each line stands alone. */
const tried = async (actor: Actor, statement: string) => {
  let count = -1;
  await api
    .run(actor, async (tx) => {
      count = await tx.$executeRawUnsafe(statement);
      throw new Undone();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Undone)) throw error;
    });
  return count;
};

describe('an account that has proved nothing', () => {
  it.each(CHANGES)('changes nothing: %s', async (_name, statement) => {
    expect(await tried(about(), statement())).toBe(0);
    expect(await tried(proved(), statement())).toBe(1);
  });
  it.each(ADDITIONS)('adds nothing: %s', async (_name, statement) => {
    await expect(tried(about(), statement())).rejects.toThrow(/row-level security/u);
    expect(await tried(proved(), statement())).toBe(1);
  });
  it('says nothing to the Director', async () => {
    await tried(about(), 'SELECT app.tell_reset()');
    await api.run(about(), (tx) => tx.$executeRawUnsafe('SELECT app.tell_reset()'));
    expect(await rows('SELECT 1 FROM notifications')).toEqual([]);
    await api.run(proved(), (tx) => tx.$executeRawUnsafe('SELECT app.tell_reset()'));
    expect(await rows('SELECT kind::text, user_id, actor_id, target_id FROM notifications')).toEqual([
      { kind: 'PASSWORD_RESET', user_id: s.director, actor_id: id(), target_id: id() },
    ]);
  });
});
