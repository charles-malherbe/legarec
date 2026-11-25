import { notificationItem, ticketSent } from '@legarec/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startApp, type TestApp } from '../../../test/app';
import { emailOf } from '../../../test/browser';
import { startMailWorker, type MailWorker } from '../../../test/worker';

let test: TestApp;
let worker: MailWorker;
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const open = (as: string, body: object = { subject: 'Accès', message: 'Je ne vois plus mes dossiers.' }, key: string = randomUUID()) =>
  test.call('POST', '/staff/support-tickets', { as, body, headers: { 'idempotency-key': key } });
const read = async (as: string) => z.array(notificationItem).parse((await test.call('GET', '/staff/notifications', { as })).body);
const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', year: 'numeric' }).format(new Date());

beforeAll(async () => {
  test = await startApp();
  worker = startMailWorker(test);
});
afterAll(async () => {
  await worker.stop();
  await test.stop();
});

describe('question to the support', () => {
  it('gets a number, and reaches the Developer in the application and by e-mail', async () => {
    const { s } = test;
    const answer = await open('officerA');
    expect(ticketSent.parse(answer.body)).toEqual({ number: `${year}-0001` });
    expect(await read('developer')).toEqual([
      expect.objectContaining({
        kind: 'SYSTEM',
        unread: true,
        text: 'Alba Test (Gestionnaire de créances) a écrit au support : Accès',
        meta: `Demande ${year}-0001`,
      }),
    ]);
    const [mail] = await worker.run();
    expect(mail).toMatchObject({
      name: 'ops-alert',
      to: await emailOf(test, s.developer),
      data: {
        alert: {
          title: `Demande ${year}-0001 : Accès`,
          description: 'Je ne vois plus mes dossiers.',
          details: 'De Alba Test (Gestionnaire de créances)',
          is_critical: false,
        },
      },
    });
    for (const as of ['director', 'manager', 'officerA', 'officerB']) expect(await read(as)).toEqual([]);
  });

  it('of the Developer goes to the Director, and so do all of them while nobody holds that role', async () => {
    const { s } = test;
    await open('developer', { subject: '', message: 'Une question du Développeur.' });
    expect((await worker.run()).map((mail) => mail.to)).toEqual([await emailOf(test, s.director)]);
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [s.developer]);
    await open('officerB');
    expect((await worker.run()).map((mail) => mail.to)).toEqual([await emailOf(test, s.director)]);
    await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [s.developer]);
    expect((await read('director')).map((item) => item.text)).toEqual([
      'Beno Test (Gestionnaire de créances) a écrit au support : Accès',
      'Devon Test (Développeur) a écrit au support : ',
    ]);
  });

  it('waits when there is nobody to read it: kept, and told to no one else', async () => {
    const { s } = test;
    const before = (await rows('SELECT 1 FROM notifications')).length;
    await rows("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = ANY ($1::uuid[])", [[s.developer, s.director]]);
    try {
      expect((await open('officerB')).status).toBe(200);
      expect(await worker.run()).toEqual([]);
      expect(await rows('SELECT 1 FROM notifications')).toHaveLength(before);
    } finally {
      await rows("UPDATE users SET status = 'ACTIVE', disabled_at = NULL WHERE id = ANY ($1::uuid[])", [[s.developer, s.director]]);
    }
  });

  it('reaches the Developer as text: neither a page, nor a line more in the header', async () => {
    await open('officerA', { subject: 'Accès\r\nBcc: tiers@exemple.test', message: '<img src="https://exemple.test/x.png"> & <script>alert(1)</script>' });
    const [mail] = await worker.run();
    expect(mail!.subject).not.toMatch(/[\r\n]/u);
    expect(mail!.subject).toContain('Accès Bcc: tiers@exemple.test');
    expect(mail!.html).not.toMatch(/<img src="https:\/\/exemple|<script>alert/u);
    expect(mail!.html).toContain('&lt;script&gt;');
  });

  it('is sent once, however many clicks, and numbered without a hole', async () => {
    const key = randomUUID();
    const same = await Promise.all([1, 2, 3].map(() => open('officerA', undefined, key)));
    expect(new Set(same.map((answer) => (answer.body as { number: string }).number)).size).toBe(1);
    const others = await Promise.all([1, 2, 3, 4].map(() => open('manager')));
    const numbers = (await rows<{ number: string }>('SELECT number FROM support_tickets ORDER BY number')).map((row) => row.number);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => `${year}-${String(i + 1).padStart(4, '0')}`));
    expect(others.every((answer) => answer.status === 200)).toBe(true);
    await worker.run();
  });

  it('says enough, and not too much', async () => {
    expect((await open('officerA', { subject: '', message: 'court' })).status).toBe(422);
    expect((await open('officerA', { subject: '', message: 'x'.repeat(5001) })).status).toBe(422);
    expect((await open('officerA', { subject: 'x'.repeat(201), message: 'Une vraie question.' })).status).toBe(422);
  });

  it('is written nowhere but in its line and in the message', async () => {
    const secret = `phrase-${randomUUID()}`;
    await open('officerA', { subject: 'Sujet', message: `Voici ma phrase : ${secret}` });
    await worker.run();
    const elsewhere = JSON.stringify([
      await rows('SELECT * FROM audit_log'),
      await rows('SELECT * FROM outbox'),
      await rows('SELECT * FROM notifications'),
      await rows('SELECT * FROM idempotency_keys'),
    ]);
    expect(elsewhere + test.logs.join('')).not.toContain(secret);
  });

  it('is read by its author and by the support, not by the colleagues', async () => {
    const count = (as: string) =>
      test.pool.run(
        {
          officerA: { kind: 'staff', userId: test.s.officerA, role: 'CLAIMS_OFFICER', delegations: [] },
          officerB: { kind: 'staff', userId: test.s.officerB, role: 'CLAIMS_OFFICER', delegations: [] },
          developer: { kind: 'staff', userId: test.s.developer, role: 'DEVELOPER', delegations: [] },
        }[as] as never,
        (tx) => tx.supportTicket.count({ where: { user: { id: test.s.officerA } } }),
      );
    expect(await count('officerA')).toBeGreaterThan(0);
    expect(await count('developer')).toBe(await count('officerA'));
    expect(await count('officerB')).toBe(0);
  });
});

describe('notifications', () => {
  const one = async (userId: string, at = 'now()') =>
    (
      await rows<{ id: string }>(
        `INSERT INTO notifications (user_id, kind, action, actor_id, target_id, created_at) VALUES ($1, 'SUPPORT_ACTION', 'RESET_LINK', $2, $3, ${at}) RETURNING id`,
        [userId, test.s.developer, test.s.officerA],
      )
    )[0]!.id;

  it('are read and marked by their holder only', async () => {
    const [mine, theirs] = [await one(test.s.officerA), await one(test.s.officerB)];
    const ids = [mine, theirs];
    const mark = (as: string, unread: boolean) => test.call('PUT', '/staff/notifications', { as, body: { ids, unread } });
    expect((await read('officerA')).map((item) => item.id)).toEqual([mine]);
    expect((await mark('officerA', false)).status).toBe(204);
    expect((await read('officerA'))[0]).toMatchObject({ id: mine, unread: false });
    expect((await read('officerB'))[0]).toMatchObject({ id: theirs, unread: true });
    expect((await mark('officerA', true)).status).toBe(204);
    expect((await read('officerA'))[0]).toMatchObject({ unread: true });
    expect((await test.call('POST', '/staff/notifications/read', { as: 'officerA', body: { ids } })).status).toBe(204);
    expect((await read('officerA'))[0]).toMatchObject({ unread: false });
    expect((await test.call('POST', '/staff/notifications/read', { as: 'officerA', body: { ids: [] } })).status).toBe(204);
    expect((await test.call('PUT', '/staff/notifications', { as: 'officerA', body: { ids: ['x'], unread: false } })).status).toBeOneOf([204, 404]);
  });

  it('say when, as one says it', async () => {
    await one(test.s.manager, "now() - interval '3 days'");
    await one(test.s.manager);
    const [today, earlier] = await read('manager');
    expect(today).toMatchObject({ day: 'TODAY', time: expect.stringMatching(/^\d{2}:\d{2}$/u) as string });
    expect(earlier).toMatchObject({ day: 'EARLIER', time: expect.stringMatching(/^\d{1,2} \S+$/u) as string });
  });
});
