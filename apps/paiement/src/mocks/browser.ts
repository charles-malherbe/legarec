import { answeredByApi } from '@legarec/platform';
import { http, passthrough } from 'msw';
import { setupWorker } from 'msw/browser';
import { handlers, openSession } from './handlers';

/**
 * Since lot O, every route of this portal is answered by the API of this machine (`pnpm --filter @legarec/api dev`).
 * `VITE_API=none` brings the simulation back, for a demonstration without the API.
 */
const real = http.all('/api/*', ({ request }) => (answeredByApi(request.url, import.meta.env.VITE_API ?? 'debtor') ? passthrough() : undefined));

// Development only, simulated: the demonstration route opens the fictitious debtor's space.
if (window.location.pathname === '/demo') openSession('durand');
export const worker = setupWorker(real, ...handlers);
