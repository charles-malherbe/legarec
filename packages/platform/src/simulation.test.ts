import { expect, it } from 'vitest';
import { answeredByApi } from './simulation';

const origin = 'http://localhost:5173';
it.each([
  ['auth,account', '/api/auth/session', true],
  [' auth , account ', '/api/account', true],
  ['auth', '/api/account', false],
  ['account', '/api/accounts/x', false],
  ['', '/api/auth/session', false],
  ['', '/api/', false],
  [undefined, '/api/auth/session', false],
])('with the list %j, %s goes to the API: %s', (list, path, real) => expect(answeredByApi(origin + path, list)).toBe(real));
