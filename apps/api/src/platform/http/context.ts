import type { Request, RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Actor } from '../database/actor';
import { CookieJar } from './cookies';

/** Facts about the request kept with the audit log. Never a path, a query string or a body. */
export interface RequestFacts {
  requestId?: string;
  ip?: string;
}
interface RequestScope extends RequestFacts {
  cookies: CookieJar;
  agent: string;
  /** Asked by the screen itself, not by the person in front of it. */
  background: boolean;
  /** Announced type of that body. */
  contentType: string;
  actor?: Actor;
}

const storage = new AsyncLocalStorage<RequestScope>();
const scope = (): RequestScope => {
  const current = storage.getStore();
  if (!current) throw new Error('No request');
  return current;
};

/** Facts of the request under way, wherever the code is; empty outside of one (worker, command). */
export const requestFacts = (): RequestFacts => {
  const { requestId, ip } = storage.getStore() ?? {};
  return { ...(requestId ? { requestId } : {}), ...(ip ? { ip } : {}) };
};
export const cookies = (): CookieJar => scope().cookies;
export const userAgent = (): string => scope().agent;
export const isBackground = (): boolean => scope().background;
export const uploadedType = (): string => scope().contentType;

/** Who was allowed in by the access guard. */
export function currentActor(): Actor {
  const { actor } = scope();
  if (!actor) throw new Error('No actor');
  return actor;
}
export function setCurrentActor(actor: Actor): void {
  const current = storage.getStore();
  if (current) current.actor = actor;
}

const addressOf = ({ ip }: Request) => (ip && isIP(ip) && !ip.includes('%') ? { ip } : {});

/** Number of the request, for the log, the audit and the answer. Never taken from the caller. */
export const openRequest: RequestHandler = (request, response, next) => {
  const requestId = randomUUID();
  response.setHeader('X-Request-Id', requestId);
  Object.assign(request, { requestId });
  const { headers } = request;
  storage.run(
    {
      requestId,
      // The proxy writes the address; anything else is left out rather than trusted (a zone, `%eth0`, is not an address).
      ...addressOf(request),
      cookies: new CookieJar(headers.cookie, response),
      agent: headers['user-agent'] ?? '',
      background: headers['x-background'] === '1',
      contentType: headers['content-type'] ?? '',
    },
    next,
  );
};
