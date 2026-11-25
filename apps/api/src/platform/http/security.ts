import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config/config';
import { PREFIX } from '../access/access';
import type { AppRequest } from '../access/access.guard';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Number of the request, for the log, the audit and the answer. Never taken from the caller. */
export const requestNumber: RequestHandler = (request: Request, response: Response, next: NextFunction) => {
  (request as AppRequest).requestId = randomUUID();
  response.setHeader('X-Request-Id', (request as AppRequest).requestId);
  next();
};

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

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/**
 * Each prefix belongs to one portal. The origin must be exactly that of the portal, and present for any change:
 * a page of another site, or of another portal, can neither read an answer nor send an order.
 */
export function originOf(config: Config): RequestHandler {
  const expected: [string, string][] = [
    [PREFIX.staff, config.STAFF_PORTAL_URL],
    [PREFIX.partner, config.PARTNER_PORTAL_URL],
    [PREFIX.debtor, config.DEBTOR_PORTAL_URL],
  ];
  return (request, response, next) => {
    const portal = expected.find(([prefix]) => under(request.path, prefix));
    if (!portal) return next();
    const { origin } = request.headers;
    response.setHeader('Vary', 'Origin');
    if (origin !== undefined && origin !== portal[1]) {
      response.status(403).json({ code: 'FORBIDDEN' });
      return;
    }
    if (origin === undefined && !SAFE.has(request.method)) {
      response.status(403).json({ code: 'FORBIDDEN' });
      return;
    }
    if (origin !== undefined) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
      response.setHeader('Access-Control-Max-Age', '600');
      response.status(204).end();
      return;
    }
    next();
  };
}

/** A body is JSON, except where a file is expected. A form of another site cannot send JSON without asking first. */
export function jsonOnly(uploads: readonly RegExp[] = []): RequestHandler {
  return (request, response, next) => {
    const length = Number(request.headers['content-length'] ?? 0);
    const hasBody = length > 0 || request.headers['transfer-encoding'] !== undefined;
    if (SAFE.has(request.method) || !hasBody || under(request.path, PREFIX.hook)) return next();
    if (uploads.some((pattern) => pattern.test(request.path))) return next();
    if (request.is('application/json') === 'application/json') return next();
    response.status(415).json({ code: 'UNSUPPORTED_TYPE' });
  };
}
