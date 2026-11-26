import type { DepositItem } from '@legarec/contracts';
import { http, HttpResponse } from 'msw';
import { done, forbidden, notFound } from '../http';
import { currentSession } from '../state';

/** Claims deposited by creditors, waiting for the Director or the manager (question 155): the same answers as the API. */
const DEMO: DepositItem[] = [
  {
    id: 'dep-1',
    creditorId: 'md',
    creditor: 'Matériaux Delta',
    debtor: 'Menuiserie Arnal',
    identifier: 'SIRET 512 334 871 00088',
    address: '18 chemin des Scieurs, 38500 Voiron',
    email: 'compta@arnal.example',
    phone: '04 76 00 00 21',
    invoices: [
      { number: 'MA-1042', issuedOn: '2026-08-28', dueOn: '2026-09-27', amount: 486000 },
      { number: 'MA-1077', issuedOn: '2026-09-15', dueOn: '2026-10-15', amount: 129000 },
    ],
    total: 615000,
    files: 2,
    depositedOn: '2026-11-24',
  },
  {
    id: 'dep-2',
    creditorId: 'er',
    creditor: 'Énergies Rhône',
    debtor: 'Studio Pixelia',
    identifier: 'Particulier',
    address: '3 rue des Arts, 75011 Paris',
    email: '',
    phone: '',
    invoices: [{ number: 'ER-2290', issuedOn: '2026-09-01', dueOn: '2026-10-01', amount: 98000 }],
    total: 98000,
    files: 0,
    depositedOn: '2026-11-25',
  },
];
let waiting = [...DEMO];
export const resetDeposits = () => {
  waiting = [...DEMO];
};
export const depositsWaiting = () => waiting.length;

const validates = () => {
  const session = currentSession();
  return session?.role === 'DIRECTOR' || session?.role === 'COLLECTION_MANAGER';
};

export const depositHandlers = [
  http.get('/api/deposits', () => (validates() ? HttpResponse.json({ items: waiting, count: waiting.length }) : forbidden())),
  http.post('/api/deposits/:id/accept', async ({ params, request }) => {
    if (!validates()) return forbidden();
    const found = waiting.find((item) => item.id === params.id);
    if (!found) return notFound();
    const { expectedTotal } = (await request.json()) as { expectedTotal: number };
    if (expectedTotal !== found.total) return HttpResponse.json({ code: 'CHANGED' }, { status: 409 });
    waiting = waiting.filter((item) => item.id !== found.id);
    // The demo case stands for the one opened.
    return HttpResponse.json({ caseId: 'demo' });
  }),
  http.post('/api/deposits/:id/refuse', async ({ params, request }) => {
    if (!validates()) return forbidden();
    const found = waiting.find((item) => item.id === params.id);
    if (!found) return notFound();
    const { reason } = (await request.json()) as { reason: string };
    if (reason.trim().length < 5) return HttpResponse.json({ code: 'INVALID', fields: ['reason'] }, { status: 422 });
    waiting = waiting.filter((item) => item.id !== found.id);
    return done();
  }),
];
