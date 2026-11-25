import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { filled, PARTNER_PARITY } from '../../../../packages/contracts/test/accounts.parity';
import { handlers, resetPortal, setPartner } from './handlers';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetPortal());
const IDS = { reset: 'demo', invitation: 'demo' };

/** The API answers the same: `apps/api/test/parity.test.ts`. */
describe('simulated sign-in of the creditors', () => {
  it.each(PARTNER_PARITY.map((item) => [`${item.as}: ${item.request} ${JSON.stringify(item.body ?? '')} → ${item.status}`, item] as const))(
    '%s',
    async (_name, item) => {
      const [method = '', path = ''] = (filled(item.request, IDS) as string).split(' ');
      const body = filled(item.body, IDS);
      setPartner(item.as === 'partner' ? 'cb' : 'none');
      const response = await fetch(`/api${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      expect(response.status).toBe(item.status);
      if (!item.answer) return;
      const answer: unknown = await response.json();
      expect(item.answer.parse(answer)).toEqual(answer);
    },
  );
});
