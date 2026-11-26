import { createHash } from 'node:crypto';
import { Inject, Injectable, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AppRequest } from '../access/access.guard';
import { CONFIG, type Config } from '../config/config';
import { deriveKey, digest, Keyring, sameDigest } from '../crypto/keyring';
import { Database, type Transaction } from '../database/database';
import { ApiError, conflict } from '../errors/api-error';

export const NO_TRANSACTION = Symbol('legarec:no-transaction');
export const COMMITS = Symbol('legarec:commits');
const ONE_TIME = Symbol('legarec:one-time');

/** The handler opens its own transactions: a failed sign-in must stay counted although it ends in an error. */
export const NoTransaction = () => SetMetadata(NO_TRANSACTION, true);
/** Commits the firm, or must not happen twice: the request must carry an `Idempotency-Key`. */
export const Commits = () => SetMetadata(COMMITS, true);
/** Answers a value shown only once (password, recovery codes…): it is never stored, a repeat is refused. */
export const OneTimeAnswer = () => SetMetadata(ONE_TIME, true);

/** Portals whose callers can hold a key. */
export const KEYED_PORTALS = new Set(['staff', 'partner', 'debtor', 'service']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DONE = 200;
const DONE_ONCE = 409;

/** One request, one transaction, one actor. A repeated request with the same key has a single effect. */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  /** The current key, then the previous one while it is being renewed. */
  private readonly requestKeys: readonly [Buffer, ...Buffer[]];
  private readonly answers: Keyring;

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(CONFIG) config: Config,
  ) {
    const derived = (usage: string): [Buffer, ...Buffer[]] => {
      const of = (value: string) => deriveKey(Buffer.from(value, 'base64'), usage);
      return [of(config.SESSION_SIGNING_KEY), ...(config.SESSION_SIGNING_KEY_PREVIOUS ? [of(config.SESSION_SIGNING_KEY_PREVIOUS)] : [])];
    };
    // A body may hold a password or a code: its digest is keyed, so that a copy of the table guesses nothing.
    this.requestKeys = derived('idempotency-request');
    const [current, ...previous] = derived('idempotency-answer');
    this.answers = new Keyring(current, previous);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const flag = (name: symbol) => this.reflector.getAllAndOverride<boolean | undefined>(name, targets) === true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (flag(NO_TRANSACTION)) return next.handle();
    // Readings and harmless changes carry no key: nothing of them is ever kept.
    const key = flag(COMMITS) ? this.keyOf(request) : null;
    const oneTime = flag(ONE_TIME);
    return from(
      this.database.run(request.actor, async (tx) => {
        if (!key) return lastValueFrom(next.handle(), { defaultValue: undefined });
        const replay = await this.claim(tx, key, request);
        if (replay) return replay.result;
        const result: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
        const kept = oneTime || result === undefined ? null : this.answers.encrypt(JSON.stringify(result), this.binding(key));
        await tx.$executeRaw`
          UPDATE idempotency_keys SET status = ${oneTime ? DONE_ONCE : DONE}, result = ${kept} WHERE actor = app.actor_key() AND key = ${key}::uuid`;
        return result;
      }),
    );
  }

  private binding(key: string) {
    return { table: 'idempotency_keys', id: key, column: 'result' };
  }

  private keyOf(request: AppRequest): string {
    const header = request.headers['idempotency-key'];
    if (typeof header === 'string' && UUID.test(header)) return header;
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  }

  /** Takes the key, or waits for the request that holds it and gives back its answer. A key older than two days is free again. */
  private async claim(tx: Transaction, key: string, request: AppRequest): Promise<{ result: unknown } | null> {
    const route = `${request.method} ${(request.route as { path: string }).path}`;
    // A file counts by its fingerprint: never turned into a list of numbers in memory.
    const body: unknown = request.body ?? null;
    const asked = JSON.stringify([
      request.method,
      request.originalUrl,
      Buffer.isBuffer(body) ? { sha256: createHash('sha256').update(body).digest('hex') } : body,
    ]);
    const hash = digest(this.requestKeys[0], asked);
    const taken = await tx.$executeRaw`
      INSERT INTO idempotency_keys AS k (actor, key, route, request_hash) VALUES (app.actor_key(), ${key}::uuid, ${route}, ${hash})
      ON CONFLICT (actor, key) DO UPDATE SET route = EXCLUDED.route, request_hash = EXCLUDED.request_hash, status = NULL, result = NULL, created_at = now()
      WHERE k.created_at < now() - interval '48 hours'`;
    if (taken === 1) return null;
    const [known] = await tx.$queryRaw<{ request_hash: Uint8Array; status: number | null; result: Uint8Array | null }[]>`
      SELECT request_hash, status, result FROM idempotency_keys WHERE actor = app.actor_key() AND key = ${key}::uuid`;
    if (!known || known.status === null) throw conflict('IN_PROGRESS');
    if (!this.requestKeys.some((requestKey) => sameDigest(digest(requestKey, asked), known.request_hash))) throw new ApiError(422, 'IDEMPOTENCY_MISMATCH');
    if (known.status === DONE_ONCE) throw conflict('ALREADY_DONE');
    return { result: known.result ? JSON.parse(this.answers.decrypt(known.result, this.binding(key)).toString()) : undefined };
  }
}
