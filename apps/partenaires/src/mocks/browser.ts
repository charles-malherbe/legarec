import { partnerSession } from '@legarec/contracts';
import { answeredByApi } from '@legarec/platform';
import { bypass, http, passthrough } from 'msw';
import { setupWorker } from 'msw/browser';
import { handlers, partnerOf, setPartner } from './handlers';

/** Routes of `VITE_API`: answered by the API of this machine. The others stay simulated, for the same creditor. */
const real = http.all('/api/*', async ({ request }) => {
  if (!answeredByApi(request.url)) return undefined;
  if (!request.url.endsWith('/api/auth/session')) return passthrough();
  const response = await fetch(bypass(request));
  const opened = partnerSession.safeParse(await response.clone().json());
  setPartner(opened.success ? partnerOf(opened.data.email) : 'none');
  return response;
});

export const worker = setupWorker(real, ...handlers);
