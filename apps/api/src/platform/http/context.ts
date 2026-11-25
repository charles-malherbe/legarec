import type { RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

/** Facts about the request kept with the audit log. Never a path, a query string or a body. */
export interface RequestFacts {
  requestId?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestFacts>();

/** Facts of the request under way, wherever the code is; empty outside of one (worker, command). */
export const requestFacts = (): RequestFacts => storage.getStore() ?? {};

/** Number of the request, for the log, the audit and the answer. Never taken from the caller. */
export const openRequest: RequestHandler = (request, response, next) => {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  Object.assign(request, { requestId });
  // The proxy writes the address; anything else is left out rather than trusted (a zone, `%eth0`, is not an address).
  storage.run({ requestId, ...(request.ip && isIP(request.ip) && !request.ip.includes('%') ? { ip: request.ip } : {}) }, next);
};
