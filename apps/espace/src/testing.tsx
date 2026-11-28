import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { App } from './app/App';
import { handlers } from './mocks/handlers';
import { publicDataHandlers } from './mocks/publicData';
import { setAccount, state } from './mocks/state';

/** Starts MSW for a test file and resets the simulated session between tests. */
export function mockApi() {
  const server = setupServer(...handlers, ...publicDataHandlers);
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    state.failures.clear();
    state.pending = null;
    state.wrongCodes = 0;
    state.priorities.clear();
    setAccount('none');
  });
  afterAll(() => server.close());
  return server;
}
export function openAs(account: string, path: string) {
  setAccount(account);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
/** Calls the simulated API directly, to check what a role may do beyond the screens. */
export async function call(account: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  setAccount(account);
  return fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
