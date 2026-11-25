import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, NestLogger } from './logger';

function capture(level = 'debug') {
  const lines: string[] = [];
  const logger = createLogger(level, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString()), done()) }));
  return { logger, text: () => lines.join(''), last: () => JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown> };
}
const SECRET = 'zz secret zz';
/** Whatever its name and its depth, what is not a listed technical fact is left out. */
const FIELDS = [
  ...'password newPassword code accessCode token secret value email to recipient phone mobile iban bic siren name firstName lastName first_name last_name'.split(
    ' ',
  ),
  ...'address text subject body cookie set-cookie authorization reference external_reference actor_label ip url path query headers apiKey VAULT_MASTER_KEY'.split(
    ' ',
  ),
];

describe('fields of a line', () => {
  it.each(FIELDS)('never hold %s, wherever it is found', (field) => {
    const { logger, text, last } = capture();
    const own = { [field]: SECRET };
    for (const fields of [
      own,
      { user: own },
      { a: { b: { c: own } } },
      { users: [own] },
      { batch: { users: [{ ...own }] } },
      { [field]: { inside: SECRET } },
      { [field]: [SECRET] },
    ]) {
      logger.info({ ...fields, status: 200 }, 'event');
      expect(last()).toMatchObject({ status: 200, msg: 'event' });
    }
    expect(text()).not.toContain(SECRET);
    expect(text()).not.toContain(`"${field}"`);
  });

  it('hold the listed facts only, when they look technical', () => {
    const { logger, last } = capture();
    logger.info(
      { requestId: 'b83f201f-9d2a-459b-8c7f-5acbf2322ca5', method: 'GET', route: '/staff/cases/:id', status: 200, ms: 12, actor: 'staff', other: 1 },
      'request',
    );
    expect(Object.keys(last()).sort()).toEqual(['actor', 'level', 'method', 'ms', 'msg', 'requestId', 'route', 'status', 'time']);
    for (const value of ['jean@exemple.test', 'Jean Martin', '+33612345678', 'x'.repeat(200), { who: 'x' }, ['x'], null]) {
      logger.info({ route: value, errorType: value }, 'event');
      expect(Object.keys(last()).sort()).toEqual(['level', 'msg', 'time']);
    }
  });

  it('never hold a request nor an answer given whole', () => {
    const { logger, text } = capture();
    logger.info({ req: { url: `/x?token=${SECRET}`, headers: { cookie: SECRET } }, res: { headers: { 'set-cookie': SECRET } } }, 'event');
    expect(text()).not.toContain(SECRET);
  });
});

describe('errors in the log', () => {
  const error = () => new TypeError(`refused for ${SECRET}`, { cause: new Error(SECRET) });

  it('are described by their type, never by their message', () => {
    const { logger, text, last } = capture();
    logger.error({ err: error() }, 'failed');
    expect(last()).toMatchObject({ errorType: 'TypeError', msg: 'failed' });
    logger.error({ error: error() }, 'failed');
    expect(last()).toMatchObject({ errorType: 'TypeError' });
    logger.error(error(), 'failed');
    expect(last()).toMatchObject({ errorType: 'TypeError', msg: 'failed' });
    logger.error({ err: error() });
    logger.error(error());
    expect(last()).toMatchObject({ errorType: 'TypeError', msg: 'event' });
    logger.error({ err: SECRET }, 'failed');
    expect(text()).not.toContain(SECRET);
  });
});

describe('lines of the log', () => {
  it('carry the time in UTC, and nothing about the machine', () => {
    const { logger, last } = capture();
    logger.info({ status: 1 }, 'hello');
    expect(Object.keys(last()).sort()).toEqual(['level', 'msg', 'status', 'time']);
    expect(last().time).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
  });

  it('never build their text from a value', () => {
    const { logger, text, last } = capture();
    logger.info('sent to %s');
    expect(last().msg).toBe('sent to %s');
    // @ts-expect-error no further argument: nothing to interpolate
    logger.info({ status: 1 }, 'sent to %s', SECRET);
    expect(last().msg).toBe('sent to %s');
    // Nothing to derive either: a child would carry its own fields.
    expect(Object.keys(logger).sort()).toEqual(['debug', 'error', 'info', 'warn']);
    expect(text()).not.toContain(SECRET);
  });

  it('follow the level asked for', () => {
    const { logger, text } = capture('warn');
    logger.info('info');
    logger.warn('warn');
    expect(text()).not.toContain('info');
    expect(text()).toContain('warn');
  });

  it('of NestJS go to the same log: their place, never their text', () => {
    const { logger, text, last } = capture();
    const nest = new NestLogger(logger);
    nest.log(`started ${SECRET}`, 'NestFactory');
    expect(last()).toMatchObject({ level: 20, context: 'NestFactory', msg: 'framework' });
    nest.warn({ email: SECRET }, 'Router');
    expect(last()).toMatchObject({ level: 40, context: 'Router', msg: 'framework' });
    nest.error(new Error(SECRET), `Error: ${SECRET}\n    at somewhere`, 'ExceptionsHandler');
    expect(last()).toMatchObject({ level: 50, context: 'ExceptionsHandler', msg: 'framework' });
    nest.debug(SECRET);
    expect(last()).toMatchObject({ level: 20, msg: 'framework' });
    expect(text()).not.toContain(SECRET);
  });
});
