import { PrismaPg } from '@prisma/adapter-pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient, type Prisma } from '../../generated/prisma/client';
import { contextOf, type Actor, type RequestFacts } from './actor';

export type Transaction = Prisma.TransactionClient;
interface Scope {
  actor: Actor;
  tx: Transaction;
}

const TIMEOUT_MS = 15_000;
const CONTEXT_NAMES = Object.keys(contextOf({ kind: 'anonymous' }, {}));
const ENTER = `SELECT ${CONTEXT_NAMES.map((name, index) => `set_config('${name}', $${index + 1}, true)`).join(', ')}`;

/** The only door to PostgreSQL: one transaction per call, with the rights of its actor and nothing more. */
export class Database {
  private readonly client: PrismaClient;
  private readonly scope = new AsyncLocalStorage<Scope>();

  constructor(url: string, options: { poolSize?: number } = {}) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: options.poolSize ?? 10 }), errorFormat: 'minimal' });
  }

  /** Runs `work` in a new transaction. Everything rolls back if it throws. */
  async run<T>(actor: Actor, work: (tx: Transaction) => Promise<T>, facts: RequestFacts = {}): Promise<T> {
    const context = contextOf(actor, facts);
    return this.client.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(ENTER, ...CONTEXT_NAMES.map((name) => context[name]));
        return this.scope.run({ actor, tx }, () => work(tx));
      },
      { timeout: TIMEOUT_MS, maxWait: 5_000 },
    );
  }

  /** Transaction of the current request. Throws outside of one: no query can forget its actor. */
  get tx(): Transaction {
    const current = this.scope.getStore();
    if (!current) throw new Error('No transaction: use Database.run()');
    return current.tx;
  }

  get actor(): Actor {
    const current = this.scope.getStore();
    if (!current) throw new Error('No transaction: use Database.run()');
    return current.actor;
  }

  /** Answers when PostgreSQL does; needs no right on any table. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
