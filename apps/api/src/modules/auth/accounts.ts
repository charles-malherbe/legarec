import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../platform/database/actor';
import { Database, type Transaction } from '../../platform/database/database';

export type AttemptScope = 'SIGN_IN' | 'SECOND_FACTOR' | 'PASSWORD';
type Work<T> = (tx: Transaction) => Promise<T>;

/** Transactions of the sign-in: credentials are out of reach of every other role, and of every other account. */
@Injectable()
export class Accounts {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Nobody yet. */
  nobody = <T>(work: Work<T>): Promise<T> => this.database.run({ kind: 'anonymous' }, work);
  /** About that account, which has proved nothing: what is noted is the doing of a stranger. */
  about = <T>(subject: string, work: Work<T>): Promise<T> => this.database.run({ kind: 'anonymous', subject }, work);
  /** By that account, which has just proved who it is. Its line is taken first: what is done to an account is done one thing after the other. */
  as = <T>(subject: string, work: Work<T>): Promise<T> =>
    this.database.run({ kind: 'anonymous', subject, proved: true }, async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM users WHERE id = ${subject}::uuid FOR NO KEY UPDATE`;
      return work(tx);
    });
  /** The collaborator of the request, for a route that reads their credentials too: one transaction after the other, never two at once. */
  signedIn = <T>(actor: Extract<Actor, { kind: 'staff' }>, work: Work<T>): Promise<T> => this.database.run(actor, work);

  /** Account that may sign in with this address: active, with a password, and an open portal. */
  async find(email: string): Promise<string | null> {
    const [row] = await this.nobody((tx) => tx.$queryRaw<{ id: string | null }[]>`SELECT app.account_of(${email}::citext) AS id`);
    return row?.id ?? null;
  }

  /** Counted before the proof is checked: attempts made at the same time do not add up beyond five. */
  async takeAttempt(key: Buffer, scope: AttemptScope): Promise<{ allowed: boolean; left: number }> {
    const [row] = await this.nobody(
      (tx) => tx.$queryRaw<{ allowed: boolean; attempts_left: number }[]>`SELECT * FROM app.take_attempt(${key}, ${scope}::attempt_scope)`,
    );
    return { allowed: row!.allowed, left: row!.attempts_left };
  }

  async clearAttempts(tx: Transaction, ...keys: Buffer[]): Promise<void> {
    await tx.$executeRaw`SELECT app.clear_attempts(${keys.map((key) => key.toString('hex'))}::text[])`;
  }
}
