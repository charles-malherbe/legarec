import type { DebtorIdentifier } from '@legarec/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Actor } from '../../platform/database/actor';
import { Database } from '../../platform/database/database';
import { ApiError } from '../../platform/errors/api-error';
import { cookies, isBackground, requestFacts } from '../../platform/http/context';
import { RateLimits } from '../../platform/limits/rate-limits';
import { AuthKeys } from './keys';

const COOKIE = 'debtor';
/** Sessions: 12 hours at most, 30 minutes without a request (both in the database); « Se souvenir de moi » keeps the cookie 30 days. */
const REMEMBERED_S = 30 * 24 * 3600;
/** Twenty tries over the last hour from one network (bloc /64 in IPv6), whatever the identifier. */
const TRIES = { name: 'debtor-access', max: 20, seconds: 3600, sliding: true };
/**
 * Beyond 200 failures over the last hour, from all networks (question 114): the Director and the Developer are told, once
 * an episode, and the networks in cause are suspended 15 minutes.
 */
const FAILURES = { name: 'debtor-access-failures', max: 200, seconds: 3600, suspendSeconds: 15 * 60 };

type Outcome =
  { kind: 'open'; token: string; debtorId: string } | { kind: 'invalid'; left: number } | { kind: 'locked'; minutes: number } | { kind: 'blocked' };

const normalized = (identifier: DebtorIdentifier) =>
  identifier.kind === 'SIREN' ? identifier.value.replace(/\s/gu, '') : identifier.value.trim().toUpperCase();

/**
 * The sign-in of a debtor: an identifier and the four letters of the code. The same answer, the same work and the same
 * time for an unknown identifier and for a wrong code; each try counted before it is checked.
 */
@Injectable()
export class DebtorSignIn {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(AuthKeys) private readonly keys: AuthKeys,
    @Inject(RateLimits) private readonly limits: RateLimits,
  ) {}

  /** The debtor of the session cookie, or null. */
  async current(): Promise<Actor | null> {
    const token = cookies().get(COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    for (const hash of this.keys.sessionHashes(token)) {
      const [row] = await this.database.run(
        { kind: 'anonymous' },
        (tx) => tx.$queryRaw<{ debtor: string | null }[]>`SELECT app.resume_debtor_session(decode(${hash}, 'hex'), ${!isBackground()}) AS debtor`,
      );
      if (row?.debtor) return { kind: 'debtor', debtorId: row.debtor };
    }
    return null;
  }

  async access(identifier: DebtorIdentifier, code: string, remember: boolean): Promise<string> {
    await this.limits.refuseSuspended(FAILURES);
    await this.limits.take(TRIES);
    const value = normalized(identifier);
    const attempt = this.keys.attempt('debtor', `${identifier.kind}:${value}`);
    // Written whatever the answer: a refusal is counted, and stays counted.
    const token = randomBytes(32).toString('base64url');
    // One call, the same work whatever the identifier: PostgreSQL counts, compares the fingerprints, opens the session.
    const [row] = await this.database.run(
      { kind: 'anonymous' },
      (tx) =>
        tx.$queryRaw<{ outcome: string; attempts_left: number | null; minutes: number | null; debtor: string | null }[]>`
        SELECT * FROM app.debtor_sign_in(${identifier.kind}, ${value}, ${attempt}, ${this.keys.accessCode(code)}, ${this.keys.sessionHash(token)}, ${remember},
          ${requestFacts().ip ?? null}::inet)`,
    );
    const outcome: Outcome =
      row!.outcome === 'OPEN'
        ? { kind: 'open', token, debtorId: row!.debtor! }
        : row!.outcome === 'BLOCKED'
          ? { kind: 'blocked' }
          : row!.outcome === 'LOCKED'
            ? { kind: 'locked', minutes: row!.minutes ?? 15 }
            : { kind: 'invalid', left: row!.attempts_left ?? 0 };
    // Counted whatever the identifier, known or not: only the right code is not a failure.
    if (outcome.kind !== 'open' && (await this.limits.failed(FAILURES)))
      try {
        await this.database.run({ kind: 'anonymous' }, (tx) => tx.$queryRaw`SELECT app.debtor_access_alert()`);
      } catch (error) {
        // Never an episode left untold: the next failure beyond the limit tries again.
        await this.limits.untold(FAILURES).catch(() => undefined);
        throw error;
      }
    switch (outcome.kind) {
      case 'open':
        cookies().set(COOKIE, outcome.token, remember ? REMEMBERED_S : undefined);
        return outcome.debtorId;
      case 'invalid':
        throw new ApiError(401, 'INVALID', { attemptsLeft: outcome.left });
      case 'locked':
        throw new ApiError(423, 'LOCKED', { minutes: outcome.minutes });
      case 'blocked':
        throw new ApiError(423, 'BLOCKED');
    }
  }

  /** What follows, with the rights of the debtor who has just signed in. */
  asDebtor<T>(debtorId: string, work: () => Promise<T>): Promise<T> {
    return this.database.run({ kind: 'debtor', debtorId }, () => work());
  }

  async close(): Promise<void> {
    const token = cookies().get(COOKIE);
    if (token)
      for (const hash of this.keys.sessionHashes(token))
        await this.database.run({ kind: 'anonymous' }, (tx) => tx.$executeRaw`SELECT app.close_debtor_session(decode(${hash}, 'hex'))`);
    cookies().clear(COOKIE);
  }
}
