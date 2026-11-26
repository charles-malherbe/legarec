import { debtorCase, debtorSession } from '@legarec/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { Database } from '../../platform/database/database';
import { AuthKeys } from '../auth/keys';

let test: TestApp;
/** The same database, for the team: its callers named by the header of the tests. */
let staff: TestApp;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
/** Each test from a network of its own: the limit by network is tested on its own. */
let network = '';
const access = (value: string, code: string, kind: 'SIREN' | 'REFERENCE' = 'SIREN', remember = false) =>
  test.call('POST', '/debtor/access', { body: { identifier: { kind, value }, code, remember }, headers: { 'x-forwarded-for': network } });
const cookieOf = (answer: { headers: Headers }) => /__Host-debtor=([^;]+)/u.exec(answer.headers.get('set-cookie') ?? '')?.[1];
const asDebtor = (cookie: string, path: string) =>
  test.call('GET', `/debtor${path}`, { headers: { cookie: `__Host-debtor=${cookie}`, 'x-forwarded-for': network } });
let reference = 95_000;
const siren = (): string => {
  for (;;) {
    reference += 1;
    const digits = String(700_000_000 + reference);
    const sum = [...digits].reverse().reduce((total, char, index) => {
      const value = Number(char) * (index % 2 === 1 ? 2 : 1);
      return total + (value > 9 ? value - 9 : value);
    }, 0);
    if (sum % 10 === 0) return digits;
  }
};
/** A company with a case announced, held by the manager; its code drawn as a colleague shows it. */
const debtorWithCode = async (kind: 'COMPANY' | 'INDIVIDUAL' = 'COMPANY', announced = true) => {
  const number = kind === 'COMPANY' ? siren() : null;
  const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Matériaux Delta') RETURNING id");
  const [debtor] = await rows<{ id: string }>('INSERT INTO debtors (kind, name, siren) VALUES ($1, $2, $3) RETURNING id', [
    kind,
    `Débiteur ${reference}`,
    number,
  ]);
  reference += 1;
  const ref = `LGR-2026-${String(reference).padStart(5, '0')}`;
  const [made] = await rows<{ id: string }>(
    'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, first_letter_reference, first_letter_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [ref, creditor!.id, debtor!.id, test.s.officerA, announced ? 'LR-2026-0001' : null, announced ? '2026-11-02' : null],
  );
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents) VALUES ($1, $2, 'F-1', '2026-09-01', '2026-10-01', 120000, 120000)",
    [made!.id, creditor!.id],
  );
  const shown = await staff.call('GET', `/staff/cases/${made!.id}/access-code`, { as: 'officerA' });
  const { code, version } = shown.body as { code: string; version: number };
  return { caseId: made!.id, siren: number, reference: ref, code, version, debtorId: debtor!.id };
};
const wrong = (code: string) => (code === 'ABCD' ? 'ABCE' : 'ABCD');

beforeAll(async () => {
  test = await startApp([], { sessions: true });
  // The same keys: what one seals, the other opens.
  staff = await startApp([], { next: test, env: { VAULT_MASTER_KEY: test.config.VAULT_MASTER_KEY, SESSION_SIGNING_KEY: test.config.SESSION_SIGNING_KEY } });
});
afterAll(async () => {
  await staff.stop();
  await test.stop();
});

describe('the access of a debtor', () => {
  it('opens with the right code, and shows their cases only', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, caseId } = await debtorWithCode();
    const answer = await access(value!, code.toLowerCase());
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const session = debtorSession.parse(answer.body);
    expect(session.cases).toHaveLength(1);
    expect(session.cases[0]).toMatchObject({ id: caseId, creditor: 'Matériaux Delta', balance: expect.any(Number) as number });
    const cookie = cookieOf(answer)!;
    expect(answer.headers.get('set-cookie')).not.toMatch(/Max-Age/u);
    expect(debtorSession.parse((await asDebtor(cookie, '/session')).body).cases[0]?.id).toBe(caseId);
    const detail = debtorCase.parse((await asDebtor(cookie, `/cases/${caseId}`)).body);
    expect(detail).toMatchObject({ principal: 120_000, invoices: [{ number: 'F-1', amount: 120_000 }], plan: null });
    // Someone else's case does not exist.
    expect((await asDebtor(cookie, `/cases/${test.s.cases.ofA}`)).status).toBe(404);
    // Closed: the cookie opens nothing more.
    await test.call('POST', '/debtor/logout', { headers: { cookie: `__Host-debtor=${cookie}`, origin: 'http://localhost:5175' } });
    expect((await asDebtor(cookie, '/session')).status).toBe(401);
  });

  it('answers the same to an unknown identifier and to a wrong code', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const unknown = await access(siren(), 'ABCD');
    const mistaken = await access(value!, wrong(code));
    expect([unknown.status, unknown.body]).toEqual([401, { code: 'INVALID', attemptsLeft: 4 }]);
    expect([mistaken.status, mistaken.body]).toEqual([401, { code: 'INVALID', attemptsLeft: 4 }]);
  });

  it('never opens a case not announced yet, nor a company by the reference of its case', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const silent = await debtorWithCode('COMPANY', false);
    expect((await access(silent.siren!, silent.code)).status).toBe(401);
    const company = await debtorWithCode();
    expect((await access(company.reference, company.code, 'REFERENCE')).status).toBe(401);
    const person = await debtorWithCode('INDIVIDUAL');
    expect((await access(person.reference, person.code, 'REFERENCE')).status).toBe(200);
  });

  it('five wrong codes lock it 15 minutes, ten block it, the right one too, until a colleague renews the code', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, caseId, version, debtorId } = await debtorWithCode();
    const opened = cookieOf(await access(value!, code))!;
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await access(value!, wrong(code))).body).toEqual({ code: 'INVALID', attemptsLeft: 5 - attempt });
    expect(await access(value!, wrong(code))).toMatchObject({ status: 423, body: { code: 'LOCKED', minutes: 15 } });
    expect(await access(value!, code)).toMatchObject({ status: 423, body: { code: 'LOCKED' } });
    // Fifteen minutes later.
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 second' WHERE debtor_id = $1", [debtorId]);
    for (let attempt = 6; attempt <= 9; attempt += 1) expect((await access(value!, wrong(code))).body).toEqual({ code: 'INVALID', attemptsLeft: 10 - attempt });
    expect(await access(value!, wrong(code))).toMatchObject({ status: 423, body: { code: 'BLOCKED' } });
    expect(await access(value!, code)).toMatchObject({ status: 423, body: { code: 'BLOCKED' } });
    // Told to the officer, in the history of the case.
    expect(
      await rows("SELECT kind FROM notifications WHERE user_id = $1 AND kind = 'DEBTOR_BLOCKED' AND case_id = $2", [test.s.officerA, caseId]),
    ).toHaveLength(1);
    expect(await rows("SELECT kind FROM case_events WHERE case_id = $1 AND kind = 'DEBTOR_ACCESS_BLOCKED'", [caseId])).toHaveLength(1);
    const renewed = await staff.call('POST', `/staff/cases/${caseId}/access-code/regenerate`, {
      as: 'officerA',
      body: { version },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(renewed.status).toBe(204);
    // The old session is closed, the old code opens nothing, the new one does.
    expect((await asDebtor(opened, '/session')).status).toBe(401);
    expect((await access(value!, code)).status).toBe(401);
    const { code: next } = (await staff.call('GET', `/staff/cases/${caseId}/access-code`, { as: 'officerA' })).body as { code: string };
    expect((await access(value!, next)).status).toBe(200);
  });

  it('keeps the cookie 30 days when asked, never more than the session', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const answer = await access(value!, code, 'SIREN', true);
    expect(answer.headers.get('set-cookie')).toMatch(/Max-Age=2592000/u);
    expect(await rows("SELECT persistent, expires_at < now() + interval '13 hours' AS short FROM debtor_sessions ORDER BY created_at DESC LIMIT 1")).toEqual([
      { persistent: true, short: true },
    ]);
  });

  it('refuses beyond twenty tries an hour from one network', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    for (let attempt = 0; attempt < 20; attempt += 1) await access(siren(), 'ABCD');
    expect(await access(siren(), 'ABCD')).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
  });

  it('a session idle for 30 minutes opens nothing more', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code } = await debtorWithCode();
    const cookie = cookieOf(await access(value!, code))!;
    await rows("UPDATE debtor_sessions SET last_seen_at = now() - interval '31 minutes'");
    expect((await asDebtor(cookie, '/session')).status).toBe(401);
  });
});

describe('the messages of the space of the debtor', () => {
  const post = (cookie: string, path: string, body?: unknown, file?: Uint8Array) =>
    test.call('POST', `/debtor${path}`, {
      body,
      file,
      headers: { cookie: `__Host-debtor=${cookie}`, 'x-forwarded-for': network, ...(file ? { 'content-type': 'application/pdf' } : {}) },
    });
  const signedIn = async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const found = await debtorWithCode();
    return { ...found, cookie: cookieOf(await access(found.siren!, found.code))! };
  };
  const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

  it('never keeps the access code of the debtor, however it is written', async () => {
    const { cookie, caseId, code } = await signedIn();
    const spaced = [...code].join(' ').toLowerCase();
    expect(
      (await post(cookie, `/cases/${caseId}/messages`, { text: `Mon code est ${code}, ou ${spaced}. Merci.`, attachmentKind: 'OTHER', attachments: [] }))
        .status,
    ).toBe(204);
    const [kept] = await rows<{ text: string }>('SELECT text FROM portal_messages WHERE case_id = $1', [caseId]);
    expect(kept!.text).toBe('Mon code est ••••, ou ••••. Merci.');
    expect(kept!.text.toUpperCase()).not.toContain(code);
  });

  it('a dispute puts the case in dispute, and the team answers; the debtor sees what is unread', async () => {
    const { cookie, caseId } = await signedIn();
    const dispute = await post(cookie, `/cases/${caseId}/requests`, {
      kind: 'DISPUTE',
      reason: 'Le montant est erroné',
      text: 'La facture F-1 a été annulée.',
      attachments: [],
    });
    expect(dispute.status).toBe(204);
    expect(await rows('SELECT status FROM cases WHERE id = $1', [caseId])).toEqual([{ status: 'DISPUTE' }]);
    const answer = await staff.call('POST', `/staff/cases/${caseId}/portal-messages`, {
      as: 'officerA',
      body: { text: 'Nous vérifions auprès du créancier.' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(answer.status).toBe(204);
    expect(debtorCase.parse((await asDebtor(cookie, `/cases/${caseId}`)).body)).toMatchObject({ unread: 1, lastMessage: { who: 'Legarec' } });
    expect((await post(cookie, `/cases/${caseId}/messages/read`)).status).toBe(204);
    expect(debtorCase.parse((await asDebtor(cookie, `/cases/${caseId}`)).body).unread).toBe(0);
    const seen = (await staff.call('GET', `/staff/cases/${caseId}`, { as: 'officerA' })).body as { exchanges: { channel: string }[] };
    expect(seen.exchanges.map((item) => item.channel)).toEqual(['PORTAL_OUT', 'PORTAL_IN']);
  });

  it('a file of the debtor waits unseen by the team, then goes with their message, for that case only', async () => {
    const { cookie, caseId } = await signedIn();
    const sent = await post(cookie, '/attachments', undefined, PDF);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const { id } = sent.body as { id: string };
    expect(((await staff.call('GET', '/staff/documents', { as: 'manager' })).body as { items: { id: string }[] }).items.some((item) => item.id === id)).toBe(
      false,
    );
    // Someone else cannot take it.
    const other = await signedIn();
    expect(
      (await post(other.cookie, `/cases/${other.caseId}/messages`, { text: 'Pièce', attachmentKind: 'OTHER', attachments: [{ id, name: 'x.pdf' }] })).status,
    ).toBe(409);
    expect(
      (
        await post(cookie, `/cases/${caseId}/messages`, {
          text: 'Voici le justificatif.',
          attachmentKind: 'TRANSFER_PROOF',
          attachments: [{ id, name: 'x.pdf' }],
        })
      ).status,
    ).toBe(204);
    expect(await rows('SELECT case_id, source FROM documents WHERE id = $1', [id])).toEqual([{ case_id: caseId, source: 'DEBTOR' }]);
    const listed = (await asDebtor(cookie, `/cases/${caseId}/messages`)).body as { items: { attachments: { id: string }[] }[] };
    expect(listed.items[0]?.attachments.map((item) => item.id)).toEqual([id]);
    expect((await post(cookie, '/attachments', undefined, new TextEncoder().encode('MZ programme'))).status).toBe(415);
  });
});

describe('what the review of the access found', () => {
  it('a right tenth try opens, and leaves nothing blocked', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, debtorId } = await debtorWithCode();
    for (let attempt = 1; attempt <= 4; attempt += 1) await access(value!, wrong(code));
    await access(value!, wrong(code));
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 second' WHERE debtor_id = $1", [debtorId]);
    for (let attempt = 6; attempt <= 9; attempt += 1) await access(value!, wrong(code));
    expect((await access(value!, code)).status).toBe(200);
    expect(await rows('SELECT 1 FROM lockouts WHERE debtor_id = $1', [debtorId])).toEqual([]);
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'DEBTOR_SIGNED_IN'")).not.toHaveLength(0);
  });

  it('failures spread over days still block at ten', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { siren: value, code, debtorId } = await debtorWithCode();
    for (let attempt = 1; attempt <= 5; attempt += 1) await access(value!, wrong(code));
    await rows("UPDATE lockouts SET locked_until = NULL, last_failure_at = now() - interval '3 days' WHERE debtor_id = $1", [debtorId]);
    expect((await access(value!, wrong(code))).body).toEqual({ code: 'INVALID', attemptsLeft: 4 });
  });

  it('a block made before the first letter is lifted by a new code, and told to the manager when nobody holds the case', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const found = await debtorWithCode('COMPANY', false);
    await rows('UPDATE cases SET officer_id = NULL WHERE id = $1', [found.caseId]);
    for (let attempt = 1; attempt <= 5; attempt += 1) await access(found.siren!, wrong(found.code));
    await rows("UPDATE lockouts SET locked_until = now() - interval '1 second' WHERE debtor_id = $1", [found.debtorId]);
    for (let attempt = 6; attempt <= 10; attempt += 1) await access(found.siren!, wrong(found.code));
    expect(await rows("SELECT user_id FROM notifications WHERE kind = 'DEBTOR_BLOCKED' AND case_id = $1", [found.caseId])).toEqual([
      { user_id: test.s.manager },
    ]);
    await rows("UPDATE cases SET first_letter_reference = 'LR-2026-0002', first_letter_on = '2026-11-03', officer_id = $2 WHERE id = $1", [
      found.caseId,
      test.s.officerA,
    ]);
    expect((await access(found.siren!, found.code)).body).toEqual({ code: 'BLOCKED' });
    const renewed = await staff.call('POST', `/staff/cases/${found.caseId}/access-code/regenerate`, {
      as: 'officerA',
      body: { version: found.version },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(renewed.status).toBe(204);
    const { code: next } = (await staff.call('GET', `/staff/cases/${found.caseId}/access-code`, { as: 'officerA' })).body as { code: string };
    expect((await access(found.siren!, next)).status).toBe(200);
  });
});

describe('the counter of a debtor, whatever the identifier', () => {
  /** One more case of the same individual, announced, held by the same officer: one more reference. */
  const anotherCase = async (debtorId: string) => {
    reference += 1;
    const ref = `LGR-2026-${String(reference).padStart(5, '0')}`;
    const [creditor] = await rows<{ id: string }>("INSERT INTO creditors (name) VALUES ('Matériaux Delta') RETURNING id");
    const [made] = await rows<{ id: string }>(
      "INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, first_letter_reference, first_letter_on) VALUES ($1, $2, $3, $4, 'LR-2026-0001', '2026-11-02') RETURNING id",
      [ref, creditor!.id, debtorId, test.s.officerA],
    );
    return { caseId: made!.id, reference: ref };
  };

  it('ten failures in all on the references of one individual block them, with the answer of the reference typed', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const person = await debtorWithCode('INDIVIDUAL');
    const second = await anotherCase(person.debtorId);
    const third = await anotherCase(person.debtorId);
    const fourth = await anotherCase(person.debtorId);
    const tryAs = (ref: string, code = wrong(person.code)) => access(ref, code, 'REFERENCE');
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await tryAs(person.reference)).body).toEqual({ code: 'INVALID', attemptsLeft: 5 - attempt });
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await tryAs(second.reference)).body).toEqual({ code: 'INVALID', attemptsLeft: 5 - attempt });
    expect((await tryAs(third.reference)).body).toEqual({ code: 'INVALID', attemptsLeft: 4 });
    expect(await rows("SELECT 1 FROM notifications WHERE kind = 'DEBTOR_BLOCKED' AND case_id = $1", [person.caseId])).toEqual([]);
    // The tenth failure of the debtor: blocked, told once for each of their cases.
    expect((await tryAs(third.reference)).body).toEqual({ code: 'INVALID', attemptsLeft: 3 });
    for (const caseId of [person.caseId, second.caseId, third.caseId, fourth.caseId])
      expect(await rows("SELECT 1 FROM notifications WHERE kind = 'DEBTOR_BLOCKED' AND case_id = $1", [caseId])).toHaveLength(1);
    // The right code opens nothing more, by any of the references; a reference never tried answers as an unknown one.
    expect((await tryAs(third.reference, person.code)).body).toEqual({ code: 'INVALID', attemptsLeft: 2 });
    expect((await tryAs(fourth.reference, person.code)).body).toEqual({ code: 'INVALID', attemptsLeft: 4 });
    expect((await access('LGR-2026-99999', person.code, 'REFERENCE')).body).toEqual({ code: 'INVALID', attemptsLeft: 4 });
    // Told once, however many failures follow.
    await tryAs(fourth.reference);
    expect(await rows("SELECT 1 FROM notifications WHERE kind = 'DEBTOR_BLOCKED' AND case_id = $1", [person.caseId])).toHaveLength(1);
    expect(await rows("SELECT 1 FROM case_events WHERE kind = 'DEBTOR_ACCESS_BLOCKED' AND case_id = $1", [person.caseId])).toHaveLength(1);
    // Said in the notifications of the officer, with the case.
    const told = (await staff.call('GET', '/staff/notifications', { as: 'officerA' })).body as { text: string; href: string }[];
    expect(told.find((item) => item.href === `/debiteurs/${person.caseId}`)?.text).toMatch(/bloqué après dix codes faux/u);
    // A new code lifts it all.
    const renewed = await staff.call('POST', `/staff/cases/${person.caseId}/access-code/regenerate`, {
      as: 'officerA',
      body: { version: person.version },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(renewed.status).toBe(204);
    const { code: next } = (await staff.call('GET', `/staff/cases/${person.caseId}/access-code`, { as: 'officerA' })).body as { code: string };
    expect((await tryAs(second.reference, next)).status).toBe(200);
    expect(await rows('SELECT 1 FROM lockouts WHERE debtor_id = $1', [person.debtorId])).toEqual([]);
  });

  it('a right try clears the counter of the debtor as well', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const person = await debtorWithCode('INDIVIDUAL');
    const second = await anotherCase(person.debtorId);
    for (let attempt = 1; attempt <= 4; attempt += 1) await access(person.reference, wrong(person.code), 'REFERENCE');
    expect((await access(person.reference, person.code, 'REFERENCE')).status).toBe(200);
    for (let attempt = 1; attempt <= 4; attempt += 1) await access(second.reference, wrong(person.code), 'REFERENCE');
    for (let attempt = 1; attempt <= 4; attempt += 1) await access(person.reference, wrong(person.code), 'REFERENCE');
    expect((await access(second.reference, person.code, 'REFERENCE')).status).toBe(200);
  });
});

describe('beyond 200 failures an hour in all', () => {
  /** An application of its own, with its own keys for the limits: what the other tests count is not counted here. */
  let watched: TestApp;
  beforeAll(async () => {
    watched = await startApp([], { sessions: true, next: test, env: { VAULT_MASTER_KEY: test.config.VAULT_MASTER_KEY } });
  });
  afterAll(async () => {
    vi.useRealTimers();
    await watched.stop().catch(() => undefined);
  });
  const tryFrom = (from: string, value: string, code: string) =>
    watched.call('POST', '/debtor/access', { body: { identifier: { kind: 'SIREN', value }, code, remember: false }, headers: { 'x-forwarded-for': from } });
  const alerts = async () => (await rows<{ user_id: string }>("SELECT user_id FROM notifications WHERE kind = 'DEBTOR_ACCESS_ALERT' ORDER BY 1")).map((row) => row.user_id);

  it('tells the Director and the Developer once, and suspends 15 minutes the networks in cause only', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const prefix = `10.${randomBytes(2).join('.')}`;
    const networks = Array.from({ length: 13 }, (_, index) => `${prefix}.${index + 1}`);
    const { siren: known, code } = await debtorWithCode();
    // 200 failures from ten networks, twenty each, on known (fewer than five) and unknown identifiers alike.
    for (const [index, from] of networks.slice(0, 10).entries())
      for (let attempt = 0; attempt < 20; attempt += 1)
        expect((await tryFrom(from, attempt === 0 && index < 4 ? known! : siren(), wrong(code))).status).toBe(401);
    expect(await alerts()).toEqual([]);
    // The 201st: counted and answered as any other, then told.
    expect(await tryFrom(networks[10]!, siren(), 'ABCD')).toMatchObject({ status: 401, body: { code: 'INVALID', attemptsLeft: 4 } });
    expect(await alerts()).toEqual([test.s.director, test.s.developer].sort());
    expect(await rows("SELECT 1 FROM audit_log WHERE action = 'DEBTOR_ACCESS_ALERT'")).toHaveLength(1);
    const told = (await staff.call('GET', '/staff/notifications', { as: 'director' })).body as { text: string }[];
    expect(told.some((item) => /plus de 200 codes faux/u.test(item.text))).toBe(true);
    // The networks that failed are suspended, even with the right code; another one is not.
    for (const from of [networks[0]!, networks[9]!, networks[10]!])
      expect(await tryFrom(from, known!, code)).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
    expect((await tryFrom(networks[11]!, known!, code)).status).toBe(200);
    // During the episode, a network that fails is suspended too, and nobody is told again.
    expect((await tryFrom(networks[12]!, siren(), 'ABCD')).status).toBe(401);
    expect((await tryFrom(networks[12]!, known!, code)).status).toBe(429);
    expect(await alerts()).toHaveLength(2);
    // Fifteen minutes later, lifted (the networks that used their twenty tries of the hour wait for them as before).
    vi.setSystemTime(Date.now() + 15 * 60_000 + 1_000);
    expect((await tryFrom(networks[0]!, known!, code)).status).toBe(429);
    expect((await tryFrom(networks[10]!, known!, code)).status).toBe(200);
    expect((await tryFrom(networks[12]!, known!, code)).status).toBe(200);
    // Without Valkey, nobody signs in.
    watched.valkey.disconnect();
    expect(await tryFrom(networks[11]!, known!, code)).toMatchObject({ status: 503, body: { code: 'UNAVAILABLE' } });
  });
});

describe('the space before any code', () => {
  it('a link fills the identifier in, until it expires or its case closes', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { caseId, debtorId, siren: value } = await debtorWithCode();
    const token = randomBytes(8).toString('base64url');
    const [{ creditor_id: creditorId }] = (await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [caseId])) as [
      { creditor_id: string },
    ];
    await rows(
      "INSERT INTO debtor_links (debtor_id, case_id, creditor_id, token_hash, channel, expires_at) VALUES ($1, $2, $3, $4, 'LETTER', now() + interval '30 days')",
      [debtorId, caseId, creditorId, test.app.get(AuthKeys).debtorLink(token)],
    );
    const found = await test.call('GET', `/debtor/links/${token}`, { headers: { 'x-forwarded-for': network } });
    expect(found).toMatchObject({ status: 200, body: { identifier: { kind: 'SIREN', value: value!.replace(/(\d{3})(\d{3})(\d{3})/u, '$1 $2 $3') } } });
    await rows('UPDATE debtor_links SET expires_at = now() WHERE case_id = $1', [caseId]);
    expect((await test.call('GET', `/debtor/links/${token}`, { headers: { 'x-forwarded-for': network } })).body).toEqual({ code: 'UNKNOWN_LINK' });
  });

  it('the code by text message leaves only for a mobile a colleague confirmed, with the same answer', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    const { caseId, siren: value } = await debtorWithCode();
    const ask = () => test.call('POST', '/debtor/code-by-sms', { body: { kind: 'SIREN', value }, headers: { 'x-forwarded-for': network } });
    expect(await ask()).toMatchObject({ status: 200, body: { requested: true } });
    expect(await rows("SELECT 1 FROM outbox WHERE name = 'access-code-sms'")).toEqual([]);
    const [{ creditor_id: creditorId }] = (await rows<{ creditor_id: string }>('SELECT creditor_id FROM cases WHERE id = $1', [caseId])) as [
      { creditor_id: string },
    ];
    await rows(
      "INSERT INTO case_contacts (case_id, creditor_id, kind, label, value, value_normalized, source, status) VALUES ($1, $2, 'PHONE', 'Mobile', '06 12 34 56 78', '0612345678', 'CALL', 'VERIFIED')",
      [caseId, creditorId],
    );
    expect((await ask()).status).toBe(200);
    expect(await rows("SELECT payload FROM outbox WHERE name = 'access-code-sms'")).toHaveLength(1);
    // Three an hour for one identifier.
    expect((await ask()).status).toBe(200);
    expect(await ask()).toMatchObject({ status: 429, body: { code: 'TOO_MANY' } });
  });

  it('says how to pay, and takes a message without a code that only the manager reads', async () => {
    network = `10.${randomBytes(3).join('.')}`;
    expect(((await test.call('GET', '/debtor/limited/payment', { headers: { 'x-forwarded-for': network } })).body as { iban: string }).iban).toBe(
      '[IBAN DU COMPTE DÉDIÉ]',
    );
    const sent = await test.call('POST', '/debtor/limited/messages', {
      body: { name: 'Jean Martin', email: 'jm@exemple.test', reference: 'LGR-2026-00001', text: 'Je ne retrouve pas mon code.', attachments: [] },
      headers: { 'x-forwarded-for': network, origin: 'http://localhost:5175' },
    });
    expect(sent.status).toBe(204);
    const read = (as: string) =>
      staff.app.get(Database).run(
        {
          kind: 'staff',
          userId: as === 'manager' ? test.s.manager : test.s.officerA,
          role: as === 'manager' ? 'COLLECTION_MANAGER' : 'CLAIMS_OFFICER',
          delegations: [],
        },
        (tx) => tx.limitedMessage.count(),
      );
    expect(await read('manager')).toBe(1);
    expect(await read('officerA')).toBe(0);
  });
});
