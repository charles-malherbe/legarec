import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeApi } from '../src/openapi';
import { routesOf } from '../src/platform/access/routes';
import { startApp, type TestApp } from './app';
import { MATRIX } from './matrix';

const FILE = fileURLToPath(new URL('../../../packages/contracts/openapi.json', import.meta.url));
const TYPES = fileURLToPath(new URL('../../../packages/contracts/src/routes.generated.ts', import.meta.url));
let test: TestApp;
beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

describe('description of the API', () => {
  it('is the committed one (run `pnpm openapi` after a change)', () => {
    const text = `${JSON.stringify(describeApi(test.app), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI) writeFileSync(FILE, text);
    expect(readFileSync(FILE, 'utf8')).toBe(text);
  });
  it('gives the committed types of the routes', async () => {
    const text = `/* Generated from openapi.json by pnpm openapi. */\n${astToString(await openapiTS(describeApi(test.app) as unknown as OpenAPI3))}`;
    if (process.env.UPDATE_OPENAPI) writeFileSync(TYPES, text);
    expect(readFileSync(TYPES, 'utf8')).toBe(text);
  });
});

describe('access matrix', () => {
  it('covers every route of the API, and no other', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(
      routesOf(test.app)
        .map((route) => route.id)
        .sort(),
    );
  });

  it.each(Object.entries(MATRIX))('%s answers each caller as expected', async (id, entry) => {
    const [method = '', path = ''] = id.split(' ');
    const target = entry.path?.(test.s) ?? path;
    for (const [as, status] of Object.entries(entry.expect)) {
      const answer = await test.call(method, target, { as: as === 'nobody' ? undefined : as, body: entry.body });
      expect(answer.status, `${id} for ${as}`).toBe(status);
    }
  });
});
