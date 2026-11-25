import { Inject, Injectable, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { from, lastValueFrom, type Observable } from 'rxjs';
import type { AppRequest } from '../access/access.guard';
import { Database, type Transaction } from '../database/database';
import { ApiError, conflict } from '../errors/api-error';

const NO_TRANSACTION = Symbol('legarec:no-transaction');
const COMMITS = Symbol('legarec:commits');
const ONE_TIME = Symbol('legarec:one-time');

/** The handler opens its own transactions: a failed sign-in must stay counted although it ends in an error. */
export const NoTransaction = () => SetMetadata(NO_TRANSACTION, true);
/** Commits the firm (sending, payment, deposit…): the request must carry an `Idempotency-Key`. */
export const Commits = () => SetMetadata(COMMITS, true);
/** Answers a value shown only once (password, recovery codes…): it is never stored, a repeat is refused. */
export const OneTimeAnswer = () => SetMetadata(ONE_TIME, true);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KEYED = new Set(['staff', 'partner', 'debtor']);

/** One request, one transaction, one actor. A repeated request with the same key has a single effect. */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const flag = (name: symbol) => this.reflector.getAllAndOverride<boolean | undefined>(name, targets) === true;
    const request = context.switchToHttp().getRequest<AppRequest>();
    if (flag(NO_TRANSACTION)) return next.handle();
    const key = this.keyOf(request, flag(COMMITS));
    const oneTime = flag(ONE_TIME);
    return from(
      this.database.run(
        request.actor,
        async (tx) => {
          if (!key) return lastValueFrom(next.handle(), { defaultValue: undefined });
          const replay = await this.claim(tx, key, request);
          if (replay) return replay.result;
          const result: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = ${oneTime ? 409 : 200}, result = ${oneTime || result === undefined ? null : JSON.stringify(result)}::jsonb
            WHERE actor = app.actor_key() AND key = ${key}::uuid`;
          return result;
        },
        { requestId: request.requestId, ip: request.ip },
      ),
    );
  }

  private keyOf(request: AppRequest, required: boolean): string | null {
    const header = request.headers['idempotency-key'];
    if (request.method === 'GET' || !KEYED.has(request.actor.kind)) return null;
    if (typeof header === 'string' && UUID.test(header)) return header;
    if (header !== undefined || required) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED');
    return null;
  }

  /** Takes the key, or waits for the request that holds it and gives back its answer. */
  private async claim(tx: Transaction, key: string, request: AppRequest): Promise<{ result: unknown } | null> {
    const route = `${request.method} ${request.baseUrl}${(request.route as { path: string }).path}`;
    const hash = createHash('sha256')
      .update(JSON.stringify([request.method, request.originalUrl, request.body ?? null]))
      .digest();
    const taken = await tx.$executeRaw`
      INSERT INTO idempotency_keys (actor, key, route, request_hash) VALUES (app.actor_key(), ${key}::uuid, ${route}, ${hash}) ON CONFLICT DO NOTHING`;
    if (taken === 1) return null;
    const [known] = await tx.$queryRaw<{ request_hash: Uint8Array; status: number | null; result: unknown }[]>`
      SELECT request_hash, status, result FROM idempotency_keys WHERE actor = app.actor_key() AND key = ${key}::uuid`;
    if (!known || known.status === null) throw conflict('IN_PROGRESS');
    if (!hash.equals(known.request_hash)) throw new ApiError(422, 'IDEMPOTENCY_MISMATCH');
    if (known.status === 409) throw conflict('ALREADY_DONE');
    return { result: known.result ?? undefined };
  }
}
