import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_PARITY, filled, type ParityRole } from '../../../../packages/contracts/test/accounts.parity';
import { mockApi } from '../testing';
import { resetAccounts } from './routes/account';
import { resetCases } from './routes/cases';
import { resetCreditors } from './routes/creditors';
import { resetSteering } from './routes/steering';
import { setAccount } from './state';

mockApi();
afterEach(() => {
  resetAccounts();
  resetSteering();
});
beforeAll(() => {
  resetCases();
  resetCreditors();
});
const ACCOUNTS: Record<Exclude<ParityRole, 'partner'>, string> = { director: 'ad', manager: 'cl', developer: 'dev', officer: 'hb', nobody: 'none' };
const IDS = {
  ...ACCOUNTS,
  creditor: 'cb',
  creditorId: 'md',
  reset: 'demo',
  invitation: 'demo',
  mandate: 'md-m1',
  caseOfDirector: 'lagarde',
  caseOfManager: 'demo',
};

/** The API answers the same: `apps/api/test/parity.test.ts`. */
describe('simulations of the accounts', () => {
  it.each(ACCOUNT_PARITY.map((item) => [`${item.as}: ${item.request} ${JSON.stringify(item.body ?? '')} → ${item.status}`, item] as const))(
    '%s',
    async (_name, item) => {
      const [method = '', path = ''] = (filled(item.request, IDS) as string).split(' ');
      const body = filled(item.body, IDS);
      setAccount(item.as === 'partner' ? 'none' : ACCOUNTS[item.as]);
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
