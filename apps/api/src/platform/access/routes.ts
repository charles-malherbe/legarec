import { RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { ACCESS, PREFIX, type AccessRule } from './access';

export interface RouteInfo {
  /** `GET /staff/cases/:id` */
  id: string;
  access: AccessRule | undefined;
}

const join = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`;
const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [typeof value === 'string' ? value : '']);

/** Every route of the application, read from NestJS itself. */
export function routesOf(app: INestApplicationContext): RouteInfo[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const scanner = app.get(MetadataScanner, { strict: false });
  const reflector = app.get(Reflector, { strict: false });
  return discovery.getControllers().flatMap(({ instance, metatype }) => {
    if (!instance || !metatype) return [];
    const prototype = Object.getPrototypeOf(instance) as object;
    return scanner.getAllMethodNames(prototype).flatMap((name) => {
      const handler = (instance as Record<string, () => unknown>)[name]!;
      const method = reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
      if (method === undefined) return [];
      const access = reflector.getAllAndOverride<AccessRule | undefined>(ACCESS, [handler, metatype]);
      return list(reflector.get(PATH_METADATA, metatype)).flatMap((base) =>
        list(reflector.get(PATH_METADATA, handler)).map((path) => ({ id: `${RequestMethod[method]} ${join(base, path)}`, access })),
      );
    });
  });
}

/** Stops the API when a route has no rule, or leaves the prefix of its portal. */
export function checkRoutes(routes: readonly RouteInfo[]): void {
  const wrong = routes.filter(({ id, access }) => {
    if (!access) return true;
    const path = id.slice(id.indexOf(' ') + 1);
    return path !== PREFIX[access.portal] && !path.startsWith(`${PREFIX[access.portal]}/`);
  });
  if (wrong.length) throw new Error(`Routes without access rule, or outside their prefix: ${wrong.map((route) => route.id).join(', ')}`);
}
