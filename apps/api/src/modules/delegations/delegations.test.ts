import { delegationsData } from '@legarec/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../../test/app';
import { emailOf } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';

let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const read = async () => delegationsData.parse((await test.call('GET', '/staff/delegations', { as: 'director' })).body);
const set = (kind: string, active: unknown, as = 'director') => test.call('PUT', `/staff/delegations/${kind}`, { as, body: { active } });
const noted = () => rows("SELECT action, params, actor_id, on_behalf_of_id FROM audit_log WHERE action LIKE 'DELEGATION%' ORDER BY occurred_at, id");

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('delegations', () => {
  it('are open from the first day, with their holders', async () => {
    expect(await read()).toEqual({ technical: true, administrative: true, developer: 'Devon Test', manager: 'Remi Test' });
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.developer]);
    expect((await read()).developer).toBe('aucun titulaire');
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.developer]);
  });

  it('stop at once when they are withdrawn, and come back when they are given', async () => {
    const { s } = test;
    const invite = () =>
      test.call('POST', '/staff/members', {
        as: 'manager',
        body: { firstName: 'I', lastName: 'T', role: 'CLAIMS_OFFICER', email: `i${Math.random().toString().slice(2)}@legarec.fr` },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
    expect((await invite()).status).toBe(204);
    expect((await set('administrative', false)).status).toBe(204);
    expect(await read()).toMatchObject({ administrative: false, technical: true });
    // The test still announces the delegation: PostgreSQL does not believe it.
    expect((await invite()).status).toBe(403);
    // Twice: nothing more to note, nor to tell.
    expect((await set('administrative', false)).status).toBe(204);
    expect((await set('administrative', true)).status).toBe(204);
    expect((await set('administrative', true)).status).toBe(204);
    expect((await invite()).status).toBe(204);
    const entry = { actor_id: s.director, on_behalf_of_id: null, params: { delegation: 'ADMINISTRATIVE' } };
    expect(await noted()).toEqual([
      { action: 'DELEGATION_WITHDRAWN', ...entry },
      { action: 'DELEGATION_GIVEN', ...entry },
    ]);
    const mails = (await worker.run()).filter((mail) => mail.name === 'delegation-changed');
    expect(mails.map((mail) => mail.to)).toEqual(Array<string>(2).fill(await emailOf(test, s.manager)));
    const told = mails.map((mail) => (mail.data.delegation as { status_label: string }).status_label).sort();
    expect(told).toEqual(['accordée', 'retirée']);
    expect(mails[0]!.data).toMatchObject({
      action_url: 'http://localhost:5173/compte',
      delegation: { from_name: 'Dora Test', to_name: 'Remi Test', scope_label: 'administrative', changed_by: 'Dora Test' },
      recipient: { first_name: 'Remi' },
    });
  });

  it('are given and withdrawn by the Director alone: a delegate never takes one back', async () => {
    for (const as of ['manager', 'managerAlone', 'developer', 'officerA', 'liar', 'partnerA'])
      for (const kind of ['technical', 'administrative']) expect((await set(kind, true, as)).status, `${as} ${kind}`).toBe(403);
    expect(await read()).toMatchObject({ technical: true, administrative: true });
  });

  it('are given once, by one of those who ask at the same time', async () => {
    expect((await set('technical', false)).status).toBe(204);
    await worker.run();
    const before = (await noted()).length;
    const answers = await Promise.all([1, 2, 3].map(() => set('technical', true)));
    expect(answers.some((answer) => answer.status === 204)).toBe(true);
    for (const { status } of answers) expect(status).toBeOneOf([204, 409]);
    expect(await read()).toMatchObject({ technical: true, administrative: true });
    expect(await noted()).toHaveLength(before + 1);
    expect((await worker.run()).map((mail) => mail.name)).toEqual(['delegation-changed']);
  });

  it('are told to the holder in place, and to nobody when there is none', async () => {
    const { s } = test;
    const former = await rows<{ id: string }>(
      "INSERT INTO users (role, status, first_name, last_name, email, disabled_at) VALUES ('DEVELOPER', 'DISABLED', 'Ancien', 'Test', 'ancien@exemple.test', now()) RETURNING id",
    );
    expect(former).toHaveLength(1);
    await set('technical', false);
    const [mail] = await worker.run();
    expect(mail).toMatchObject({
      to: await emailOf(test, s.developer),
      data: { delegation: { to_name: 'Devon Test', scope_label: 'technique', status_label: 'retirée' } },
    });
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.developer]);
    expect((await set('technical', true)).status).toBe(204);
    expect(await worker.run()).toEqual([]);
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.developer]);
  });

  it('are told only while the Director who changed them is still in place', async () => {
    const { s } = test;
    await set('administrative', false);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.director]);
    try {
      expect(await worker.run()).toEqual([]);
      expect(await rows("SELECT failure FROM outbox WHERE name = 'delegation-changed' AND failed_at IS NOT NULL")).toEqual([{ failure: 'AUTHOR_GONE' }]);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.director]);
    }
    // Enabled again: what was withdrawn stays withdrawn.
    expect(await read()).toMatchObject({ administrative: false });
    expect((await set('administrative', true)).status).toBe(204);
    await worker.run();
  });

  it('refuse an unknown kind, or anything but yes or no', async () => {
    for (const kind of ['TECHNICAL', 'financial', 'constructor', '__proto__', 'toString']) expect((await set(kind, true)).status, kind).toBe(404);
    expect((await set('technical', 'yes')).status).toBe(422);
  });
});
