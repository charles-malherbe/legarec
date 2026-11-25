import { session as sessionSchema } from '@legarec/contracts';
import { answeredByApi } from '@legarec/platform';
import { bypass, http, passthrough } from 'msw';
import { setupWorker } from 'msw/browser';
import { ACCOUNTS } from './accounts';
import { handlers } from './handlers';
import { setAccount } from './state';

/** Routes of `VITE_API`: answered by the API of this machine. The others stay simulated, for the same person. */
const real = http.all('/api/*', async ({ request }) => {
  if (!answeredByApi(request.url)) return undefined;
  if (!request.url.endsWith('/api/auth/session')) return passthrough();
  const response = await fetch(bypass(request));
  const opened = sessionSchema.safeParse(await response.clone().json());
  setAccount(opened.success ? (ACCOUNTS.find((item) => item.role === opened.data.role)?.userId ?? 'none') : 'none');
  return response;
});

export const worker = setupWorker(real, ...handlers);
