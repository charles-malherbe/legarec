import { setupWorker } from 'msw/browser';
import { handlers, openSession } from './handlers';

// Development only: the demonstration route opens the fictitious debtor's space.
if (window.location.pathname === '/demo') openSession('durand');
export const worker = setupWorker(...handlers);
