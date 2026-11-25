import type { RequestHandler } from 'express';
import type { Config } from '../config/config';
import { acceptsOrigin, originOfPortal, portalOf } from './origin';

/** The API only ever answers data: nothing to run, frame or keep. */
export const securityHeaders: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  next();
};

/** Unknown paths stop here; the origin is checked again by the access guard, from the rule of the route itself. */
export function portalsOnly(config: Config): RequestHandler {
  return (request, response, next) => {
    const portal = portalOf(request.path);
    // A control character designates nothing, and PostgreSQL would refuse it.
    if (!portal || /%[01][0-9a-f]/iu.test(request.path)) {
      response.status(404).json({ code: 'NOT_FOUND' });
      return;
    }
    const { origin } = request.headers;
    if (!acceptsOrigin(portal, request.method, origin, config)) {
      response.status(403).json({ code: 'FORBIDDEN' });
      return;
    }
    const expected = originOfPortal(portal, config);
    if (expected !== null) {
      response.setHeader('Vary', 'Origin');
      if (origin === expected) {
        response.setHeader('Access-Control-Allow-Origin', expected);
        response.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
        response.setHeader('Access-Control-Max-Age', '600');
        response.status(204).end();
        return;
      }
    }
    next();
  };
}

/** A body is JSON, except where a file is expected. A form of another site cannot send JSON without asking first. */
export function jsonOnly(uploads: readonly RegExp[] = []): RequestHandler {
  return (request, response, next) => {
    const hasBody = Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined;
    if (!hasBody || portalOf(request.path) === 'hook' || uploads.some((pattern) => pattern.test(request.path))) return next();
    if (request.is('application/json') === 'application/json') return next();
    response.status(415).json({ code: 'UNSUPPORTED_TYPE' });
  };
}
