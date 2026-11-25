import type { LoggerService } from '@nestjs/common';
import { pino, type DestinationStream, type Logger } from 'pino';

export type AppLogger = Logger;
export const LOGGER = Symbol('LOGGER');

/** Never logged, wherever they appear: the logs hold no personal data, no code and no secret. */
const HIDDEN = [
  'password',
  'code',
  'accessCode',
  'token',
  'secret',
  'value',
  'email',
  'phone',
  'mobile',
  'iban',
  'bic',
  'siren',
  'name',
  'firstName',
  'lastName',
  'address',
  'text',
  'subject',
  'body',
  'cookie',
  'authorization',
  'reference',
  'ip',
];

export function createLogger(level: string, destination?: DestinationStream): AppLogger {
  return pino(
    {
      level,
      base: undefined,
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      redact: { paths: HIDDEN.flatMap((name) => [name, `*.${name}`, `*.*.${name}`]), remove: true },
      // An error is described by its type and its place, never by its message.
      serializers: { err: (error: unknown) => ({ type: (error as Error)?.name }), req: () => undefined, res: () => undefined },
    },
    destination as DestinationStream,
  );
}

/** Sends the messages of NestJS itself to the same log. */
export class NestLogger implements LoggerService {
  constructor(private readonly logger: AppLogger) {}
  private write(level: 'info' | 'error' | 'warn' | 'debug', message: unknown, rest: unknown[]) {
    this.logger[level](
      { context: rest.findLast((item) => typeof item === 'string' && !item.includes('\n')) },
      typeof message === 'string' ? message : 'framework',
    );
  }
  log(message: unknown, ...rest: unknown[]) {
    this.write('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write('debug', message, rest);
  }
  verbose() {}
}
