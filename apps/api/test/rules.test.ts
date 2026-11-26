import { Body, Controller, Post, Query, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { REQUEST_BODIES } from '@legarec/contracts';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import type { INestApplicationContext } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnyStaff, PREFIX, type Portal } from '../src/platform/access/access';
import { routesOf } from '../src/platform/access/routes';
import { startApp, type TestApp } from './app';

/** Rules of the code that no request can prove: they hold for the routes and the modules of the next lots too. */

interface Input {
  route: string;
  kind: 'body' | 'query';
  schema: unknown;
}
/** Bodies and queries received by each route, with the schema written on them. */
function inputsOf(app: INestApplicationContext): Input[] {
  const scanner = app.get(MetadataScanner, { strict: false });
  return app
    .get(DiscoveryService, { strict: false })
    .getControllers()
    .flatMap(({ metatype }) => {
      if (!metatype) return [];
      const prototype = metatype.prototype as Record<string, () => unknown>;
      return scanner.getAllMethodNames(prototype).flatMap((name) => {
        const method = Reflect.getMetadata(METHOD_METADATA, prototype[name]!) as RequestMethod | undefined;
        if (method === undefined) return [];
        const path = [Reflect.getMetadata(PATH_METADATA, metatype), Reflect.getMetadata(PATH_METADATA, prototype[name]!)]
          .flat()
          .join('/')
          .replace(/\/+/gu, '/')
          .replace(/\/$/u, '');
        const route = `${RequestMethod[method]} ${path.startsWith('/') ? path : `/${path}`}`;
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, name) ?? {}) as Record<string, { schema?: unknown }>;
        return Object.entries(args).flatMap(([key, { schema }]): Input[] => {
          const type = Number(key.split(':')[0]);
          return type === BODY || type === QUERY ? [{ route, kind: type === BODY ? 'body' : 'query', schema }] : [];
        });
      });
    });
}
/** Numbers of NestJS for `@Body()` and `@Query()`, checked below. */
const BODY = 3;
const QUERY = 4;

/** Schema that the portals and the simulations use for the same route. */
function contractOf(route: string): unknown {
  const [method = '', path = ''] = route.split(' ');
  const portal = (['staff', 'partner', 'debtor'] as const).find((name) => path.startsWith(`${PREFIX[name as Portal]}/`));
  if (!portal) return undefined;
  const bodies = REQUEST_BODIES[portal] as Record<string, unknown>;
  // The paths of the debtors' portal already begin with their prefix.
  return bodies[`${method} ${portal === 'debtor' ? path : path.slice(PREFIX[portal].length)}`];
}
const wrong = (app: INestApplicationContext) =>
  inputsOf(app)
    .filter(({ route, kind, schema }) => !schema || (kind === 'body' && schema !== contractOf(route)))
    .map(({ route, kind }) => `${kind} of ${route}`)
    .sort();

describe('what a route receives', () => {
  @Controller('staff/cases')
  @AnyStaff()
  class SampleController {
    @Post('search')
    contract(@Body({ schema: REQUEST_BODIES.staff['POST /cases/search'] }) _body: unknown) {}
    @Post('litigation')
    copied(@Body({ schema: z.object({ ids: z.array(z.string()) }) }) _body: unknown) {}
    @Post('assign')
    unchecked(@Body() _body: unknown) {}
    @Post('reminders')
    oneField(@Body('ids') _ids: unknown, @Query('page') _page: string) {}
  }
  let test: TestApp;
  let sample: TestingModule;
  beforeAll(async () => {
    test = await startApp();
    sample = await Test.createTestingModule({ imports: [DiscoveryModule], controllers: [SampleController] }).compile();
  });
  afterAll(() => Promise.all([test.stop(), sample.close()]));

  it('is seen by this check: without schema, or with another one than the portals', () => {
    expect(inputsOf(sample)).toHaveLength(5);
    expect(wrong(sample)).toEqual([
      'body of POST /staff/cases/assign',
      'body of POST /staff/cases/litigation',
      'body of POST /staff/cases/reminders',
      'query of POST /staff/cases/reminders',
    ]);
  });

  it('stops the API from starting when it has no schema', async () => {
    await expect(startApp([SampleController])).rejects.toThrow(
      'POST /staff/cases/assign: body without schema; POST /staff/cases/reminders: query and body without schema',
    );
  });

  it('matches the contract of the portals, on every route', () => {
    expect(wrong(test.app)).toEqual([]);
  });

  it('comes with a key on every change of the team, but those of one’s own account and those that commit nothing', () => {
    const free = routesOf(test.app).filter(({ id, commits }) => !commits && /^(?!GET)\w+ \/staff\/(?!account\/|auth\/)/u.test(id));
    expect(free.map(({ id }) => id).sort()).toEqual([
      // Readings, whose question is in the body.
      'POST /staff/cases/check',
      'POST /staff/cases/search',
      'POST /staff/notifications/read',
      'POST /staff/search',
      // Asked twice, they leave what they left once.
      'PUT /staff/cases/:id/coordinates/:coordinateId',
      'PUT /staff/credit-notes/drafts/:id',
      'PUT /staff/dashboard/priorities/:id',
      'PUT /staff/delegations/:kind',
      'PUT /staff/members/:id/extension',
      'PUT /staff/notifications',
    ]);
  });
});

describe('doors to PostgreSQL and to Valkey', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const eslint = new ESLint({ cwd: root, overrideConfigFile: `${root}/eslint.config.mjs` });
  const problems = async (file: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: `${root}/apps/api/src/${file}` });
    return result!.messages.map((message) => message.ruleId);
  };

  it.each([
    "import type { Database } from '../../platform/database/database';\nexport const x = (database: Database) => database.run({ kind: 'retention' }, () => Promise.resolve());",
    "import type { Database } from '../../platform/database/database';\nexport class X { constructor(private readonly database: Database) {} y = () => this.database.run({ kind: 'anonymous' }, () => Promise.resolve()); }",
    "import { Database } from '../../platform/database/database';\nexport const x = new Database('postgres://x');",
  ])('keep the choice of who is acting to the sign-in: %s', async (code) => {
    expect(await problems('modules/cases/cases.service.ts', code)).toContain('no-restricted-syntax');
    expect(await problems('modules/auth/accounts.ts', code)).not.toContain('no-restricted-syntax');
  });

  it.each([
    "import { PrismaClient } from '../../generated/prisma/client';\nexport const x = PrismaClient;",
    "import { PrismaPg } from '@prisma/adapter-pg';\nexport const x = PrismaPg;",
    "import pg from 'pg';\nexport const x = pg;",
    "import { Queue } from 'bullmq';\nexport const x = Queue;",
    "import { Redis } from 'ioredis';\nexport const x = Redis;",
    "export { PrismaClient } from '../../generated/prisma/client';",
  ])(
    'are closed to the modules: %s',
    async (code) => {
      expect(await problems('modules/cases/cases.service.ts', code)).toContain('no-restricted-imports');
      expect(await problems('platform/database/sample.ts', code)).not.toContain('no-restricted-imports');
    },
    30_000,
  );

  it.each(['$queryRawUnsafe', '$executeRawUnsafe'])('never open to a query written from text: %s', async (name) => {
    const code = `export const x = (tx: { ${name}(sql: string): unknown }, sql: string) => tx.${name}(sql);`;
    expect(await problems('modules/cases/cases.service.ts', code)).toContain('no-restricted-properties');
  });

  it('let a module use the transaction of its request', async () => {
    const code = "import { Database } from '../../platform/database/database';\nexport const x = (database: Database) => database.tx.case.count();";
    expect((await problems('modules/cases/cases.service.ts', code)).filter((rule) => rule?.startsWith('no-restricted'))).toEqual([]);
  });

  it.each(["import('pg')", "import('bullmq')", "import('../../generated/prisma/client')"])('are closed to an import made at run time: %s', async (code) => {
    expect(await problems('modules/cases/cases.service.ts', `export const x = () => ${code};`)).toContain('no-restricted-syntax');
  });

  it.each([
    [
      'a value in the message',
      "import type { AppLogger } from '../logging/logger';\nexport const x = (logger: AppLogger, code: string) => logger.info({}, `code ${code}`);",
    ],
    ['a value added to it', "export const x = (logger: { warn(text: string): void }, code: string) => logger.warn('code ' + code);"],
    [
      'the one of a class',
      'export class X { constructor(private readonly logger: { error(a: object, b: string): void }) {} go(code: string) { this.logger.error({}, `code ${code}`); } }',
    ],
  ])('let no line of the log carry more than its fields: %s', async (_what, code) => {
    for (const file of ['modules/cases/cases.service.ts', 'platform/queue/sample.ts'])
      expect(await problems(file, code), file).toContain('no-restricted-syntax');
  });
  it('leave the console alone, and a constant message as it is', async () => {
    expect(await problems('platform/queue/sample.ts', "console.info('x');")).toContain('no-console');
    const constant = 'export const x = (logger: { info(a: object, b: string): void }) => logger.info({ count: 1 + 1 }, `done`);';
    expect((await problems('modules/cases/cases.service.ts', constant)).filter((rule) => rule?.startsWith('no-'))).toEqual([]);
  });
  it('let only the platform read the request itself', async () => {
    const code = "import { createParamDecorator } from '@nestjs/common';\nexport const x = createParamDecorator;";
    expect(await problems('modules/cases/cases.controller.ts', code)).toContain('no-restricted-imports');
    expect(await problems('platform/http/raw-body.ts', code)).not.toContain('no-restricted-imports');
  });

  it.each(["SELECT set_config('app.user_id', '', true)", 'SET LOCAL ROLE legarec_worker', 'set role legarec_auth', 'RESET ROLE'])(
    'let no query change who is acting: %s',
    async (sql) => {
      const code = `export const x = (tx: { $queryRaw(text: TemplateStringsArray): unknown }) => tx.$queryRaw\`${sql}\`;`;
      expect(await problems('modules/cases/cases.service.ts', code)).toContain('no-restricted-syntax');
    },
  );
});
