import { secretsData, type Delegation } from '@legarec/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { databaseCode } from '../../platform/database/codes';
import type { Transaction } from '../../platform/database/database';
import { Vault } from './vault';

const VALUE = 'valeur-fictive-zz-KXPM';
let test: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff/secrets${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const list = async (as = 'director') => secretsData.parse((await call(as, 'GET', '')).body).items;
const save = (as: string, name = 'RESEND_API_KEY', value = VALUE) => call(as, 'POST', '', { name, value, rotation: '90' });
const saved = async () => {
  await save('director');
  return (await list())[0]!.id;
};
const cipher = async (id: string) =>
  (await rows<{ value_cipher: Buffer | null }>('SELECT value_cipher FROM vault_secrets WHERE id = $1', [id]))[0]!.value_cipher;
const actions = async (id: string) =>
  (await rows<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at, ctid', [id])).map((row) => row.action);

beforeAll(async () => {
  test = await startApp();
});
beforeEach(async () => void (await rows('DELETE FROM vault_secrets')));
afterAll(() => test.stop());

describe('a secret', () => {
  it('is kept encrypted, for its own line, and is found nowhere else', async () => {
    expect((await save('developer')).status).toBe(204);
    const [item] = await list('developer');
    expect(item).toMatchObject({ name: 'RESEND_API_KEY', internal: false, service: 'Resend', environment: 'Développement', used: 'jamais', status: 'VALID' });
    const vault = new Vault(test.config);
    const sealed = (await cipher(item!.id))!;
    expect(vault.open(item!.id, sealed)).toBe(VALUE);
    expect(() => vault.open(randomUUID(), sealed)).toThrow();
    const everywhere = JSON.stringify([
      await rows('SELECT * FROM audit_log'),
      await rows('SELECT * FROM outbox'),
      await rows("SELECT encode(result, 'escape') FROM idempotency_keys"),
      await call('director', 'GET', ''),
      sealed.toString('latin1'),
    ]);
    expect(everywhere + test.logs.join('')).not.toContain(VALUE);
    expect(await actions(item!.id)).toEqual(['SECRET_SAVED']);
  });

  it('never comes back in an error, whatever is wrong with it', async () => {
    for (const body of [
      { name: 'INCONNU', value: VALUE, rotation: '90' },
      { name: 'RESEND_API_KEY', value: VALUE, rotation: 'jamais' },
      { name: 'RESEND_API_KEY', value: '', rotation: '90' },
      { name: 'MAILBOX_SECRETS_KEY', value: VALUE, rotation: 'MANUAL' },
    ]) {
      const answer = await call('director', 'POST', '', body);
      expect(answer.status).toBe(422);
      expect(JSON.stringify(answer.body)).not.toContain(VALUE);
    }
    await save('director');
    expect(await save('director')).toMatchObject({ status: 409, body: { code: 'SECRET_EXISTS' } });
    expect(test.logs.join('')).not.toContain(VALUE);
  });

  it('is saved once when two people send it at the same time', async () => {
    const answers = await Promise.all([save('director'), save('developer')]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409]);
    expect(await list()).toHaveLength(1);
  });

  it('is renewed with the value that is given, and never without one', async () => {
    const id = await saved();
    await rows("UPDATE vault_secrets SET rotated_at = now() - interval '80 days'");
    expect((await list())[0]!.status).toBe('EXPIRING');
    expect((await call('developer', 'POST', `/${id}/rotate`, {})).status).toBe(422);
    expect((await call('developer', 'POST', `/${id}/rotate`, { value: 'autre-valeur-fictive' })).status).toBe(204);
    expect(new Vault(test.config).open(id, (await cipher(id))!)).toBe('autre-valeur-fictive');
    expect((await list())[0]!.status).toBe('VALID');
    expect(await actions(id)).toEqual(['SECRET_SAVED', 'SECRET_RENEWED']);
  });

  it('is about to expire 15 days before, not one more', async () => {
    const id = await saved();
    await rows("UPDATE vault_secrets SET rotated_at = now() - interval '74 days 23 hours' WHERE id = $1", [id]);
    expect((await list())[0]!.status).toBe('VALID');
    await rows("UPDATE vault_secrets SET rotated_at = now() - interval '75 days' WHERE id = $1", [id]);
    expect((await list())[0]!.status).toBe('EXPIRING');
    // Nothing hides that its revocation was asked.
    await call('developer', 'POST', `/${id}/revoke`);
    expect((await list())[0]!.status).toBe('REVOKE_PENDING');
    await call('director', 'POST', `/${id}/keep`);
    await rows("UPDATE vault_secrets SET rotation = 'MANUAL' WHERE id = $1", [id]);
    expect((await list())[0]!.status).toBe('VALID');
  });

  it('still opens after the renewal of the master key, for as long as the previous one is there', async () => {
    const id = await saved();
    const sealed = (await cipher(id))!;
    const VAULT_MASTER_KEY = randomBytes(32).toString('base64');
    expect(new Vault({ VAULT_MASTER_KEY, VAULT_MASTER_KEY_PREVIOUS: test.config.VAULT_MASTER_KEY }).open(id, sealed)).toBe(VALUE);
    expect(() => new Vault({ VAULT_MASTER_KEY }).open(id, sealed)).toThrow();
  });
});

describe('a revocation', () => {
  it('asked by the Developer waits for the Director, who refuses or decides', async () => {
    const id = await saved();
    expect((await call('developer', 'POST', `/${id}/revoke`)).status).toBe(204);
    expect((await list())[0]!.status).toBe('REVOKE_PENDING');
    // Meanwhile it still works, and nothing else is done to it.
    expect(await cipher(id)).not.toBeNull();
    expect((await call('developer', 'POST', `/${id}/revoke`)).status).toBe(409);
    expect((await call('developer', 'POST', `/${id}/rotate`, { value: 'x' })).status).toBe(409);
    expect((await call('developer', 'POST', `/${id}/keep`)).status).toBe(403);
    expect((await call('director', 'POST', `/${id}/keep`)).status).toBe(204);
    expect((await list())[0]!.status).toBe('VALID');
    await call('developer', 'POST', `/${id}/revoke`);
    expect((await call('director', 'POST', `/${id}/revoke`)).status).toBe(204);
    expect(await actions(id)).toEqual(['SECRET_SAVED', 'SECRET_REVOKE_ASKED', 'SECRET_KEPT', 'SECRET_REVOKE_ASKED', 'SECRET_REVOKED']);
  });

  it('erases the value, and is for good: another one takes its place', async () => {
    const id = await saved();
    expect((await call('director', 'POST', `/${id}/revoke`)).status).toBe(204);
    expect(await cipher(id)).toBeNull();
    for (const then of ['rotate', 'revoke', 'keep'])
      expect((await call('director', 'POST', `/${id}/${then}`, then === 'rotate' ? { value: 'x' } : undefined)).status).toBe(409);
    expect((await save('director')).status).toBe(204);
    expect((await list()).map((item) => item.status)).toEqual(['REVOKED', 'VALID']);
  });

  it('is never that of an internal key, whose value nobody types either', async () => {
    const [row] = await rows<{ id: string }>("INSERT INTO vault_secrets (name, value_cipher) VALUES ('ACCESS_CODE_KEY', '\\x00') RETURNING id");
    for (const then of ['revoke', 'keep']) expect((await call('director', 'POST', `/${row!.id}/${then}`)).status).toBe(404);
    expect((await call('director', 'POST', `/${row!.id}/rotate`, { value: 'x' })).status).toBe(422);
    expect((await list())[0]).toMatchObject({ name: 'ACCESS_CODE_KEY', internal: true, status: 'VALID' });
  });
});

describe('the technical delegation', () => {
  it('once withdrawn, leaves the Developer the list alone', async () => {
    const id = await saved();
    await rows("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = granted_by WHERE kind = 'TECHNICAL' AND withdrawn_at IS NULL");
    try {
      expect(await list('developer')).toHaveLength(1);
      expect((await save('developer', 'AI_API_KEY')).status).toBe(403);
      for (const then of ['rotate', 'revoke'])
        expect((await call('developer', 'POST', `/${id}/${then}`, then === 'rotate' ? { value: 'x' } : undefined)).status).toBe(403);
    } finally {
      await rows("INSERT INTO delegations (kind, granted_by) VALUES ('TECHNICAL', $1)", [test.s.director]);
    }
  });
});

describe('PostgreSQL itself', () => {
  type Work = (tx: Transaction) => Promise<unknown>;
  const ROLES = { director: 'DIRECTOR', manager: 'COLLECTION_MANAGER', officerA: 'CLAIMS_OFFICER', developer: 'DEVELOPER' } as const;
  /** What PostgreSQL answers: `done`, or the code of its refusal. */
  const answer = (as: keyof typeof ROLES, work: Work, actingFor?: Delegation) =>
    test.pool
      .run({ kind: 'staff', userId: test.s[as], role: ROLES[as], delegations: [], ...(actingFor ? { actingFor } : {}) }, work)
      .then(() => 'done', databaseCode);
  const other = Buffer.from('other');
  const save =
    (name: string): Work =>
    (tx) =>
      tx.$executeRaw`SELECT app.save_secret(${randomUUID()}::uuid, ${name}::secret_name, ${other}, 'MANUAL')`;
  const renew =
    (id: string): Work =>
    (tx) =>
      tx.$executeRaw`SELECT app.renew_secret(${id}::uuid, ${other})`;
  const revoke =
    (id: string): Work =>
    (tx) =>
      tx.$queryRaw`SELECT app.revoke_secret(${id}::uuid)::text`;
  const keep =
    (id: string): Work =>
    (tx) =>
      tx.$executeRaw`SELECT app.keep_secret(${id}::uuid)`;
  const renewInternal =
    (id: string, seen: Uint8Array): Work =>
    (tx) =>
      tx.$executeRaw`SELECT app.renew_internal_key(${id}::uuid, ${other}, ${Buffer.from(seen)})`;
  const internal = async (name = 'ACCESS_CODE_KEY') =>
    (await rows<{ id: string }>("INSERT INTO vault_secrets (name, value_cipher) VALUES ($1::secret_name, '\\x00') RETURNING id", [name]))[0]!.id;

  it.each([
    ['manager', 'ADMINISTRATIVE'],
    ['manager', undefined],
    ['officerA', undefined],
    // Without saying on whose behalf.
    ['developer', undefined],
  ] as const)('refuses all of it to %s (%s)', async (as, actingFor) => {
    const [id, key] = [await saved(), await internal()];
    const before = await rows('SELECT * FROM vault_secrets ORDER BY id');
    for (const work of [save('AI_API_KEY'), renew(id), revoke(id), keep(id), renewInternal(key, Buffer.from([0]))])
      expect(await answer(as, work, actingFor)).toBe('42501');
    expect(await rows('SELECT * FROM vault_secrets ORDER BY id')).toEqual(before);
  });

  it('shows the list to the Director and to the Developer alone', async () => {
    await saved();
    const seen = async (as: keyof typeof ROLES) => {
      let found = 0;
      await answer(as, async (tx) => (found = await tx.vaultSecret.count()));
      return found;
    };
    expect([await seen('director'), await seen('developer'), await seen('manager'), await seen('officerA')]).toEqual([1, 1, 0, 0]);
  });

  it('keeps the decision for the Director, on a revocation that was asked', async () => {
    const id = await saved();
    expect(await answer('director', keep(id))).toBe('LG409');
    const decided = async () => (await rows('SELECT status, requested_by, decided_by FROM vault_secrets WHERE id = $1', [id]))[0];
    expect(await answer('developer', revoke(id), 'TECHNICAL')).toBe('done');
    expect(await decided()).toEqual({ status: 'REVOKE_PENDING', requested_by: test.s.developer, decided_by: null });
    expect(await answer('developer', keep(id), 'TECHNICAL')).toBe('42501');
    expect(await answer('director', keep(id))).toBe('done');
    expect(await decided()).toMatchObject({ status: 'VALID', decided_by: test.s.director });
    await rows('UPDATE vault_secrets SET decided_by = NULL WHERE id = $1', [id]);
    expect(await answer('director', revoke(id))).toBe('done');
    expect(await decided()).toMatchObject({ status: 'REVOKED', decided_by: test.s.director });
  });

  it('never takes an internal key for that of a service, nor the other way round', async () => {
    const [id, key] = [await saved(), await internal()];
    expect(await answer('director', save('LOOKUP_KEY'))).toBe('42501');
    for (const as of ['director', 'developer'] as const)
      for (const work of [renew(key), revoke(key), renewInternal(id, (await cipher(id))!)])
        expect(await answer(as, work, as === 'developer' ? 'TECHNICAL' : undefined)).toBe('LG409');
    // Seen otherwise than it is now.
    expect(await answer('director', renewInternal(key, other))).toBe('LG409');
    expect(await answer('director', renewInternal(key, Buffer.from([0])))).toBe('done');
  });

  it.each([
    ["INSERT INTO vault_secrets (name, value_cipher, status) VALUES ('LOOKUP_KEY', '\\x00', 'REVOKE_PENDING')", 'vault_secrets_internal'],
    ["INSERT INTO vault_secrets (name, value_cipher, status) VALUES ('AI_API_KEY', '\\x00', 'REVOKED')", 'vault_secrets_revoked'],
    ["INSERT INTO vault_secrets (name) VALUES ('AI_API_KEY')", 'vault_secrets_revoked'],
    ["INSERT INTO vault_secrets (name, value_cipher) VALUES ('AI_API_KEY', '\\x00'), ('AI_API_KEY', '\\x01')", 'vault_secrets_live'],
  ])('holds no such line: %s', async (statement, constraint) => {
    await expect(rows(statement)).rejects.toThrow(constraint);
  });
});
