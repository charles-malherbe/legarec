import { afterAll, beforeAll, expect, it } from 'vitest';
import { startApp, type TestApp } from '../../test/app';

let test: TestApp;
beforeAll(async () => {
  test = await startApp();
});
afterAll(() => test.stop());

it('answers that it is alive, and nothing else', async () => {
  const answer = await test.call('GET', '/health');
  expect(answer).toMatchObject({ status: 200, body: { status: 'ok' } });
  expect(answer.headers.get('cache-control')).toBe('no-store');
  expect(answer.headers.get('x-powered-by')).toBeNull();
});

it('answers 404 with a code for an unknown route', async () => {
  expect(await test.call('GET', '/nothing')).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
});
