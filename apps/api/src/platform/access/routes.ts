import { RequestMethod, type INestApplicationContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PREFIX } from '../http/origin';
import { COMMITS, KEYED_PORTALS, NO_TRANSACTION } from '../http/transaction.interceptor';
import { ACCESS, type AccessRule } from './access';
import { PROOF } from './proof';

export interface RouteInfo {
  /** `GET /staff/cases/:id` */
  id: string;
  access: AccessRule | undefined;
  commits: boolean;
  /** Needs a recent proof of identity. */
  proof: boolean;
  ownTransactions: boolean;
  /** Parameters read from the body or the query without any schema, or from the request by hand. */
  unchecked: string[];
}

/** Numbers of NestJS for `@Body()`, `@Query()` and `@Param()`. The decorators of the platform have no number. */
const BODY = 3;
const QUERY = 4;
const PARAM = 5;
const join = (...parts: string[]) =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`;
const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [typeof value === 'string' ? value : '']);

function uncheckedOf(metatype: object, name: string): string[] {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, name) ?? {}) as Record<string, { schema?: unknown }>;
  return Object.entries(args).flatMap(([key, { schema }]) => {
    const kind = Number(key.split(':')[0]);
    if (Number.isNaN(kind) || kind === PARAM) return [];
    if (kind === BODY || kind === QUERY) return schema === undefined ? [kind === BODY ? 'body' : 'query'] : [];
    return ['request'];
  });
}

/** Every route of the application, read from NestJS itself. */
export function routesOf(app: INestApplicationContext): RouteInfo[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const scanner = app.get(MetadataScanner, { strict: false });
  const reflector = app.get(Reflector, { strict: false });
  return discovery.getControllers().flatMap(({ instance, metatype }) => {
    if (!metatype) return [];
    const prototype = (metatype as { prototype: object }).prototype;
    return scanner.getAllMethodNames(prototype).flatMap((name) => {
      const handler = ((instance ?? prototype) as Record<string, () => unknown>)[name]!;
      const method = reflector.get<RequestMethod | undefined>(METHOD_METADATA, handler);
      if (method === undefined) return [];
      const flag = <T>(key: symbol) => reflector.getAllAndOverride<T | undefined>(key, [handler, metatype]);
      const info = {
        access: flag<AccessRule>(ACCESS),
        commits: flag<boolean>(COMMITS) === true,
        proof: flag<boolean>(PROOF) === true,
        ownTransactions: flag<boolean>(NO_TRANSACTION) === true,
        unchecked: uncheckedOf(metatype, name),
      };
      return list(reflector.get(PATH_METADATA, metatype)).flatMap((base) =>
        list(reflector.get(PATH_METADATA, handler)).map((path) => ({ id: `${RequestMethod[method]} ${join(base, path)}`, ...info })),
      );
    });
  });
}

function faultOf({ id, access, commits, ownTransactions, unchecked }: RouteInfo): string | null {
  const [method = '', path = ''] = id.split(' ');
  if (!access) return 'no access rule';
  if (path !== PREFIX[access.portal] && !path.startsWith(`${PREFIX[access.portal]}/`)) return 'outside the prefix of its portal';
  if (method === 'ALL') return 'answers every method';
  if (unchecked.includes('request')) return 'reads the request by hand';
  if (unchecked.length) return `${unchecked.join(' and ')} without schema`;
  if (commits && (method === 'GET' || method === 'HEAD')) return 'commits on a reading';
  if (commits && ownTransactions) return 'commits outside of the transaction of the request';
  if (commits && (!KEYED_PORTALS.has(access.portal) || ('anonymous' in access && access.anonymous))) return 'commits without anyone to hold the key';
  return null;
}

/** Stops the API when a route breaks a rule that would otherwise be ignored in silence. */
export function checkRoutes(routes: readonly RouteInfo[]): void {
  const faults = routes.flatMap((route) => {
    const fault = faultOf(route);
    return fault ? [`${route.id}: ${fault}`] : [];
  });
  if (faults.length) throw new Error(`Routes refused: ${faults.join('; ')}`);
}
