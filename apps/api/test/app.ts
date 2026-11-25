import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { inject } from 'vitest';
import { createApp } from '../src/app';
import type { ActorResolver, Portal } from '../src/platform/access/access';
import { readConfig } from '../src/platform/config/config';
import type { Actor } from '../src/platform/database/actor';
import { Database } from '../src/platform/database/database';
import { createLogger } from '../src/platform/logging/logger';
import { connectValkey } from '../src/platform/queue/valkey';
import { createTestDatabase, seed, type Seed, type TestDatabase } from './database';

export const ORIGINS = { staff: 'http://localhost:5173', partner: 'http://localhost:5174', debtor: 'http://localhost:5175' };

/** The test header names an actor of the set; the real sessions come with the accounts. */
export const ACTOR_HEADER = 'x-test-actor';
class TestResolver implements ActorResolver {
  constructor(private readonly actors: () => Record<string, Actor>) {}
  resolve(_portal: Portal, request: { headers: Record<string, unknown> }): Promise<Actor | null> {
    return Promise.resolve(this.actors()[String(request.headers[ACTOR_HEADER])] ?? null);
  }
}

export interface TestApp {
  app: NestExpressApplication;
  database: TestDatabase;
  s: Seed;
  logs: string[];
  call(
    method: string,
    path: string,
    options?: { as?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown; headers: Headers }>;
  stop(): Promise<void>;
}

interface Options {
  /** Startup values of the test. */
  env?: Record<string, string>;
  /** Application that keeps its database and its people: this one starts next to it, as after a deployment. */
  next?: TestApp;
}

export async function startApp(controllers: Type[] = [], { env = {}, next }: Options = {}): Promise<TestApp> {
  const database = next?.database ?? (await createTestDatabase());
  const s = next?.s ?? (await seed(database.admin));
  const logs: string[] = [];
  const config = readConfig({
    NODE_ENV: 'test',
    DATABASE_URL: database.url('app'),
    VALKEY_URL: inject('valkeyUrl'),
    VAULT_MASTER_KEY: randomBytes(32).toString('base64'),
    SESSION_SIGNING_KEY: randomBytes(32).toString('base64'),
    ...env,
  });
  const valkey = connectValkey(config.VALKEY_URL, 'api');
  await valkey.connect();
  const both = ['TECHNICAL', 'ADMINISTRATIVE'] as const;
  const actors = (): Record<string, Actor> => ({
    director: { kind: 'staff', userId: s.director, role: 'DIRECTOR', delegations: [] },
    manager: { kind: 'staff', userId: s.manager, role: 'COLLECTION_MANAGER', delegations: ['ADMINISTRATIVE'] },
    managerAlone: { kind: 'staff', userId: s.manager, role: 'COLLECTION_MANAGER', delegations: [] },
    developer: { kind: 'staff', userId: s.developer, role: 'DEVELOPER', delegations: ['TECHNICAL'] },
    officerA: { kind: 'staff', userId: s.officerA, role: 'CLAIMS_OFFICER', delegations: [] },
    officerB: { kind: 'staff', userId: s.officerB, role: 'CLAIMS_OFFICER', delegations: [] },
    // Claims delegations the table does not give: the database must not believe it.
    liar: { kind: 'staff', userId: s.officerA, role: 'DIRECTOR', delegations: both },
    partnerA: { kind: 'partner', userId: s.partnerA, creditorId: s.creditorA },
    partnerB: { kind: 'partner', userId: s.partnerB, creditorId: s.creditorB },
    debtorA: { kind: 'debtor', debtorId: s.debtorA },
    debtorB: { kind: 'debtor', debtorId: s.debtorB },
  });
  const logger = createLogger('debug', new Writable({ write: (chunk: Buffer, _encoding, done) => (logs.push(chunk.toString()), done()) }));
  const pool = new Database(config.DATABASE_URL);
  const drop = () => (next ? Promise.resolve() : database.drop());
  const app = await createApp({ config, logger, database: pool, valkey, resolver: new TestResolver(actors), controllers }).catch(async (error: unknown) => {
    await Promise.all([pool.close(), valkey.quit()]);
    await drop();
    throw error;
  });
  try {
    await app.listen(0, '127.0.0.1');
  } catch (error) {
    // Refused at its start: nothing of it stays.
    await app.close();
    await drop();
    throw error;
  }
  const base = await app.getUrl();
  return {
    app,
    database,
    s,
    logs,
    call: async (method, path, options = {}) => {
      const portal = path.split('/')[1] as keyof typeof ORIGINS;
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(ORIGINS[portal] ? { origin: ORIGINS[portal] } : {}),
          ...(options.as ? { [ACTOR_HEADER]: options.as } : {}),
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : undefined, headers: response.headers };
    },
    stop: async () => {
      await app.close();
      await drop();
    },
  };
}
