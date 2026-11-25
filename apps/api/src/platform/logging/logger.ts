import type { LoggerService } from '@nestjs/common';
import { pino, type DestinationStream } from 'pino';

type Level = 'debug' | 'info' | 'warn' | 'error';
/** The whole surface of the log: nothing to derive, bind or format. */
export type AppLogger = Record<Level, (first: Record<string, unknown> | Error | string, message?: string) => void>;
export const LOGGER = Symbol('LOGGER');

/** The only fields ever written: technical facts. Anything else, at any depth, is left out. */
const ALLOWED = new Set([
  'requestId',
  'method',
  'route',
  'status',
  'ms',
  'actor',
  'queue',
  'task',
  'taskId',
  'attempt',
  'errorType',
  'databaseCode',
  'stack',
  'context',
  'port',
  'environment',
  'letters',
  'ai',
  'kind',
  'removed',
  'count',
]);
/** Words, paths of our own code, numbers: nothing that looks like a sentence, an address or a name. */
const TECHNICAL = /^[A-Za-z0-9_.:/*-]{0,120}$/u;

function technical(name: string, value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (name === 'stack') return value;
  return TECHNICAL.test(value) ? value : undefined;
}

function keep(fields: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value instanceof Error) kept.errorType = technical('errorType', value.name);
    else if (ALLOWED.has(name)) kept[name] = technical(name, value);
  }
  return kept;
}

export function createLogger(level: string, destination?: DestinationStream): AppLogger {
  const logger = pino({ level, base: undefined, timestamp: () => `,"time":"${new Date().toISOString()}"` }, destination as DestinationStream);
  // An error is described by its type, never by its message: it may quote what was typed, or a row.
  const write = (name: Level) => (first: Record<string, unknown> | Error | string, message?: string) => {
    if (typeof first === 'string') logger[name]({}, first);
    else logger[name](first instanceof Error ? keep({ error: first }) : keep(first), message ?? 'event');
  };
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') };
}

/** Sends the messages of NestJS itself to the same log: where they come from, never what they quote. */
export class NestLogger implements LoggerService {
  constructor(private readonly logger: AppLogger) {}
  private write(level: 'info' | 'error' | 'warn' | 'debug', rest: unknown[]) {
    this.logger[level]({ context: rest.findLast((item) => typeof item === 'string' && TECHNICAL.test(item)) }, 'framework');
  }
  log(_message: unknown, ...rest: unknown[]) {
    this.write('debug', rest);
  }
  error(_message: unknown, ...rest: unknown[]) {
    this.write('error', rest);
  }
  warn(_message: unknown, ...rest: unknown[]) {
    this.write('warn', rest);
  }
  debug(_message: unknown, ...rest: unknown[]) {
    this.write('debug', rest);
  }
  verbose() {}
}
