import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { startMailWorker, type MailWorker } from '../../../test/worker';
import { digest, Keyring } from '../../platform/crypto/keyring';
import type { Actor } from '../../platform/database/actor';
import { databaseCode } from '../../platform/database/codes';
import { Database, type Transaction } from '../../platform/database/database';
import type { JobContext } from '../../platform/queue/jobs';
import { keysIn } from '../vault/internal-keys';
import { Vault } from '../vault/vault';
import { bindingOf } from './access-codes';
import { accessCodeJobs, reseal } from './access-codes.jobs';
import type * as codes from './codes';
import { CODE_ALPHABET, drawCode, isAccessCode, isGuessable } from './codes';

// The real draw, unless a test says what comes out of it.
vi.mock('./codes', async (original) => {
  const real = await original<typeof codes>();
  return { ...real, drawCode: vi.fn(real.drawCode) };
});

let test: TestApp;
let worker: MailWorker;
let debtor: string;
let mine: string;
let elsewhere: string;
let number = 80_000;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const newDebtor = async () =>
  (await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('INDIVIDUAL', 'Débiteur fictif', NULL) RETURNING id"))[0]!.id;
const newCreditor = async () => (await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Créancier fictif') RETURNING id"))[0]!.id;
const newCase = async (of: string, officer: string | null, closed = false) =>
  (
    await rows<{ id: string }>(
      'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, closed_on, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [`LGR-2026-${(number += 1)}`, await newCreditor(), of, officer, closed ? '2026-11-01' : null, closed ? 'SETTLED' : 'NEW'],
    )
  )[0]!.id;
const code = async (as: string, id: string) => {
  const answer = await call(as, 'GET', `/cases/${id}/access-code`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return (answer.body as { code: string }).code;
};
const versionOf = async (as: string, id: string) => ((await call(as, 'GET', `/cases/${id}/access-code`)).body as { version?: number }).version ?? 1;
const renew = async (as: string, id: string, version?: number) =>
  call(as, 'POST', `/cases/${id}/access-code/regenerate`, { version: version ?? (await versionOf(as, id)) });
const cipher = async (of: string) =>
  (await rows<{ code_cipher: Buffer }>('SELECT code_cipher FROM debtor_access_codes WHERE debtor_id = $1', [of]))[0]!.code_cipher;
const keys = async (name: 'ACCESS_CODE_KEY' | 'LOOKUP_KEY') => {
  const database = new Database(test.database.url('jobs'));
  try {
    return await database.run({ kind: 'worker', job: 'test' }, (tx) => keysIn(tx, new Vault(test.config), name));
  } finally {
    await database.close();
  }
};
const keyOf = async (name: string) =>
  (await rows<{ id: string; value_cipher: Buffer }>('SELECT id, value_cipher FROM vault_secrets WHERE name = $1', [name]))[0]!;

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
  debtor = await newDebtor();
  mine = await newCase(debtor, test.s.officerA);
  elsewhere = await newCase(debtor, test.s.officerB);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('a code', () => {
  it('has four letters without I nor O, and is none that is tried first', () => {
    for (let draw = 0; draw < 2000; draw += 1) {
      const drawn = drawCode();
      expect(isAccessCode(drawn) && !isGuessable(drawn), drawn).toBe(true);
    }
    for (const guess of ['AAAA', 'ABAB', 'ABCD', 'DCBA', 'CHAT', 'AZER', 'JURE', 'CULS', 'HJKL']) expect(isGuessable(guess), guess).toBe(true);
    for (const fine of ['KXPM', 'BRTV']) expect(isGuessable(fine), fine).toBe(false);
    for (const wrong of ['KXP', 'KXPMA', 'KXPI', 'KXPO', 'kxpm', '1234']) expect(isAccessCode(wrong), wrong).toBe(false);
    expect(CODE_ALPHABET).toHaveLength(24);
  });
  it('is drawn again when it is one of those', () => {
    const letters = [...'ABCDKXPM'].map((letter) => CODE_ALPHABET.indexOf(letter));
    expect(drawCode(() => letters.shift()!)).toBe('KXPM');
  });

  it('is one for all the cases of a debtor, and differs from one debtor to another', async () => {
    const first = await code('officerA', mine);
    expect(await code('officerA', mine)).toBe(first);
    expect(await code('officerB', elsewhere)).toBe(first);
    const another = await newDebtor();
    await code('officerA', await newCase(another, test.s.officerA));
    expect(await cipher(another)).not.toEqual(await cipher(debtor));
  });

  it('is the same for two people who ask for it first at the same time', async () => {
    const of = await newDebtor();
    const [left, right] = [await newCase(of, test.s.officerA), await newCase(of, test.s.officerB)];
    const codes = await Promise.all([code('officerA', left), code('officerB', right), code('officerA', left)]);
    expect(new Set(codes).size).toBe(1);
  });

  it('is encrypted for its debtor, and is found nowhere else', async () => {
    const shown = await code('officerA', mine);
    const [current] = await keys('ACCESS_CODE_KEY');
    const ring = new Keyring(current!);
    expect(ring.decrypt(await cipher(debtor), bindingOf(debtor)).toString()).toBe(shown);
    expect(() => ring.decrypt(new Uint8Array(), bindingOf(debtor))).toThrow();
    expect(() => ring.decrypt(Buffer.from(shown), bindingOf(debtor))).toThrow();
    const sealed = await cipher(debtor);
    expect(() => ring.decrypt(sealed, bindingOf(randomUUID()))).toThrow();
    const tables = await rows<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'");
    for (const { name } of tables) expect(JSON.stringify(await rows(`SELECT * FROM ${name} t`)), name).not.toMatch(new RegExp(`"${shown}"| ${shown} `, 'u'));
    expect(test.logs.join('')).not.toContain(`"${shown}"`);
  });

  it('leaves no trace when it is shown, is kept by no browser, and is refused to whoever may not act', async () => {
    const before = await rows('SELECT 1 FROM audit_log');
    const answer = await call('officerA', 'GET', `/cases/${mine}/access-code`);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await rows('SELECT 1 FROM audit_log')).toHaveLength(before.length);
    expect((await call('director', 'GET', `/cases/${mine}/access-code`)).status).toBe(403);
    expect((await call('officerB', 'GET', `/cases/${mine}/access-code`)).status).toBe(404);
    expect((await call('developer', 'GET', `/cases/${mine}/access-code`)).status).toBe(403);
    expect((await call('officerA', 'GET', `/cases/${randomUUID()}/access-code`)).status).toBe(404);
    // Nor in the file of the case.
    expect(JSON.stringify((await call('officerA', 'GET', `/cases/${mine}`)).body)).not.toContain(await code('officerA', mine));
  });

  it('is not given by PostgreSQL either to whoever may not act on the case', async () => {
    const database = new Database(test.database.url('app'));
    const asStaff = (userId: string, role: 'DIRECTOR' | 'CLAIMS_OFFICER') => ({ kind: 'staff', userId, role, delegations: [] }) as const;
    try {
      const read = (userId: string, role: 'DIRECTOR' | 'CLAIMS_OFFICER') =>
        database.run(asStaff(userId, role), (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app.access_code(${mine}::uuid)`);
      expect(await read(test.s.officerA, 'CLAIMS_OFFICER')).toHaveLength(1);
      expect(await read(test.s.officerB, 'CLAIMS_OFFICER')).toEqual([]);
      expect(await read(test.s.director, 'DIRECTOR')).toEqual([]);
      const seen = await cipher(debtor);
      for (const statement of [
        (tx: Parameters<Parameters<typeof database.run>[1]>[0]) =>
          tx.$queryRaw`SELECT app.renew_access_code(${mine}::uuid, 1, ${seen}, ${seen}, ARRAY[]::bytea[])`,
        (tx: Parameters<Parameters<typeof database.run>[1]>[0]) => tx.$queryRaw`SELECT app.first_access_code(${mine}::uuid, ${seen})::text`,
      ])
        await expect(database.run(asStaff(test.s.officerB, 'CLAIMS_OFFICER'), statement)).rejects.toThrow(/42501|refused/u);
    } finally {
      await database.close();
    }
  });
});

describe('a closed case', () => {
  it('shows the code of the debtor read only, never another one (question 140)', async () => {
    const closed = await newCase(debtor, test.s.officerB, true);
    const shown = await call('officerB', 'GET', `/cases/${closed}/access-code`);
    expect(shown).toMatchObject({ status: 200, body: { code: await code('officerA', mine), closed: true } });
    expect(await renew('officerB', closed)).toMatchObject({ status: 409, body: { code: 'CASE_CLOSED' } });
    // To whoever acts on it alone, as an open case.
    expect((await call('officerA', 'GET', `/cases/${closed}/access-code`)).status).toBe(404);
    expect((await call('director', 'GET', `/cases/${closed}/access-code`)).status).toBe(403);
    // Never from a forgotten case, though the debtor still has open ones.
    const forgotten = await newCase(debtor, test.s.officerB, true);
    await rows('UPDATE cases SET anonymized_at = now() WHERE id = $1', [forgotten]);
    expect((await call('officerB', 'GET', `/cases/${forgotten}/access-code`)).body).toEqual({ code: null, version: 0, closed: true });
    const database = new Database(test.database.url('app'));
    const officer = { kind: 'staff', userId: test.s.officerB, role: 'CLAIMS_OFFICER', delegations: [] } as const;
    try {
      expect(await database.run(officer, (tx) => tx.$queryRaw<unknown[]>`SELECT debtor_id FROM app.access_code(${closed}::uuid)`)).toHaveLength(1);
      for (const statement of ['renew', 'first'])
        await expect(
          database.run(officer, (tx) =>
            statement === 'first'
              ? tx.$queryRaw`SELECT app.first_access_code(${closed}::uuid, ${Buffer.from('x')})::text`
              : tx.$queryRaw`SELECT app.renew_access_code(${closed}::uuid, 1, ${Buffer.from('x')}, ${Buffer.from('y')}, ARRAY[]::bytea[])`,
          ),
        ).rejects.toThrow(/42501|refused/u);
    } finally {
      await database.close();
    }
  });
});

describe('a renewal', () => {
  it('replaces the code of all the cases, tells the open ones, and leaves a trace without it', async () => {
    const closed = await newCase(debtor, test.s.officerB, true);
    const old = await code('officerA', mine);
    expect((await renew('officerA', mine)).status).toBe(204);
    const fresh = await code('officerA', mine);
    expect(fresh).not.toBe(old);
    expect(await code('officerB', elsewhere)).toBe(fresh);
    const told = async (id: string) => (await rows("SELECT 1 FROM case_events WHERE case_id = $1 AND kind = 'ACCESS_CODE_RENEWED'", [id])).length;
    expect([await told(mine), await told(elsewhere), await told(closed)]).toEqual([1, 1, 0]);
    expect(await rows("SELECT params FROM audit_log WHERE action = 'ACCESS_CODE_RENEWED' AND entity_id = $1", [mine])).toEqual([{ params: {} }]);
    const [retired] = await rows<{ code_hmac: Buffer }>('SELECT code_hmac FROM debtor_retired_codes WHERE debtor_id = $1', [debtor]);
    expect(retired!.code_hmac).toEqual(digest((await keys('LOOKUP_KEY'))[0]!, `access-code:${debtor}:${old}`));
  });

  it('never gives back a former code, even under a former key', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    const seen = new Set([await code('officerA', id)]);
    for (let turn = 0; turn < 5; turn += 1) {
      await renew('officerA', id);
      seen.add(await code('officerA', id));
    }
    expect(seen.size).toBe(6);
    const database = new Database(test.database.url('app'));
    try {
      const again = async (key: Buffer, used: string) =>
        database.run(
          { kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] },
          async (tx) =>
            (
              await tx.$queryRaw<
                { done: boolean }[]
              >`SELECT app.renew_access_code(${id}::uuid, ${await versionOf('officerA', id)}::int, ${Buffer.from('x')}, ${Buffer.from('y')},
                ARRAY[${digest(key, `access-code:${of}:${used}`)}]::bytea[]) AS done`
            )[0]!.done,
        );
      const [first] = [...seen];
      expect(await again((await keys('LOOKUP_KEY'))[0]!, first!)).toBe(false);
    } finally {
      await database.close();
    }
  });

  it('asked twice at the same time happens once, or one after the other, and never loses a code', async () => {
    const answers = await Promise.all([renew('officerA', mine), renew('officerB', elsewhere)]);
    expect(answers.every(({ status }) => status === 204 || status === 409)).toBe(true);
    expect(answers.some(({ status }) => status === 204)).toBe(true);
    expect(await code('officerA', mine)).toBe(await code('officerB', elsewhere));
  });

  it('is refused to whoever may not act', async () => {
    expect((await renew('director', mine)).status).toBe(403);
    expect((await renew('officerB', mine)).status).toBe(404);
  });

  it('replaces the code that was on the screen, not the one that a colleague has just given', async () => {
    const shown = await versionOf('officerA', mine);
    expect((await renew('officerB', elsewhere)).status).toBe(204);
    const given = await code('officerB', elsewhere);
    expect(await renew('officerA', mine, shown)).toMatchObject({ status: 409, body: { code: 'CHANGED' } });
    expect(await code('officerA', mine)).toBe(given);
  });

  it('does not tell whoever follows another case who did it', async () => {
    const of = await newDebtor();
    const [left, right] = [await newCase(of, test.s.officerA), await newCase(of, test.s.officerB)];
    await renew('officerA', left);
    const actors = (id: string) => rows("SELECT actor_kind, actor_id, actor_label FROM case_events WHERE case_id = $1 AND kind = 'ACCESS_CODE_RENEWED'", [id]);
    expect(await actors(right)).toEqual([{ actor_kind: 'SYSTEM', actor_id: null, actor_label: 'Legarec' }]);
    expect(await actors(left)).toMatchObject([{ actor_kind: 'STAFF', actor_id: test.s.officerA }]);
  });
});

describe('an internal key', () => {
  it('is renewed without a value, by the Director or their delegate, and the codes follow', async () => {
    const before = await code('officerA', mine);
    const { id, value_cipher: old } = await keyOf('ACCESS_CODE_KEY');
    expect((await call('director', 'POST', `/secrets/${id}/rotate`, { value: 'valeur-fictive' })).status).toBe(422);
    expect((await call('manager', 'POST', `/secrets/${id}/rotate`, {})).status).toBe(403);
    expect((await call('developer', 'POST', `/secrets/${id}/rotate`, {})).status).toBe(204);
    expect((await keyOf('ACCESS_CODE_KEY')).value_cipher).not.toEqual(old);
    const [, previous] = await keys('ACCESS_CODE_KEY');
    // Still read with the former key, until they are encrypted again.
    expect(new Keyring(previous!).isOutdated(await cipher(debtor))).toBe(false);
    expect(await code('officerA', mine)).toBe(before);
    await worker.run();
    const [current] = await keys('ACCESS_CODE_KEY');
    for (const { debtor_id, code_cipher } of await rows<{ debtor_id: string; code_cipher: Buffer }>('SELECT debtor_id, code_cipher FROM debtor_access_codes'))
      expect(isAccessCode(new Keyring(current!).decrypt(code_cipher, bindingOf(debtor_id)).toString())).toBe(true);
    expect(await code('officerA', mine)).toBe(before);
    expect(await rows("SELECT failure FROM outbox WHERE name = 'reseal-access-codes' AND done_at IS NULL")).toEqual([]);
  });

  it('keeps the former codes retired when that of the digests is renewed', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    const old = await code('officerA', id);
    await renew('officerA', id);
    const { id: lookup } = await keyOf('LOOKUP_KEY');
    expect((await call('director', 'POST', `/secrets/${lookup}/rotate`, {})).status).toBe(204);
    const [current, previous] = await keys('LOOKUP_KEY');
    const retired = (await rows<{ code_hmac: Buffer }>('SELECT code_hmac FROM debtor_retired_codes WHERE debtor_id = $1', [of]))[0]!.code_hmac;
    expect(retired).not.toEqual(digest(current!, `access-code:${of}:${old}`));
    expect(retired).toEqual(digest(previous!, `access-code:${of}:${old}`));
  });

  it('is drawn once, is never revoked, and is never read by the team', async () => {
    const { id } = await keyOf('ACCESS_CODE_KEY');
    for (const then of ['revoke', 'keep']) expect((await call('director', 'POST', `/secrets/${id}/${then}`)).status).toBe(404);
    expect(await rows("SELECT name FROM vault_secrets WHERE name IN ('ACCESS_CODE_KEY', 'LOOKUP_KEY')")).toHaveLength(2);
    const listed = JSON.stringify((await call('director', 'GET', '/secrets')).body);
    for (const key of await keys('ACCESS_CODE_KEY')) expect(listed).not.toContain(key.toString('base64'));
    const database = new Database(test.database.url('app'));
    const director = { kind: 'staff', userId: test.s.director, role: 'DIRECTOR', delegations: [] } as const;
    try {
      // A key of a service is not read that way.
      await rows("INSERT INTO vault_secrets (name, value_cipher) VALUES ('RESEND_API_KEY', '\\x00')");
      expect(await database.run(director, (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app.internal_key('RESEND_API_KEY')`)).toEqual([]);
      await expect(
        database.run(director, (tx) => tx.$queryRaw`SELECT app.first_internal_key(${randomUUID()}::uuid, 'AI_API_KEY', ${Buffer.from('x')})::text`),
      ).rejects.toThrow(/42501|refused/u);
    } finally {
      await database.close();
    }
  });

  it('of the digests is kept for good, however often it is renewed: no former code comes back', async () => {
    const { id } = await keyOf('LOOKUP_KEY');
    const [first] = await keys('LOOKUP_KEY');
    for (let turn = 0; turn < 6; turn += 1) expect((await call('director', 'POST', `/secrets/${id}/rotate`, {})).status).toBe(204);
    expect(await keys('LOOKUP_KEY')).toContainEqual(first);
  });

  it('of the codes loses none, however often it is renewed before they are encrypted again', async () => {
    const before = await code('officerA', mine);
    const { id } = await keyOf('ACCESS_CODE_KEY');
    for (let turn = 0; turn < 7; turn += 1) expect((await call('director', 'POST', `/secrets/${id}/rotate`, {})).status).toBe(204);
    expect(await code('officerA', mine)).toBe(before);
    await worker.run();
    expect(await code('officerA', mine)).toBe(before);
    expect(new Keyring((await keys('ACCESS_CODE_KEY'))[0]!).isOutdated(await cipher(debtor))).toBe(false);
  });

  it('that no longer opens a code prevents nothing: another code is drawn, cases are opened, the key is renewed', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    await code('officerA', id);
    const broken = Buffer.from(await cipher(of));
    broken[broken.length - 1]! ^= 1;
    await rows('UPDATE debtor_access_codes SET code_cipher = $2 WHERE debtor_id = $1', [of, broken]);
    expect((await call('officerA', 'GET', `/cases/${id}/access-code`)).body).toEqual({ code: null, version: 1, closed: false });
    const { id: key } = await keyOf('ACCESS_CODE_KEY');
    expect((await call('director', 'POST', `/secrets/${key}/rotate`, {})).status).toBe(204);
    expect((await renew('officerA', id)).status).toBe(204);
    expect(isAccessCode(await code('officerA', id))).toBe(true);
    expect(await rows('SELECT 1 FROM debtor_retired_codes WHERE debtor_id = $1', [of])).toEqual([]);
    expect(test.logs.join('')).toContain('access code unreadable');
  });

  it('leaves what it cannot read, and encrypts the rest again', async () => {
    const of = await newDebtor();
    await code('officerA', await newCase(of, test.s.officerA));
    const broken = Buffer.from(await cipher(of));
    broken[broken.length - 1]! ^= 1;
    await rows('UPDATE debtor_access_codes SET code_cipher = $2 WHERE debtor_id = $1', [of, broken]);
    const { id } = await keyOf('ACCESS_CODE_KEY');
    expect((await call('director', 'POST', `/secrets/${id}/rotate`, {})).status).toBe(204);
    const database = new Database(test.database.url('jobs'));
    try {
      const counts = await reseal((work) => database.run({ kind: 'worker', job: 'reseal' }, work), new Vault(test.config));
      expect(counts.unreadable).toBe(1);
      expect(counts.resealed).toBeGreaterThan(0);
    } finally {
      await database.close();
    }
    expect(await cipher(of)).toEqual(broken);
    expect(new Keyring((await keys('ACCESS_CODE_KEY'))[0]!).isOutdated(await cipher(debtor))).toBe(false);
    await rows('DELETE FROM debtor_access_codes WHERE debtor_id = $1', [of]);
  });

  it('of the mailboxes is neither drawn by an officer nor renewed before the mailboxes', async () => {
    const database = new Database(test.database.url('app'));
    try {
      const draw = (role: 'CLAIMS_OFFICER' | 'DIRECTOR', userId: string) =>
        database.run(
          { kind: 'staff', userId, role, delegations: [] },
          (tx) => tx.$queryRaw`SELECT app.first_internal_key(${randomUUID()}::uuid, 'MAILBOX_SECRETS_KEY', ${Buffer.from('x')})::text`,
        );
      await expect(draw('CLAIMS_OFFICER', test.s.officerA)).rejects.toThrow(/42501|refused/u);
      // Whom nobody knows reads no key.
      expect(
        await database.run(
          { kind: 'staff', userId: randomUUID(), role: 'DIRECTOR', delegations: [] },
          (tx) => tx.$queryRaw<unknown[]>`SELECT * FROM app.internal_key('LOOKUP_KEY')`,
        ),
      ).toEqual([]);
      await draw('DIRECTOR', test.s.director);
    } finally {
      await database.close();
    }
    const { id } = await keyOf('MAILBOX_SECRETS_KEY');
    expect(await call('director', 'POST', `/secrets/${id}/rotate`, {})).toMatchObject({ status: 409 });
  });
});

describe('PostgreSQL itself', () => {
  type Work = (tx: Transaction) => Promise<unknown>;
  const answer = (userId: string, work: Work) =>
    test.pool.run({ kind: 'staff', userId, role: 'CLAIMS_OFFICER', delegations: [] }, work).catch((error: unknown) => databaseCode(error) ?? String(error));

  it('replaces the code that was seen, and no other', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    await code('officerA', id);
    const before = await cipher(of);
    const renewed =
      (seen: number): Work =>
      (tx) =>
        tx.$queryRaw`SELECT app.renew_access_code(${id}::uuid, ${seen}::int, ${Buffer.from('old')}, ${Buffer.from('new')}, ARRAY[]::bytea[]) AS done`;
    expect(await answer(test.s.officerA, renewed(2))).toBe('LG409');
    expect(await cipher(of)).toEqual(before);
    expect(await rows('SELECT 1 FROM debtor_retired_codes WHERE debtor_id = $1', [of])).toEqual([]);
    expect(await answer(test.s.officerA, renewed(1))).toEqual([{ done: true }]);
    await rows('DELETE FROM debtor_access_codes WHERE debtor_id = $1', [of]);
  });

  it('keeps the first code and the first key that are drawn', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    await code('officerA', id);
    const before = await cipher(of);
    expect(await answer(test.s.officerA, (tx) => tx.$executeRaw`SELECT app.first_access_code(${id}::uuid, ${Buffer.from('x')})`)).toBe(1);
    expect(await cipher(of)).toEqual(before);
    const key = await keyOf('ACCESS_CODE_KEY');
    const draw: Work = (tx) => tx.$executeRaw`SELECT app.first_internal_key(${randomUUID()}::uuid, 'ACCESS_CODE_KEY', ${Buffer.from('x')})`;
    expect(await answer(test.s.officerA, draw)).toBe(1);
    expect(await keyOf('ACCESS_CODE_KEY')).toEqual(key);
  });
});

describe('who drew the code', () => {
  it('is kept with it, and replaced with it', async () => {
    const of = await newDebtor();
    const [left, right] = [await newCase(of, test.s.officerA), await newCase(of, test.s.officerB)];
    const by = async () => (await rows<{ generated_by: string }>('SELECT generated_by FROM debtor_access_codes WHERE debtor_id = $1', [of]))[0]!.generated_by;
    await code('officerA', left);
    expect(await by()).toBe(test.s.officerA);
    await renew('officerB', right);
    expect(await by()).toBe(test.s.officerB);
  });
});

describe('a draw', () => {
  it('is made again when it falls on the code of now, or on a former one, whatever the key of its digest', async () => {
    const of = await newDebtor();
    const id = await newCase(of, test.s.officerA);
    vi.mocked(drawCode).mockReturnValueOnce('KXPM').mockReturnValueOnce('KXPM').mockReturnValueOnce('BRTV');
    expect(await code('officerA', id)).toBe('KXPM');
    expect((await renew('officerA', id)).status).toBe(204);
    expect(await code('officerA', id)).toBe('BRTV');
    const { id: lookup } = await keyOf('LOOKUP_KEY');
    expect((await call('director', 'POST', `/secrets/${lookup}/rotate`, {})).status).toBe(204);
    vi.mocked(drawCode).mockReturnValueOnce('KXPM').mockReturnValueOnce('QZWK');
    expect((await renew('officerA', id)).status).toBe(204);
    expect(await code('officerA', id)).toBe('QZWK');
    expect(await rows('SELECT 1 FROM debtor_retired_codes WHERE debtor_id = $1', [of])).toHaveLength(2);
  });

  it('is not made for ever', async () => {
    const id = await newCase(await newDebtor(), test.s.officerA);
    const now = await code('officerA', id);
    for (let draw = 0; draw < 20; draw += 1) vi.mocked(drawCode).mockReturnValueOnce(now);
    expect((await renew('officerA', id)).status).toBe(409);
    expect(await code('officerA', id)).toBe(now);
  });

  it('is digested for its debtor: the same code of two debtors leaves two digests', async () => {
    const digests = [];
    for (let index = 0; index < 2; index += 1) {
      const of = await newDebtor();
      const id = await newCase(of, test.s.officerA);
      vi.mocked(drawCode).mockReturnValueOnce('KXPM');
      await code('officerA', id);
      await renew('officerA', id);
      digests.push((await rows<{ code_hmac: Buffer }>('SELECT code_hmac FROM debtor_retired_codes WHERE debtor_id = $1', [of]))[0]!.code_hmac.toString('hex'));
    }
    expect(new Set(digests).size).toBe(2);
  });
});

describe('the task that encrypts the codes again', () => {
  const rotate = async () => expect((await call('director', 'POST', `/secrets/${(await keyOf('ACCESS_CODE_KEY')).id}/rotate`, {})).status).toBe(204);
  const outdated = async () => {
    const [current] = await keys('ACCESS_CODE_KEY');
    const ring = new Keyring(current!);
    return (await rows<{ code_cipher: Buffer }>('SELECT code_cipher FROM debtor_access_codes')).filter((row) => ring.isOutdated(row.code_cipher)).length;
  };

  it('goes through all of them, however many there are', async () => {
    const [current] = await keys('ACCESS_CODE_KEY');
    const ring = new Keyring(current!);
    await rows("INSERT INTO debtors (kind, name) SELECT 'INDIVIDUAL', 'Débiteur fictif' FROM generate_series(1, 405)");
    const without = await rows<{ id: string }>('SELECT id FROM debtors d WHERE NOT EXISTS (SELECT 1 FROM debtor_access_codes a WHERE a.debtor_id = d.id)');
    for (const { id } of without)
      await rows('INSERT INTO debtor_access_codes (debtor_id, code_cipher) VALUES ($1, $2)', [id, ring.encrypt('KXPM', bindingOf(id))]);
    await rotate();
    expect(await outdated()).toBeGreaterThan(400);
    await worker.run();
    expect(await outdated()).toBe(0);
  });

  it('is refused to whoever may not renew the key', async () => {
    const ask = async (actor: Actor, code: string) => {
      await test.pool.run(actor, (tx) => tx.$queryRaw`SELECT app.enqueue('maintenance', 'reseal-access-codes', '{}'::jsonb, NULL, NULL)`);
      await worker.run();
      expect((await rows("SELECT failure FROM outbox WHERE name = 'reseal-access-codes' ORDER BY created_at DESC, id DESC LIMIT 1"))[0]).toEqual({
        failure: code,
      });
    };
    await rotate();
    await rows("UPDATE outbox SET done_at = now() WHERE name = 'reseal-access-codes' AND done_at IS NULL");
    const before = await outdated();
    await ask({ kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] }, 'NOT_ALLOWED');
    await ask({ kind: 'partner', userId: test.s.partnerA, creditorId: test.s.creditorA }, 'AUTHOR_REFUSED');
    await ask({ kind: 'debtor', debtorId: test.s.debtorA }, 'AUTHOR_REFUSED');
    expect(await outdated()).toBe(before);
  });

  it('leaves the code that was renewed while it was read', async () => {
    const database = new Database(test.database.url('jobs'));
    const of = await newDebtor();
    await code('officerA', await newCase(of, test.s.officerA));
    const fresh = Buffer.from('renewed meanwhile');
    try {
      await rotate();
      const { 'reseal-access-codes': task } = accessCodeJobs(new Vault(test.config));
      const authorize: JobContext['authorize'] = async () => (work) =>
        database.run({ kind: 'worker', job: 'test' }, (tx) => {
          const debtorAccessCode = {
            findMany: async (query: never) => {
              const found = await tx.debtorAccessCode.findMany(query);
              if (found.some(({ debtorId }) => debtorId === of))
                await rows('UPDATE debtor_access_codes SET code_cipher = $2 WHERE debtor_id = $1', [of, fresh]);
              return found;
            },
            updateMany: (query: never) => tx.debtorAccessCode.updateMany(query),
          };
          return work(new Proxy(tx, { get: (target, name) => (name === 'debtorAccessCode' ? debtorAccessCode : Reflect.get(target, name)) }));
        });
      await task!.run({ authorize } as JobContext);
      expect(await cipher(of)).toEqual(fresh);
    } finally {
      await database.close();
    }
  });
});
