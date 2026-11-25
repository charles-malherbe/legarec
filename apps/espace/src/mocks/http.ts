import type { Session } from '@legarec/contracts';
import { HttpResponse } from 'msw';
import { currentSession } from './state';

export const unauthorized = () => HttpResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
export const forbidden = () => HttpResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
export const notFound = () => HttpResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
export const done = () => new HttpResponse(null, { status: 204 });

/** Wraps a handler so that it only runs for a signed-in user allowed by `allow`. */
export function guarded<Info extends { request: Request }>(
  allow: (session: Session) => boolean,
  resolve: (info: Info, session: Session) => Response | Promise<Response>,
) {
  return async (info: Info) => {
    const session = currentSession();
    if (!session) return unauthorized();
    return allow(session) ? resolve(info, session) : forbidden();
  };
}
export const staffWithCases = (session: Session) => session.role !== 'DEVELOPER' && session.role !== 'CREDITOR';
