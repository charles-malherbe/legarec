import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Anonymous, AnyStaff, Debtor, Partner, Staff, StaffOrDelegate } from '../src/platform/access/access';
import { Prisma } from '../src/generated/prisma/client';
import { Audit } from '../src/platform/audit/audit';
import { Database } from '../src/platform/database/database';
import { Commits, OneTimeAnswer } from '../src/platform/http/transaction.interceptor';
import { Outbox } from '../src/platform/queue/outbox';
import { VALKEY, type Valkey } from '../src/platform/queue/valkey';
import { ACTOR_HEADER, ORIGINS, startApp, type TestApp } from './app';
import { SAMPLE_CONTROLLERS } from './sample.controller';

const SECRET = 'zz-secret-zz';
const echo = z.object({
  text: z.string().trim().min(1).max(20),
  flag: z.boolean().default(false),
  lines: z.array(z.object({ label: z.string().min(1) })).default([]),
});

/** What the sample routes do not cover: every kind of answer, of error and of repeat. */
@Controller('staff/probe')
@AnyStaff()
class StaffProbeController {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  @Post('echo')
  echo(@Body({ schema: echo }) body: z.infer<typeof echo>) {
    return body;
  }
  @Get('query')
  query(@Query({ schema: z.record(z.string(), z.unknown()) }) query: Record<string, unknown>) {
    return query;
  }
  @Get('director')
  @Staff('DIRECTOR')
  director() {
    return { director: true };
  }
  /** Three traces of one action: history, audit, task. */
  @Post('act/:id')
  @Commits()
  @HttpCode(204)
  async act(@Param('id') id: string) {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, 'PROBE_ACT', 'Essai', NULL, 'neutral'::event_tone, false)`;
    await this.audit.log({ action: 'PROBE_ACT' as never, entity: { type: 'case', id } });
    await this.outbox.add({ queue: 'maintenance', name: 'probe-act', payload: { caseId: id } });
  }
  @Put('value')
  @Commits()
  async value() {
    const [row] = await this.database.tx.$queryRaw<{ number: number }[]>`SELECT number FROM app.next_number('PROBE_VALUE')`;
    return { number: row!.number, list: [1, 'deux', null], at: new Date(0), absent: undefined, text: 'é « » 🙂'.slice(0, 5) };
  }
  @Delete('value')
  @Commits()
  async remove() {
    await this.audit.log({ action: 'PROBE_REMOVED' as never });
    return null;
  }
  @Post('secret')
  @Commits()
  @OneTimeAnswer()
  async secret() {
    await this.audit.log({ action: 'PROBE_SECRET' as never });
    return { password: SECRET };
  }
  @Post('late/:id')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  @HttpCode(204)
  async late() {
    await this.audit.log({ action: 'PROBE_DELEGATED' as never });
  }

  @Post('twice')
  async twice(@Query('with', { schema: z.string() }) how: string) {
    if (how === 'model') throw new Prisma.PrismaClientKnownRequestError(SECRET, { code: 'P2002', clientVersion: 'test', meta: { target: [SECRET] } });
    const data = { actor: `user:${(this.database.actor as { userId: string }).userId}`, key: randomUUID() };
    for (let i = 0; i < 2; i += 1)
      await this.database.tx
        .$executeRaw`INSERT INTO idempotency_keys (actor, key, route, request_hash) VALUES (${data.actor}, ${data.key}::uuid, ${SECRET}, '\\x00')`;
  }
  @Get('missing')
  missing() {
    return this.database.tx.case.findUniqueOrThrow({ where: { id: randomUUID() }, select: { id: true } });
  }
  @Get('teapot')
  teapot() {
    throw new HttpException(SECRET, 418);
  }
  @Get('broken')
  broken() {
    throw new InternalServerErrorException(SECRET);
  }
  @Get('away')
  away() {
    throw new ServiceUnavailableException(SECRET);
  }
  /** A message on several lines, some of which look like the frames of a stack. */
  @Get('quoted')
  quoted() {
    throw new Error(`refused\n    at Jean Dupont KXPM\n    at jean@exemple.test (/chemin/${SECRET}.js:1:2)\n    at Jean (/home/KXPM.js:1:2)`);
  }
  /** The message of the stack is no longer that of the error. */
  @Get('renamed')
  renamed() {
    const error = new Error('changed since then');
    const frames = (error.stack ?? '').split('\n').slice(1);
    error.stack = ['Error: refused', '    at Jean Dupont KXPM', `    at jean@exemple.test (/chemin/${SECRET}.js:1:2)`, ...frames].join('\n');
    throw error;
  }
  @Get('slow')
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {};
  }
  /** Writes nothing that would carry a name. */
  @Post('quiet')
  @StaffOrDelegate('ADMINISTRATIVE', 'DIRECTOR')
  quiet() {
    return this.database.tx.$queryRaw`SELECT 1 AS one`;
  }
}

@Controller('partner/probe')
class PartnerProbeController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Post('act/:id')
  @Partner()
  @Commits()
  @HttpCode(204)
  async act(@Param('id') id: string) {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, 'PROBE_PARTNER', 'Essai', NULL, 'neutral'::event_tone, true)`;
  }
}

@Controller('debtor/probe')
class DebtorProbeController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Post('act/:id')
  @Debtor()
  @Commits()
  @HttpCode(204)
  async act(@Param('id') id: string) {
    await this.database.tx.$executeRaw`SELECT app.add_case_event(${id}::uuid, 'PROBE_DEBTOR', 'Essai', NULL, 'neutral'::event_tone, false)`;
  }
  @Post('open')
  @Anonymous('debtor')
  async open() {
    const [row] = await this.database.tx.$queryRaw<{ role: string; key: string | null }[]>`SELECT current_user::text AS role, app.actor_key() AS key`;
    return row;
  }
}

let test: TestApp;
let base: URL;
beforeAll(async () => {
  test = await startApp([...SAMPLE_CONTROLLERS, StaffProbeController, PartnerProbeController, DebtorProbeController]);
  base = new URL(await test.app.getUrl());
});
afterAll(() => test.stop());
beforeEach(() => {
  test.logs.length = 0;
});

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  body: unknown;
}
/** Nothing added nor cleaned: the path and the headers leave exactly as they are written. */
const raw = (method: string, path: string, headers: Record<string, string> = {}, body?: string | Buffer) =>
  new Promise<Answer>((resolve, reject) => {
    const request = http.request({ host: base.hostname, port: base.port, method, path, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: response.statusCode ?? 0, headers: response.headers, text, body: text.startsWith('{') ? (JSON.parse(text) as unknown) : undefined });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
const from = (actor: string, portal: keyof typeof ORIGINS = 'staff') => ({ [ACTOR_HEADER]: actor, origin: ORIGINS[portal] });
const key = (value: string = randomUUID()) => ({ 'idempotency-key': value });
const rows = async <T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await test.database.admin.query<T>(sql, values)).rows;
const count = async (sql: string, values: unknown[] = []) => (await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, values))[0]!.n;
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 25 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('spelling of the path', () => {
  const changed = () => count("audit_log WHERE action = 'SETTING_CHANGED'");

  it.each([
    '/staff/sample/settings',
    '/staff/sample/settings/',
    '/staff/SAMPLE/settings',
    '/staff/../staff/sample/settings',
    '/./staff/sample/settings',
    '//staff/sample/settings',
    '/staff//sample/settings',
    '/%73taff/sample/settings',
    '/staff%2Fsample/settings',
    '/staff;x=1/sample/settings',
    '/public/../staff/sample/settings',
    '/hooks/../staff/sample/settings',
  ])('%s never reaches a change without the exact origin', async (path) => {
    const before = await changed();
    for (const origin of [undefined, ORIGINS.partner, ORIGINS.debtor, 'https://exemple.test', 'null']) {
      const answer = await raw('POST', path, { [ACTOR_HEADER]: 'director', ...(origin ? { origin } : {}) });
      expect([403, 404], `${path} from ${origin}`).toContain(answer.status);
      expect(answer.headers['access-control-allow-origin']).toBeUndefined();
    }
    expect(await changed()).toBe(before);
  });

  it.each(['/STAFF/sample/settings', '/Staff/sample/settings', '/sTAFF/sample/settings'])('nor does %s', async (path) => {
    const before = await changed();
    for (const origin of [undefined, ORIGINS.partner, ORIGINS.debtor, 'https://exemple.test']) {
      const answer = await raw('POST', path, { [ACTOR_HEADER]: 'director', ...(origin ? { origin } : {}) });
      expect([403, 404], `${path} from ${origin}`).toContain(answer.status);
    }
    expect(await changed()).toBe(before);
  });
  it.each([
    ['/STAFF/sample/cases', 'officerA', 'https://exemple.test'],
    ['/PARTNER/sample/cases', 'partnerA', ORIGINS.debtor],
    ['/DEBTOR/sample/cases', 'debtorA', ORIGINS.partner],
  ])('and %s is not read from another site', async (path, as, origin) => {
    expect([403, 404]).toContain((await raw('GET', path, { [ACTOR_HEADER]: as, origin })).status);
  });

  it('answers 400 to a path that cannot be decoded', async () => {
    expect(await raw('GET', '/staff/sample/cases/%E0%A4%A', from('officerA'))).toMatchObject({ status: 400, body: { code: 'INVALID_REQUEST' } });
  });

  it.each(['demo', '%00', '1', `${'x'.repeat(2_000)}`])('answers 404 to an identifier that is not one', async (id) => {
    expect((await raw('GET', `/staff/sample/cases/${id}`, from('officerA'))).status).toBe(404);
  });

  it('reads a query as plain text, never as an object or a list to be explored', async () => {
    const answer = await raw('GET', '/staff/probe/query?a[b]=c&__proto__[x]=y&d=1&d=2', from('officerA'));
    expect(answer.body).toMatchObject({ 'a[b]': 'c', d: ['1', '2'] });
    expect((answer.body as Record<string, unknown>).a).toBeUndefined();
  });
});

describe('headers of the answers', () => {
  const requests: [string, () => Promise<Answer>, number][] = [
    ['an answer', () => raw('GET', '/staff/sample/cases', from('officerA')), 200],
    ['an empty answer', () => raw('POST', '/staff/sample/settings', from('director')), 204],
    ['a preflight', () => raw('OPTIONS', '/staff/sample/settings', { origin: ORIGINS.staff }), 204],
    ['a stranger', () => raw('GET', '/staff/sample/cases', { origin: ORIGINS.staff }), 401],
    ['the wrong person', () => raw('GET', '/staff/sample/cases', from('partnerA')), 403],
    ['the wrong origin', () => raw('GET', '/staff/sample/cases', from('officerA', 'partner')), 403],
    ['an unknown route', () => raw('GET', '/staff/unknown', from('officerA')), 404],
    ['an unknown prefix', () => raw('GET', '/unknown'), 404],
    ['a body of another type', () => raw('POST', '/staff/probe/echo', { ...from('officerA'), 'content-type': 'text/plain' }, 'x'), 415],
    ['a malformed body', () => raw('POST', '/staff/probe/echo', { ...from('officerA'), 'content-type': 'application/json' }, '{'), 400],
    ['an invalid body', () => raw('POST', '/staff/probe/echo', { ...from('officerA'), 'content-type': 'application/json' }, '{}'), 422],
    ['a failure', () => raw('POST', '/staff/sample/leak', from('officerA')), 500],
    ['the state of the API', () => raw('GET', '/health'), 200],
  ];
  it.each(requests)('are the same for %s', async (_what, request, status) => {
    const answer = await request();
    expect(answer.status).toBe(status);
    expect(answer.headers).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'cross-origin-resource-policy': 'same-site',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    expect(answer.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/u);
    for (const absent of ['x-powered-by', 'server', 'etag', 'set-cookie']) expect(answer.headers[absent], absent).toBeUndefined();
    if (status >= 400) expect(Object.keys(answer.body as object).sort()).toEqual(expect.arrayContaining(['code']) as string[]);
  });

  it('give each request its own number, never the one it announces', async () => {
    const announced = randomUUID();
    const numbers = await Promise.all(
      Array.from({ length: 5 }, async () => (await raw('GET', '/health', { 'x-request-id': announced, 'request-id': announced })).headers['x-request-id']),
    );
    expect(new Set([announced, ...numbers]).size).toBe(6);
  });

  it('open an answer to the exact origin of its portal, and to no other', async () => {
    for (const [portal, path, as] of [
      ['staff', '/staff/sample/cases', 'officerA'],
      ['partner', '/partner/sample/cases', 'partnerA'],
      ['debtor', '/debtor/sample/cases', 'debtorA'],
    ] as const) {
      const own = await raw('GET', path, from(as, portal));
      expect(own.headers).toMatchObject({ 'access-control-allow-origin': ORIGINS[portal], 'access-control-allow-credentials': 'true', vary: 'Origin' });
      for (const other of Object.values(ORIGINS).filter((origin) => origin !== ORIGINS[portal])) {
        const answer = await raw('GET', path, { [ACTOR_HEADER]: as, origin: other });
        expect([answer.status, answer.headers['access-control-allow-origin']], `${path} from ${other}`).toEqual([403, undefined]);
      }
    }
    // Neither the state of the API nor the public values are opened with the cookies of anyone.
    for (const path of ['/health', '/public/sample']) {
      const answer = await raw('GET', path, { origin: ORIGINS.staff });
      expect([answer.headers['access-control-allow-origin'], answer.headers['access-control-allow-credentials']], path).toEqual([undefined, undefined]);
    }
  });

  it('announce to a preflight the methods and headers in use, never all of them', async () => {
    const answer = await raw('OPTIONS', '/staff/sample/settings', {
      origin: ORIGINS.staff,
      'access-control-request-method': 'PATCH',
      'access-control-request-headers': 'x-anything',
    });
    expect(answer.headers['access-control-allow-methods']).toBe('GET, POST, PUT, DELETE');
    expect(answer.headers['access-control-allow-headers']).toBe('Content-Type, Idempotency-Key, X-Background');
  });
});

describe('every method of a route', () => {
  it.each([
    ['GET', '/staff/sample/cases'],
    ['POST', '/staff/probe/echo'],
    ['PUT', '/staff/probe/value'],
    ['DELETE', '/staff/probe/value'],
  ])('%s %s obeys the same rule', async (method, path) => {
    expect((await raw(method, path, { origin: ORIGINS.staff })).status).toBe(401);
    expect((await raw(method, path, from('partnerA'))).status).toBe(403);
    expect((await raw(method, path, from('officerA', 'partner'))).status).toBe(403);
    expect([401, 403]).not.toContain((await raw(method, path, from('officerA'))).status);
  });
  it('a change without any origin is refused, whatever its method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect((await raw(method, '/staff/probe/value', { [ACTOR_HEADER]: 'officerA' })).status, method).toBe(403);
  });
  it('HEAD obeys the rule of GET', async () => {
    expect((await raw('HEAD', '/staff/sample/cases', { origin: ORIGINS.staff })).status).toBe(401);
    expect((await raw('HEAD', '/staff/sample/cases', from('partnerA'))).status).toBe(403);
    expect((await raw('HEAD', '/staff/sample/cases', from('officerA'))).status).toBe(200);
  });
  it('the rule of a handler wins over the one of its class', async () => {
    expect((await raw('GET', '/staff/probe/director', from('officerA'))).status).toBe(403);
    expect((await raw('GET', '/staff/probe/director', from('director'))).status).toBe(200);
  });
});

describe('bodies', () => {
  const post = (headers: Record<string, string>, body?: string | Buffer) => raw('POST', '/staff/probe/echo', { ...from('officerA'), ...headers }, body);
  const json = { 'content-type': 'application/json' };
  const good = '{"text":"x"}';

  it.each<[string, Record<string, string>, string | Buffer | undefined, number]>([
    ['JSON', json, good, 201],
    ['JSON in UTF-8', { 'content-type': 'application/json; charset=utf-8' }, good, 201],
    ['JSON, whatever the case of its type', { 'content-type': 'Application/JSON' }, good, 201],
    ['compressed JSON', { ...json, 'content-encoding': 'gzip' }, gzipSync(good), 201],
    ['no type', { 'content-length': String(good.length) }, good, 415],
    ['no type and no length', { 'transfer-encoding': 'chunked' }, good, 415],
    ['an empty type', { 'content-type': '' }, good, 415],
    ['a text', { 'content-type': 'text/plain' }, good, 415],
    ['a form', { 'content-type': 'application/x-www-form-urlencoded' }, 'text=x', 415],
    ['a file', { 'content-type': 'multipart/form-data; boundary=x' }, '--x--', 415],
    ['bytes', { 'content-type': 'application/octet-stream' }, good, 415],
    ['another kind of JSON', { 'content-type': 'application/vnd.api+json' }, good, 415],
    ['two types', { 'content-type': 'text/plain, application/json' }, good, 415],
    ['JSON in another alphabet', { 'content-type': 'application/json; charset=iso-8859-1' }, good, 415],
    ['an unknown compression', { ...json, 'content-encoding': 'zz' }, good, 415],
    ['nothing', {}, undefined, 422],
    ['nothing, as JSON', { ...json, 'content-length': '0' }, undefined, 422],
    ['a list', json, '[]', 422],
    ['a text in JSON', json, '"x"', 400],
    ['nothing in JSON', json, 'null', 400],
    ['half a body', json, '{"text":', 400],
    ['more than one megabyte', json, JSON.stringify({ text: 'x'.repeat(1_100_000) }), 413],
    ['more than one megabyte once uncompressed', { ...json, 'content-encoding': 'gzip' }, gzipSync(JSON.stringify({ text: 'x'.repeat(5_000_000) })), 413],
  ])('%s', async (_what, headers, body, status) => {
    const answer = await post(headers, body);
    expect(answer.status).toBe(status);
    if (status >= 400) expect(answer.body).toHaveProperty('code');
  });

  it('reach the route as the contract gives them: trimmed, completed, and without anything else', async () => {
    const answer = await post(json, '{"text":"  Bonjour  ","lines":[{"label":"a","price":1}],"creditorId":"x","__proto__":{"admin":true}}');
    expect(answer.body).toEqual({ text: 'Bonjour', flag: false, lines: [{ label: 'a' }] });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('name every wrong field by its place, never what was typed', async () => {
    const answer = await post(json, JSON.stringify({ text: SECRET.repeat(5), flag: SECRET, lines: [{ label: 'a' }, { label: '' }, { label: 1 }] }));
    expect(answer).toMatchObject({ status: 422, body: { code: 'INVALID', fields: ['text', 'flag', 'lines.1.label', 'lines.2.label'] } });
    expect(answer.text).not.toContain(SECRET);
    expect(test.logs.join('')).not.toContain(SECRET);
  });

  it('that are refused leave no transaction open behind them', async () => {
    const before = await count("pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'");
    await Promise.all(Array.from({ length: 20 }, () => post(json, '{}')));
    expect(await count("pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'")).toBe(before);
    expect((await post(json, good)).status).toBe(201);
  });

  it('with a character that PostgreSQL cannot keep are refused, not a failure', async () => {
    const answer = await raw(
      'POST',
      `/staff/sample/cases/${test.s.cases.ofA}/notes`,
      { ...from('officerA'), ...json, ...key() },
      JSON.stringify({ text: 'a\u0000b' }),
    );
    expect(answer.status).toBe(422);
  });
});

describe('errors', () => {
  const get = (path: string) => raw('GET', `/staff/probe/${path}`, from('officerA'));

  it('of PostgreSQL or Prisma on a value already taken answer 409, whichever way they come', async () => {
    for (const how of ['model', 'sql']) {
      const answer = await raw('POST', `/staff/probe/twice?with=${how}`, from('officerA'));
      expect(answer, how).toMatchObject({ status: 409, body: { code: 'CONFLICT' } });
      expect(Object.keys(answer.body as object), how).toEqual(['code']);
    }
    expect(await count("idempotency_keys WHERE route IN ('probe', $1)", [SECRET])).toBe(0);
    expect(test.logs.join('')).not.toContain(SECRET);
  });

  it('on a line that is not there answer 404', async () => {
    expect(await get('missing')).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });

  it('of NestJS keep their status, with a code and never their text', async () => {
    const answer = await get('teapot');
    expect(answer).toMatchObject({ status: 418, body: { code: 'INVALID_REQUEST' } });
    for (const path of ['teapot', 'broken', 'away']) expect((await get(path)).text, path).not.toContain(SECRET);
    expect(test.logs.join('')).not.toContain(SECRET);
  });

  it.each(['quoted', 'renamed'])('keep in the log the path of the code, and nothing of their message: %s', async (path) => {
    expect((await get(path)).status).toBe(500);
    const log = test.logs.join('');
    expect(log).toMatch(/http\.test\.ts:\d+:\d+/u);
    for (const hidden of ['Jean', 'KXPM', 'jean@', SECRET, 'refused\\n']) expect(log, hidden).not.toContain(hidden);
  });

  it('that the database answers to a value are told to the caller, and seen in the log', async () => {
    expect((await raw('GET', '/staff/sample/cases/not-an-identifier', from('officerA'))).status).toBe(404);
    const seen = test.logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === 'refused value');
    expect(seen).toMatchObject({ level: 40, databaseCode: expect.stringMatching(/^(22P02|P20\d\d)$/u) as string });
    expect(test.logs.join('')).not.toContain('not-an-identifier');
  });

  it('of NestJS that are failures of the API look like any other failure', async () => {
    const answer = await get('broken');
    expect(answer).toMatchObject({ status: 500, body: { code: 'INTERNAL', requestId: answer.headers['x-request-id'] } });
    expect(test.logs.join('')).toContain('unexpected error');
  });
});

describe('repeated requests', () => {
  const act = (id: string, value: string, as = 'officerA') => raw('POST', `/staff/probe/act/${id}`, { ...from(as), ...key(value) });
  const traces = async (id: string) => [
    await count("case_events WHERE kind = 'PROBE_ACT' AND case_id = $1", [id]),
    await count("audit_log WHERE action = 'PROBE_ACT' AND entity_id = $1", [id]),
    await count("outbox WHERE name = 'probe-act' AND payload ->> 'caseId' = $1", [id]),
  ];

  it('leave one line of history, of audit, and one task', async () => {
    const before = await traces(test.s.cases.ofA);
    const value = randomUUID();
    const answers = [...(await Promise.all([1, 2, 3].map(() => act(test.s.cases.ofA, value)))), await act(test.s.cases.ofA, value)];
    // Empty like the first one: neither `null` nor `{}`.
    expect(answers.map((answer) => [answer.status, answer.text])).toEqual(Array.from({ length: 4 }, () => [204, '']));
    expect(await traces(test.s.cases.ofA)).toEqual(before.map((number) => number + 1));
  });

  it('give back the same answer byte for byte, values and lists included', async () => {
    const value = randomUUID();
    const call = () => raw('PUT', '/staff/probe/value', { ...from('officerA'), ...key(value) });
    const answers = [...(await Promise.all([call(), call()])), await call()];
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200]);
    const [first] = answers;
    expect(first!.body).toMatchObject({ list: [1, 'deux', null], at: '1970-01-01T00:00:00.000Z' });
    for (const answer of answers) expect(answer.body).toEqual(first!.body);
    const other = await raw('PUT', '/staff/probe/value', { ...from('officerA'), ...key() });
    expect((other.body as { number: number }).number).toBe((first!.body as { number: number }).number + 1);
  });

  it('answer nothing again when there was nothing to answer', async () => {
    const value = randomUUID();
    const call = () => raw('DELETE', '/staff/probe/value', { ...from('officerA'), ...key(value) });
    const answers = [await call(), await call()];
    expect(answers.map((answer) => [answer.status, answer.text])).toEqual([
      [200, ''],
      [200, ''],
    ]);
    expect(await count("audit_log WHERE action = 'PROBE_REMOVED'")).toBe(1);
  });

  it('refuse the same key for the same body on another case, and do nothing there', async () => {
    const value = randomUUID();
    expect((await act(test.s.cases.ofA, value, 'manager')).status).toBe(204);
    const before = await traces(test.s.cases.unassigned);
    expect(await act(test.s.cases.unassigned, value, 'manager')).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_MISMATCH' } });
    expect(await raw('POST', `/staff/probe/act/${test.s.cases.ofA}?x=1`, { ...from('manager'), ...key(value) })).toMatchObject({
      status: 422,
      body: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    expect(await raw('PUT', '/staff/probe/value', { ...from('manager'), ...key(value) })).toMatchObject({ status: 422 });
    expect(await traces(test.s.cases.unassigned)).toEqual(before);
  });

  it('show a value once, even asked several times together', async () => {
    const value = randomUUID();
    const call = () => raw('POST', '/staff/probe/secret', { ...from('developer'), ...key(value) });
    const answers = await Promise.all([call(), call(), call(), call()]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409, 409, 409]);
    expect(answers.filter((answer) => answer.text.includes(SECRET))).toHaveLength(1);
    expect(answers.filter((answer) => answer.status === 409).map((answer) => answer.body)).toEqual(Array.from({ length: 3 }, () => ({ code: 'ALREADY_DONE' })));
    expect(await count("audit_log WHERE action = 'PROBE_SECRET'")).toBe(1);
    expect(await count('idempotency_keys WHERE key = $1 AND (result IS NOT NULL OR status <> 409)', [value])).toBe(0);
  });

  it('keep the keys of two people apart, at the same time', async () => {
    const value = randomUUID();
    const before = [await traces(test.s.cases.ofA), await traces(test.s.cases.ofB)];
    const answers = await Promise.all([
      act(test.s.cases.ofA, value, 'officerA'),
      act(test.s.cases.ofB, value, 'officerB'),
      act(test.s.cases.ofA, value, 'officerA'),
      act(test.s.cases.ofB, value, 'officerB'),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([204, 204, 204, 204]);
    expect([await traces(test.s.cases.ofA), await traces(test.s.cases.ofB)]).toEqual(before.map((traced) => traced.map((number) => number + 1)));
  });

  it('work the same for a creditor and a debtor, each with their own keys', async () => {
    const value = randomUUID();
    const partner = (as: string, id: string) => raw('POST', `/partner/probe/act/${id}`, { ...from(as, 'partner'), ...key(value) });
    const debtor = (as: string, id: string) => raw('POST', `/debtor/probe/act/${id}`, { ...from(as, 'debtor'), ...key(value) });
    const { ofA, ofB, unassigned } = test.s.cases;
    expect((await partner('partnerA', ofA)).status).toBe(204);
    expect((await partner('partnerA', ofA)).status).toBe(204);
    expect((await partner('partnerB', ofB)).status).toBe(204);
    expect((await debtor('debtorA', ofA)).status).toBe(204);
    expect((await debtor('debtorA', ofA)).status).toBe(204);
    // Never on the case of someone else, whatever the key.
    expect((await partner('partnerB', ofA)).status).toBe(422);
    expect((await raw('POST', `/partner/probe/act/${ofA}`, { ...from('partnerB', 'partner'), ...key() })).status).toBe(403);
    expect((await raw('POST', `/debtor/probe/act/${unassigned}`, { ...from('debtorA', 'debtor'), ...key() })).status).toBe(403);
    expect(await count("case_events WHERE kind = 'PROBE_PARTNER'")).toBe(2);
    expect(await count("case_events WHERE kind = 'PROBE_DEBTOR'")).toBe(1);
    for (const path of [`/partner/probe/act/${ofA}`, `/debtor/probe/act/${ofA}`]) {
      const portal = path.startsWith('/partner') ? 'partner' : 'debtor';
      expect(await raw('POST', path, from(`${portal}A`, portal))).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    }
  });

  it('need no key before signing in, and keep none', async () => {
    const before = await count('idempotency_keys');
    for (const headers of [{}, key(), key('not a key')]) {
      const answer = await raw('POST', '/debtor/probe/open', { origin: ORIGINS.debtor, ...headers });
      expect(answer).toMatchObject({ status: 201, body: { role: 'legarec_auth', key: null } });
    }
    // Signed in or not, such a route has the rights of a stranger.
    expect((await raw('POST', '/debtor/probe/open', { ...from('debtorA', 'debtor'), ...key() })).body).toEqual({ role: 'legarec_auth', key: null });
    expect(await count('idempotency_keys')).toBe(before);
  });

  it('need no key to read, and keep none', async () => {
    const before = await count('idempotency_keys');
    for (const value of [randomUUID(), 'not a key']) expect((await raw('GET', '/staff/sample/cases', { ...from('officerA'), ...key(value) })).status).toBe(200);
    expect(await count('idempotency_keys')).toBe(before);
  });

  it.each([
    '',
    '1',
    'x'.repeat(36),
    '00000000-0000-0000-0000-000000000000',
    randomUUID().toUpperCase(),
    `${randomUUID()},${randomUUID()}`,
    `${randomUUID()}'--`,
  ])('refuse the key %j', async (value) => {
    expect(await act(test.s.cases.ofA, value)).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('remember the model of the route, never its path', async () => {
    const value = randomUUID();
    await act(test.s.cases.ofA, value);
    expect(await rows('SELECT route, actor, status, result FROM idempotency_keys WHERE key = $1', [value])).toEqual([
      { route: 'POST /staff/probe/act/:id', actor: `user:${test.s.officerA}`, status: 200, result: null },
    ]);
  });

  it('never leave a digest that a copy of the database is enough to guess', async () => {
    const value = randomUUID();
    const body = { text: '123456' };
    const path = `/staff/sample/cases/${test.s.cases.ofA}/notes`;
    await raw('POST', path, { ...from('officerA'), ...key(value), 'content-type': 'application/json' }, JSON.stringify(body));
    const [kept] = await rows<{ request_hash: Buffer }>('SELECT request_hash FROM idempotency_keys WHERE key = $1', [value]);
    const guess = createHash('sha256')
      .update(JSON.stringify(['POST', path, body]))
      .digest();
    expect(kept!.request_hash).toHaveLength(32);
    expect(kept!.request_hash.equals(guess)).toBe(false);
  });

  it('are digested with a key of the server: the same request leaves another digest under another key', async () => {
    const digests: string[] = [];
    const value = randomUUID();
    const keys = [randomBytes(32), randomBytes(32)].map((bytes) => bytes.toString('base64'));
    // Same database, same person, same request, same key: only the key of the server differs.
    for (const SESSION_SIGNING_KEY of [...keys, keys[0]!]) {
      const other = await startApp([StaffProbeController], { env: { SESSION_SIGNING_KEY }, next: test });
      await other.call('DELETE', '/staff/probe/value', { as: 'officerA', headers: key(value) });
      const [kept] = await rows<{ request_hash: Buffer }>('SELECT request_hash FROM idempotency_keys WHERE key = $1', [value]);
      digests.push(kept!.request_hash.toString('hex'));
      await test.database.admin.query('DELETE FROM idempotency_keys WHERE key = $1', [value]);
      await other.stop();
    }
    expect(digests[0]).toBe(digests[2]);
    expect(digests[0]).not.toBe(digests[1]);
  });

  it('survive the renewal of that key, for as long as the previous one is there', async () => {
    const [first, second] = [randomBytes(32), randomBytes(32)].map((bytes) => bytes.toString('base64')) as [string, string];
    const value = randomUUID();
    const answers: { status: number; body: unknown }[] = [];
    for (const env of [{ SESSION_SIGNING_KEY: first }, { SESSION_SIGNING_KEY: second, SESSION_SIGNING_KEY_PREVIOUS: first }, { SESSION_SIGNING_KEY: second }]) {
      const app = await startApp([StaffProbeController], { env: env as Record<string, string>, next: test });
      const { status, body } = await app.call('PUT', '/staff/probe/value', { as: 'officerA', headers: key(value) });
      answers.push({ status, body });
      await app.stop();
    }
    expect(answers[0]!.status).toBe(200);
    // The same answer, not a second effect.
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_MISMATCH' } });
  });

  it('keep their answer encrypted, bound to their key', async () => {
    const value = randomUUID();
    const answer = await raw('PUT', '/staff/probe/value', { ...from('officerA'), ...key(value) });
    expect(answer.status).toBe(200);
    const [kept] = await rows<{ result: Buffer }>('SELECT result FROM idempotency_keys WHERE key = $1', [value]);
    expect(kept!.result.toString('latin1')).not.toContain('deux');
    // Moved to another key, it no longer opens: nothing of it is given back.
    const other = randomUUID();
    await raw('PUT', '/staff/probe/value', { ...from('officerA'), ...key(other) });
    await test.database.admin.query('UPDATE idempotency_keys SET result = $2 WHERE key = $1', [other, kept!.result]);
    expect((await raw('PUT', '/staff/probe/value', { ...from('officerA'), ...key(other) })).status).toBe(500);
  });

  it('need no key, and keep none, for what commits nothing', async () => {
    const before = await count('idempotency_keys');
    const answer = await raw('POST', '/staff/probe/echo', { ...from('officerA'), ...key(), 'content-type': 'application/json' }, JSON.stringify({ text: 'x' }));
    expect(answer.status).toBe(201);
    expect(await count('idempotency_keys')).toBe(before);
  });

  it('free their key after two days', async () => {
    const value = randomUUID();
    const before = await traces(test.s.cases.ofA);
    const again = async (hours: number) => {
      await test.database.admin.query('UPDATE idempotency_keys SET created_at = now() - make_interval(hours => $2) WHERE key = $1', [value, hours]);
      expect((await act(test.s.cases.ofA, value)).status).toBe(204);
    };
    await act(test.s.cases.ofA, value);
    await again(47);
    expect(await traces(test.s.cases.ofA)).toEqual(before.map((number) => number + 1));
    await again(49);
    expect(await traces(test.s.cases.ofA)).toEqual(before.map((number) => number + 2));
  });
});

describe('several people at the same time', () => {
  it('each read their own cases, and nothing else', async () => {
    const { ofA, ofB, unassigned, ofDirector } = test.s.cases;
    const people: [string, keyof typeof ORIGINS, string, string[]][] = [
      ['partnerA', 'partner', '/partner/sample/cases', [ofA, unassigned]],
      ['partnerB', 'partner', '/partner/sample/cases', [ofB, ofDirector]],
      ['debtorA', 'debtor', '/debtor/sample/cases', [ofA, ofB]],
      ['debtorB', 'debtor', '/debtor/sample/cases', [unassigned]],
      ['officerA', 'staff', '/staff/sample/cases', [ofA]],
      ['officerB', 'staff', '/staff/sample/cases', [ofB]],
      ['developer', 'staff', '/staff/sample/cases', []],
      ['director', 'staff', '/staff/sample/cases', [ofA, ofB, unassigned, ofDirector]],
    ];
    const answers = await Promise.all(
      Array.from({ length: 96 }, async (_, index) => {
        const [as, portal, path, expected] = people[index % people.length]!;
        const answer = await raw('GET', path, from(as, portal));
        return { as, expected, status: answer.status, ids: (JSON.parse(answer.text) as { id: string }[]).map((row) => row.id) };
      }),
    );
    for (const { as, expected, status, ids } of answers) {
      expect(status, as).toBe(200);
      expect(ids.sort(), as).toEqual([...expected].sort());
    }
  });
});

describe('delegation', () => {
  const act = (as: string) => raw('POST', '/staff/probe/late/x', from(as));
  const lines = () =>
    rows<{ actor_label: string; on_behalf_of_id: string | null }>(
      "SELECT actor_label, on_behalf_of_id FROM audit_log WHERE action = 'PROBE_DELEGATED' ORDER BY occurred_at",
    );
  const withdraw = () =>
    test.database.admin.query("UPDATE delegations SET withdrawn_at = now(), withdrawn_by = $1 WHERE kind = 'ADMINISTRATIVE' AND withdrawn_at IS NULL", [
      test.s.director,
    ]);
  const give = () => test.database.admin.query("INSERT INTO delegations (kind, granted_by) VALUES ('ADMINISTRATIVE', $1)", [test.s.director]);

  it('withdrawn during the session: nothing more is noted on behalf of the Director', async () => {
    expect((await act('manager')).status).toBe(204);
    await withdraw();
    try {
      await act('manager');
      expect((await lines()).filter((line) => line.on_behalf_of_id !== null)).toHaveLength(1);
    } finally {
      await give();
    }
    expect((await act('manager')).status).toBe(204);
    expect((await lines()).at(-1)).toEqual({ actor_label: 'Remi Test', on_behalf_of_id: test.s.director });
  });

  it('withdrawn during the session: the action itself is refused, even when it would leave no trace', async () => {
    const quiet = (as: string) => raw('POST', '/staff/probe/quiet', from(as));
    expect((await quiet('manager')).status).toBe(201);
    await withdraw();
    try {
      expect((await act('manager')).status).toBe(403);
      expect((await quiet('manager')).status).toBe(403);
      expect((await quiet('director')).status).toBe(201);
    } finally {
      await give();
    }
  });
});

describe('address of the caller', () => {
  const seen = async (forwarded: string) => {
    await raw('POST', '/staff/sample/settings', { ...from('director'), 'x-forwarded-for': forwarded });
    return (await rows<{ ip: string }>("SELECT host(ip) AS ip FROM audit_log WHERE action = 'SETTING_CHANGED' ORDER BY occurred_at DESC LIMIT 1"))[0]!.ip;
  };
  it('is the last one written by the proxy, in both families', async () => {
    expect(await seen('2001:db8::1')).toBe('2001:db8::1');
    expect(await seen('10.0.0.1, 203.0.113.7')).toBe('203.0.113.7');
    expect(await seen('203.0.113.7, 2001:db8::2')).toBe('2001:db8::2');
  });
  it('is not taken from any other header', async () => {
    await raw('POST', '/staff/sample/settings', {
      ...from('director'),
      'x-real-ip': '203.0.113.9',
      forwarded: 'for=203.0.113.9',
      'cf-connecting-ip': '203.0.113.9',
    });
    expect((await rows<{ ip: string }>('SELECT host(ip) AS ip FROM audit_log ORDER BY occurred_at DESC LIMIT 1'))[0]).toEqual({ ip: '127.0.0.1' });
  });
  it('never makes a request fail when it is not an address', async () => {
    for (const forwarded of ['unknown', 'fe80::1%eth0', '203.0.113.7:4000', ''])
      expect((await raw('POST', '/staff/sample/settings', { ...from('director'), 'x-forwarded-for': forwarded })).status, forwarded).toBe(204);
  });
});

describe('log of the requests', () => {
  /** Lines of that request only: the one before may still be writing its own. */
  const lines = async (answer: Answer) => {
    const found = () =>
      test.logs.map((text) => JSON.parse(text) as Record<string, unknown>).filter((entry) => entry.requestId === answer.headers['x-request-id']);
    await until(() => found().length > 0);
    return found();
  };

  it('has one line per request, with its answer and the kind of its author only', async () => {
    const answer = await raw('GET', `/staff/sample/cases/${test.s.cases.ofA}?name=${SECRET}`, { ...from('officerA'), 'user-agent': SECRET });
    expect(await lines(answer)).toEqual([
      {
        level: 30,
        time: expect.any(String) as string,
        requestId: answer.headers['x-request-id'],
        method: 'GET',
        route: '/staff/sample/cases/:id',
        status: 200,
        ms: expect.any(Number) as number,
        actor: 'staff',
        msg: 'request',
      },
    ]);
  });

  it('gives the status really sent, when the request ends in an error', async () => {
    const answer = await raw('GET', `/staff/sample/cases/${randomUUID()}`, from('officerA'));
    expect(await lines(answer)).toMatchObject([{ route: '/staff/sample/cases/:id', status: 404, actor: 'staff' }]);
  });

  it('tells a caller who left before the answer from one who received it', async () => {
    const left = new Promise<void>((resolve) => {
      const request = http.request({ host: base.hostname, port: base.port, path: '/staff/probe/slow', headers: from('officerA') });
      request.on('error', () => resolve());
      request.end();
      setTimeout(() => request.destroy(), 100);
    });
    await left;
    const statuses = () => test.logs.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.route === '/staff/probe/slow');
    for (let i = 0; i < 40 && !statuses().length; i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(statuses().map((line) => line.status)).toEqual([499]);
    expect((await raw('GET', '/staff/probe/slow', from('officerA'))).status).toBe(200);
    await until(() => statuses().length === 2);
    expect(statuses().map((line) => line.status)).toEqual([499, 200]);
  });

  it.each<[string, () => Promise<Answer>, number]>([
    ['a stranger', () => raw('GET', '/staff/sample/cases', { origin: ORIGINS.staff }), 401],
    ['the wrong person', () => raw('GET', '/staff/sample/cases', from('partnerA')), 403],
    ['another portal', () => raw('GET', '/staff/sample/cases', from('officerA', 'partner')), 403],
    ['an unknown route', () => raw('GET', '/staff/unknown', from('officerA')), 404],
    ['an unknown prefix', () => raw('GET', '/STAFF/sample/cases', from('officerA')), 404],
    ['a body of another type', () => raw('POST', '/staff/probe/echo', { ...from('officerA'), 'content-type': 'text/plain' }, 'x'), 415],
  ])('has a line for %s', async (_what, request, status) => {
    const answer = await request();
    expect(answer.status).toBe(status);
    expect(await lines(answer)).toMatchObject([{ status }]);
  });
});

describe('state of the API', () => {
  it.each(['PostgreSQL', 'Valkey'])('is « unavailable » without %s, and says nothing else', async (service) => {
    const failure = new Error(`redis://:${SECRET}@127.0.0.1`);
    const away =
      service === 'Valkey'
        ? vi.spyOn(test.app.get<Valkey>(VALKEY), 'ping').mockRejectedValueOnce(failure)
        : vi.spyOn(test.app.get(Database), 'ping').mockRejectedValueOnce(failure);
    const answer = await raw('GET', '/health');
    expect(away).toHaveBeenCalledOnce();
    expect(answer).toMatchObject({ status: 503, text: '{"code":"UNAVAILABLE"}' });
    expect(test.logs.join('')).not.toContain(SECRET);
    expect(await raw('GET', '/health')).toMatchObject({ status: 200, body: { status: 'ok' } });
  });

  it('is really asked to both services', async () => {
    const postgres = vi.spyOn(test.app.get(Database), 'ping');
    const valkey = vi.spyOn(test.app.get<Valkey>(VALKEY), 'ping');
    await raw('GET', '/health');
    expect([postgres.mock.calls.length, valkey.mock.calls.length]).toEqual([1, 1]);
    vi.restoreAllMocks();
  });
});
