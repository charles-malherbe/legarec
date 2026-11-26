import { notificationItem, searchHit, shellData } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';

let test: TestApp;
let creditor: string;
let mine: string;
let theirs: string;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const call = (as: string, method: string, path: string, body?: unknown) =>
  test.call(method, `/staff${path}`, { as, body, headers: method === 'GET' ? {} : { 'idempotency-key': randomUUID() } });
const search = async (as: string, query: string) => {
  const answer = await call(as, 'POST', '/search', { query });
  expect(answer.status).toBe(200);
  return z.array(searchHit).parse(answer.body);
};
const shell = async (as: string) => shellData.parse((await call(as, 'GET', '/shell')).body);
const list = async (as: string) => z.array(notificationItem).parse((await call(as, 'GET', '/notifications')).body);
const assign = (as: string, ids: string[], officerId: string) => call(as, 'POST', '/cases/assign', { ids, officerId });
let number = 90_000;
const newCase = async (name: string, siren: string, officer: string | null, invoice: string) => {
  const [debtor] = await rows<{ id: string }>("INSERT INTO debtors (kind, name, siren) VALUES ('COMPANY', $1, $2) RETURNING id", [name, siren]);
  const [made] = await rows<{ id: string }>('INSERT INTO cases (reference, creditor_id, debtor_id, officer_id) VALUES ($1, $2, $3, $4) RETURNING id', [
    `LGR-2026-${(number += 1)}`,
    creditor,
    debtor!.id,
    officer,
  ]);
  await rows(
    "INSERT INTO case_invoices (case_id, creditor_id, number, external_ref, issued_on, due_on, claimed_cents, principal_cents, created_by) VALUES ($1, $2, $3, $4, '2026-08-01', '2026-09-01', 120050, 120050, $5)",
    [made!.id, creditor, invoice, `REF-${invoice}`, test.s.manager],
  );
  return made!.id;
};

beforeAll(async () => {
  test = await startApp();
  creditor = (await rows<{ id: string }>("INSERT INTO creditors (name, siren) VALUES ('Électricité Zéphyr', '732829320') RETURNING id"))[0]!.id;
  mine = await newCase('Ébénisterie 100 % chêne', '552100554', test.s.officerA, 'ZQ_7');
  theirs = await newCase('Ébénisterie cachée', '552081317', test.s.officerB, 'ZQ_8');
});
beforeEach(async () => void (await rows('DELETE FROM notifications')));
afterAll(() => test.stop());

describe('the search', () => {
  it('finds debtors, creditors and invoices, whatever the accents', async () => {
    expect((await search('officerA', 'ebenisterie')).map((hit) => hit.id)).toEqual([`d:${mine}`]);
    expect((await search('manager', 'EBÉNISTERIE')).map((hit) => hit.id).sort()).toEqual([`d:${mine}`, `d:${theirs}`].sort());
    expect(await search('manager', 'zephyr')).toEqual(
      expect.arrayContaining([
        {
          id: `c:${creditor}`,
          kind: 'CREDITOR',
          title: 'Électricité Zéphyr',
          sub: 'SIREN 732 829 320 · 2 débiteurs',
          href: `/creanciers/${creditor}`,
          initials: 'ÉZ',
        },
      ]),
    );
    const [invoice] = (await search('officerA', 'zq_7')).filter((hit) => hit.kind === 'INVOICE');
    expect(invoice).toMatchObject({ title: 'ZQ_7', href: `/debiteurs/${mine}` });
    expect(invoice!.sub).toMatch(/^Ébénisterie 100 % chêne · Électricité Zéphyr · 1\s200,50\s€$/u);
    expect((await search('officerA', 'ref-zq_7')).map((hit) => hit.kind)).toContain('INVOICE');
  });

  it('finds a number with or without spaces', async () => {
    // Too short to be one.
    expect((await search('manager', '55')).map((hit) => hit.id)).not.toContain(`d:${mine}`);
    expect((await search('manager', '73')).map((hit) => hit.id)).not.toContain(`c:${creditor}`);
    for (const query of ['552 100 554', '552100', '55210055400012'])
      expect(
        (await search('manager', query)).map((hit) => hit.id),
        query,
      ).toContain(`d:${mine}`);
    expect((await search('manager', '732 829 320')).map((hit) => hit.id)).toContain(`c:${creditor}`);
  });

  it('takes a sign of SQL for itself', async () => {
    expect((await search('manager', '100 %')).map((hit) => hit.id)).toEqual([`d:${mine}`]);
    expect(await search('manager', 'zq%7')).toEqual([]);
    expect((await search('manager', 'zq_7')).filter((hit) => hit.kind === 'INVOICE')).toHaveLength(1);
    expect(await search('manager', "'; DROP TABLE cases; --")).toEqual([]);
    expect(await search('manager', '\\')).toEqual([]);
  });

  it('shows nothing that the person may not read', async () => {
    for (const query of ['cachée', 'zq_8', '552081317']) expect(await search('officerA', query), query).toEqual([]);
    expect(await search('developer', 'ebenisterie')).toEqual([]);
    expect(await search('manager', '  ')).toEqual([]);
  });

  it('gives eight of each kind at most', async () => {
    for (let index = 0; index < 9; index += 1) await newCase(`Série ${index}`, `9000000${10 + index}`, test.s.officerA, `SERIE-${index}`);
    const found = await search('officerA', 'série');
    expect(found.filter((hit) => hit.kind === 'DEBTOR')).toHaveLength(8);
    expect((await search('officerA', 'serie-')).filter((hit) => hit.kind === 'INVOICE')).toHaveLength(8);
  });

  it('is not written anywhere', async () => {
    await search('manager', 'recherche-fictive-kxpm');
    expect(test.logs.join('')).not.toContain('recherche-fictive-kxpm');
    expect(JSON.stringify(await rows('SELECT * FROM audit_log'))).not.toContain('recherche-fictive-kxpm');
  });
});

describe('the frame of the screens', () => {
  it('counts the debtors of the creditors that the person reads', async () => {
    const { creditors } = await shell('officerB');
    expect(creditors[0]).toMatchObject({ id: 'all', name: 'Tous les créanciers' });
    expect(creditors.find((item) => item.id === creditor)).toMatchObject({ count: 1, initials: 'ÉZ' });
    expect(creditors[0]!.count).toBe(creditors.slice(1).reduce((total, item) => total + item.count, 0));
  });
  it('shows no creditor nor figure to the Developer', async () => {
    const { creditors, counts } = await shell('developer');
    expect(creditors).toEqual([]);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
  it('counts who was there in the last five minutes', async () => {
    await rows('UPDATE users SET last_seen_at = NULL');
    expect((await shell('manager')).counts.teamOnline).toBe(0);
    await rows("UPDATE users SET last_seen_at = now() - interval '4 minutes' WHERE id IN ($1, $2)", [test.s.officerA, test.s.developer]);
    await rows("UPDATE users SET last_seen_at = now() - interval '6 minutes' WHERE id = $1", [test.s.officerB]);
    expect((await shell('manager')).counts.teamOnline).toBe(1);
  });
  it('rings for what is not read, and no longer once it is', async () => {
    await assign('director', [mine], test.s.officerB);
    const { notifications } = await shell('officerB');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ unread: true, href: `/debiteurs/${mine}` });
    await call('officerB', 'POST', '/notifications/read', { ids: [notifications[0]!.id] });
    expect((await shell('officerB')).notifications[0]!.unread).toBe(false);
    await assign('director', [mine], test.s.officerA);
  });
});

describe('a notification of cases', () => {
  it('always says how many, by PostgreSQL itself', async () => {
    for (const kind of ['CASE_ASSIGNED', 'SUBSTITUTE_NOTICE'])
      await expect(
        rows('INSERT INTO notifications (user_id, kind, actor_id, target_id) VALUES ($1, $2::notification_kind, $3, $1)', [
          test.s.officerA,
          kind,
          test.s.director,
        ]),
        kind,
      ).rejects.toThrow(/notifications_facts/u);
  });
});

describe('an assignment', () => {
  it('is told to whoever receives the case', async () => {
    expect((await assign('director', [theirs], test.s.officerA)).status).toBe(204);
    const [told] = await list('officerA');
    expect(told).toMatchObject({ kind: 'SYSTEM', unread: true, href: `/debiteurs/${theirs}`, cta: 'Ouvrir le dossier' });
    expect(told!.text).toMatch(/\(Directeur\) vous a attribué le dossier de Ébénisterie cachée$/u);
    expect(told!.meta).toMatch(/^Dossier LGR-2026-9/u);
    expect(await list('officerB')).toEqual([]);
    // Given back: whoever no longer reads it no longer learns its name.
    await assign('director', [theirs], test.s.officerB);
    const [after] = await list('officerA');
    expect(after).toMatchObject({ href: '/debiteurs', text: expect.stringMatching(/vous a attribué un dossier$/u) as string });
    expect(JSON.stringify(after)).not.toContain('cachée');
  });

  it('of several cases is told once', async () => {
    const [left, right] = [await newCase('Lot un', '900100100', null, 'L1'), await newCase('Lot deux', '900100101', null, 'L2')];
    await assign('director', [left, right], test.s.officerB);
    expect((await list('officerB')).map((item) => item.text)).toEqual([expect.stringMatching(/vous a attribué 2 dossiers$/u)]);
    // Nothing has changed: nothing is told.
    await assign('director', [left, right], test.s.officerB);
    expect(await list('officerB')).toHaveLength(1);
  });

  it('to oneself is not told', async () => {
    await assign('director', [mine], test.s.director);
    expect(await list('director')).toEqual([]);
    await assign('director', [mine], test.s.officerA);
  });

  it('by the manager says who did it', async () => {
    await assign('manager', [mine], test.s.officerB);
    expect((await list('officerB'))[0]!.text).toMatch(/\(Responsable du recouvrement\) vous a attribué/u);
    await assign('director', [mine], test.s.officerA);
  });

  describe('to someone who is away', () => {
    const away = (from: string, until: string, substitute: string) =>
      rows(
        "UPDATE users SET substitute_id = $2, absent_from = (now() AT TIME ZONE 'Europe/Paris')::date + $3::int, absent_until = (now() AT TIME ZONE 'Europe/Paris')::date + $4::int WHERE id = $1",
        [test.s.officerA, substitute, Number(from), Number(until)],
      );
    afterAll(() =>
      rows('UPDATE users SET substitute_id = NULL, absent_from = NULL, absent_until = NULL WHERE id = $1', [test.s.officerA]).then(() => undefined),
    );

    it('is also told to the substitute, who learns nothing of the case nor reads it', async () => {
      await away('0', '0', test.s.officerB);
      await assign('director', [theirs], test.s.officerA);
      expect(await list('officerA')).toHaveLength(1);
      const [told] = await list('officerB');
      expect(told).toMatchObject({ href: '/notifications', meta: 'Remplacement' });
      expect(JSON.stringify(told)).not.toMatch(/Ébénisterie|LGR|debiteurs|€/u);
      // Refused, as any case of someone else (question 141).
      expect((await call('officerB', 'GET', `/cases/${theirs}`)).status).toBe(403);
      expect(await rows("SELECT case_id FROM notifications WHERE kind = 'SUBSTITUTE_NOTICE'")).toEqual([{ case_id: null }]);
      await assign('director', [theirs], test.s.officerB);
    });
    it.each([
      ['1', '3'],
      ['-3', '-1'],
    ])('only during the absence (%s to %s days)', async (from, until) => {
      await away(from, until, test.s.officerB);
      await assign('director', [theirs], test.s.officerA);
      expect(await list('officerB')).toEqual([]);
      await assign('director', [theirs], test.s.officerB);
    });
    it('never to the Developer nor to whoever assigns', async () => {
      for (const substitute of [test.s.developer, test.s.director]) {
        await away('0', '0', substitute);
        await assign('director', [theirs], test.s.officerA);
        await assign('director', [theirs], test.s.officerB);
      }
      expect(await rows("SELECT 1 FROM notifications WHERE kind = 'SUBSTITUTE_NOTICE'")).toEqual([]);
    });
    it('never to a substitute who has left', async () => {
      const [left] = await rows<{ id: string }>(
        "INSERT INTO users (role, status, first_name, last_name, email, disabled_at) VALUES ('CLAIMS_OFFICER', 'DISABLED', 'Nora', 'Test', 'nora.partie@exemple.test', now()) RETURNING id",
      );
      await away('0', '0', left!.id);
      await assign('director', [theirs], test.s.officerA);
      expect(await rows("SELECT 1 FROM notifications WHERE kind = 'SUBSTITUTE_NOTICE'")).toEqual([]);
      await assign('director', [theirs], test.s.officerB);
    });
  });
});

describe('what is stored of a notification', () => {
  const FACTS = 'INSERT INTO notifications (user_id, kind, actor_id, target_id, case_id, creditor_id, case_count) VALUES ($1, ';
  it.each([
    ['a count of nothing', `${FACTS} 'CASE_ASSIGNED', $1, NULL, NULL, NULL, 0)`, 'notifications_facts'],
    ['one case that is not said', `${FACTS} 'CASE_ASSIGNED', $1, NULL, NULL, NULL, 1)`, 'notifications_facts'],
    ['one case out of several', `${FACTS} 'CASE_ASSIGNED', $1, NULL, $2, $3, 2)`, 'notifications_facts'],
    ['an absence of nobody', `${FACTS} 'SUBSTITUTE_NOTICE', $1, NULL, NULL, NULL, 1)`, 'notifications_facts'],
    ['an absence about a case', `${FACTS} 'SUBSTITUTE_NOTICE', $1, $1, $2, $3, 1)`, 'notifications_case'],
    ['a case without its creditor', `${FACTS} 'CASE_ASSIGNED', $1, NULL, $2, NULL, 1)`, 'notifications_case'],
  ])('is never %s', async (_what, statement, constraint) => {
    await expect(rows(statement.replaceAll('$2', `'${mine}'`).replaceAll('$3', `'${creditor}'`), [test.s.officerB])).rejects.toThrow(constraint);
  });
});

describe('the bell', () => {
  const notify = (minutes: number, read: boolean) =>
    rows(
      "INSERT INTO notifications (user_id, kind, actor_id, case_count, created_at, read_at) VALUES ($1, 'CASE_ASSIGNED', $2, 2, now() - make_interval(mins => $3), CASE WHEN $4 THEN now() END)",
      [test.s.officerB, test.s.director, minutes, read],
    );
  it('shows seven, what is not read before what is, the latest first', async () => {
    for (let minutes = 1; minutes <= 7; minutes += 1) await notify(minutes, true);
    for (const minutes of [50, 60]) await notify(minutes, false);
    const { notifications } = await shell('officerB');
    expect(notifications.map((item) => item.unread)).toEqual([false, false, false, false, false, true, true]);
    for (let minutes = 1; minutes <= 8; minutes += 1) await notify(minutes, false);
    expect((await shell('officerB')).notifications.map((item) => item.unread)).toEqual(Array.from({ length: 7 }, () => true));
  });

  it('marks what is named, for its reader alone, and keeps when it was read first', async () => {
    await notify(1, false);
    await notify(2, false);
    const [first, second] = await list('officerB');
    await call('officerA', 'POST', '/notifications/read', { ids: [first!.id] });
    expect((await list('officerB')).map((item) => item.unread)).toEqual([true, true]);
    await call('officerB', 'PUT', '/notifications', { ids: [first!.id], unread: false });
    expect((await list('officerB')).map((item) => item.unread)).toEqual([false, true]);
    await rows("UPDATE notifications SET read_at = '2026-01-01' WHERE id = $1", [first!.id]);
    await call('officerB', 'POST', '/notifications/read', { ids: [first!.id] });
    expect(await rows("SELECT read_at = '2026-01-01' AS kept FROM notifications WHERE id = $1", [first!.id])).toEqual([{ kept: true }]);
    await call('officerB', 'PUT', '/notifications', { ids: [first!.id, second!.id], unread: true });
    expect((await list('officerB')).map((item) => item.unread)).toEqual([true, true]);
  });
});

describe('an assignment that changes nothing', () => {
  it('writes and tells nothing, and each change moves the version of the case', async () => {
    const id = await newCase('Lot trois', '900100102', null, 'L3');
    const state = async () =>
      (
        await rows(
          "SELECT version, (SELECT count(*)::int FROM case_events e WHERE e.case_id = c.id AND e.kind = 'CASE_ASSIGNED') AS told FROM cases c WHERE id = $1",
          [id],
        )
      )[0];
    for (let turn = 0; turn < 2; turn += 1) {
      expect((await assign('director', [id], test.s.officerB)).status).toBe(204);
      expect(await state()).toEqual({ version: 2, told: 1 });
    }
    expect(await list('officerB')).toHaveLength(1);
  });
});

describe('who has left', () => {
  it('is neither found nor counted', async () => {
    const [gone] = await rows<{ id: string }>("INSERT INTO creditors (name, siren, status) VALUES ('Zéphyr parti', '732829353', 'ENDED') RETURNING id");
    expect((await search('manager', 'zephyr')).map((hit) => hit.id)).not.toContain(`c:${gone!.id}`);
    expect((await search('manager', '732829353')).map((hit) => hit.id)).toEqual([]);
    expect((await shell('manager')).creditors.map((item) => item.id)).not.toContain(gone!.id);
    await rows('UPDATE users SET last_seen_at = CASE WHEN id = $1 THEN now() END', [test.s.officerB]);
    expect((await shell('manager')).counts.teamOnline).toBe(1);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [test.s.officerB]);
    expect((await shell('manager')).counts.teamOnline).toBe(0);
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [test.s.officerB]);
  });
});
