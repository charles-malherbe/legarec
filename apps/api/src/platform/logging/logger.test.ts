import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, NestLogger } from './logger';

function capture(level = 'debug') {
  const lines: string[] = [];
  const logger = createLogger(level, new Writable({ write: (chunk: Buffer, _encoding, done) => (lines.push(chunk.toString()), done()) }));
  return { logger, text: () => lines.join(''), last: () => JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown> };
}
const SECRET = 'zz-secret-zz';
/** Every field that must never be written, whatever the object it is found in. */
const FIELDS =
  'password code accessCode token secret value email phone mobile iban bic siren name firstName lastName address text subject body cookie authorization reference ip'.split(
    ' ',
  );

describe('fields that are never logged', () => {
  it.each(FIELDS)('%s, alone, in an object, two levels down and in a list', (field) => {
    const { logger, text, last } = capture();
    const own = { [field]: SECRET };
    logger.info({ ...own, kept: 1 }, 'alone');
    expect(last()).toMatchObject({ kept: 1, msg: 'alone' });
    logger.info({ user: { ...own, kept: 1 } }, 'in an object');
    expect(last()).toMatchObject({ user: { kept: 1 } });
    logger.info({ request: { user: { ...own, kept: 1 } } }, 'two levels down');
    expect(last()).toMatchObject({ request: { user: { kept: 1 } } });
    logger.info({ users: [{ ...own, kept: 1 }, own] }, 'in a list');
    expect(last()).toMatchObject({ users: [{ kept: 1 }, {}] });
    logger.info({ [field]: { inside: SECRET } }, 'as an object');
    logger.info({ [field]: [SECRET] }, 'as a list');
    expect(text()).not.toContain(SECRET);
    expect(text()).not.toContain(`"${field}"`);
  });

  it('nor by a logger made for one request', () => {
    const { logger, text, last } = capture();
    logger.child({ email: SECRET, user: { name: SECRET, kept: 1 } }).info('hello');
    expect(last()).toMatchObject({ user: { kept: 1 }, msg: 'hello' });
    expect(text()).not.toContain(SECRET);
  });

  it('nor in a request or an answer given whole', () => {
    const { logger, text } = capture();
    logger.info({ req: { url: `/x?token=${SECRET}`, headers: { cookie: SECRET } }, res: { headers: { 'set-cookie': SECRET } } }, 'x');
    expect(text()).not.toContain(SECRET);
  });

  // Defect: the paths of the list stop at the third level, whereas it says « wherever they appear ».
  it.fails('nor three levels down', () => {
    const { logger, text } = capture();
    logger.info({ a: { b: { c: { email: SECRET } } } }, 'x');
    expect(text()).not.toContain(SECRET);
  });
  it.fails('nor in a list inside of an object', () => {
    const { logger, text } = capture();
    logger.info({ batch: { users: [{ email: SECRET }] } }, 'x');
    expect(text()).not.toContain(SECRET);
  });
  // Defect: a row of PostgreSQL read in SQL has names in lower case with underscores.
  it.fails.each(['first_name', 'last_name', 'access_code', 'external_reference', 'actor_label', 'set-cookie', 'idempotency-key'])(
    'nor the column or the header %s',
    (field) => {
      const { logger, text } = capture();
      logger.info({ row: { [field]: SECRET } }, 'x');
      expect(text()).not.toContain(SECRET);
    },
  );
});

describe('errors in the log', () => {
  const error = () => new TypeError(`refused for ${SECRET}`, { cause: new Error(SECRET) });

  it('are described by their type, never by their message', () => {
    const { logger, text, last } = capture();
    logger.error({ err: error() }, 'failed');
    expect(last()).toMatchObject({ err: { type: 'TypeError' }, msg: 'failed' });
    expect(last().err).toEqual({ type: 'TypeError' });
    logger.error({ error: error() }, 'failed');
    logger.error(error(), 'failed');
    logger.error({ err: SECRET }, 'failed');
    expect(text()).not.toContain(SECRET);
  });

  // Defect: without a text of its own, pino takes the message of the error as the text of the line.
  it.fails('are still not quoted by a line without text', () => {
    const { logger, text } = capture();
    logger.error({ err: error() });
    expect(text()).not.toContain(SECRET);
  });
  it.fails('are still not quoted when they are the only thing given', () => {
    const { logger, text } = capture();
    logger.error(error());
    expect(text()).not.toContain(SECRET);
  });
});

describe('lines of the log', () => {
  it('carry the time in UTC, and nothing about the machine', () => {
    const { logger, last } = capture();
    logger.info({ kept: 1 }, 'hello');
    expect(Object.keys(last()).sort()).toEqual(['kept', 'level', 'msg', 'time']);
    expect(last().time).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u);
  });

  it('follow the level asked for', () => {
    const { logger, text } = capture('warn');
    logger.info('info');
    logger.warn('warn');
    expect(text()).not.toContain('info');
    expect(text()).toContain('warn');
  });

  it('of NestJS go to the same log: a text and its place, never an object', () => {
    const { logger, text, last } = capture();
    const nest = new NestLogger(logger);
    nest.log('started', 'NestFactory');
    expect(last()).toMatchObject({ level: 30, context: 'NestFactory', msg: 'started' });
    nest.warn({ email: SECRET }, 'Router');
    expect(last()).toMatchObject({ level: 40, context: 'Router', msg: 'framework' });
    nest.error(new Error(SECRET), `Error: ${SECRET}\n    at somewhere`, 'ExceptionsHandler');
    expect(last()).toMatchObject({ level: 50, context: 'ExceptionsHandler', msg: 'framework' });
    nest.debug('detail');
    expect(last()).toMatchObject({ level: 20, msg: 'detail' });
    expect(text()).not.toContain(SECRET);
  });
});
