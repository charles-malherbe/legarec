import type { RequestHandler } from 'express';
import type { AppRequest } from '../access/access.guard';
import type { AppLogger } from './logger';

/**
 * One line per request, refused ones included (origin, type, sign-in, rights): the model of the route, never its path,
 * its query nor its body. Placed first, so that nothing escapes it.
 */
export function accessLog(logger: AppLogger): RequestHandler {
  return (request, response, next) => {
    const started = performance.now();
    response.once('close', () => {
      const { requestId, actor, route, method } = request as AppRequest & { route?: { path?: unknown } };
      const path = typeof route?.path === 'string' ? route.path : undefined;
      // Closed before its answer was complete: the caller is gone, whatever status was about to be sent.
      const status = response.writableFinished ? response.statusCode : 499;
      logger[status >= 500 ? 'error' : 'info'](
        { requestId, method, route: path ?? 'unmatched', status, ms: Math.round(performance.now() - started), actor: actor?.kind },
        'request',
      );
    });
    next();
  };
}
