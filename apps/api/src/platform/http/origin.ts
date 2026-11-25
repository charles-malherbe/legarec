import type { Config } from '../config/config';

/** First segment of the path of each portal: a route cannot leave its own. */
export const PREFIX = {
  staff: '/staff',
  partner: '/partner',
  debtor: '/debtor',
  public: '/public',
  hook: '/hooks',
  service: '/service',
  health: '/health',
} as const;
export type Portal = keyof typeof PREFIX;

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Portal of a path. Exactly one of the prefixes, in lower case: `/STAFF` is nobody's. */
export function portalOf(path: string): Portal | null {
  const first = `/${path.split('/')[1] ?? ''}`;
  return (Object.keys(PREFIX) as Portal[]).find((portal) => PREFIX[portal] === first) ?? null;
}

export function originOfPortal(portal: Portal, config: Config): string | null {
  if (portal === 'staff') return config.STAFF_PORTAL_URL;
  if (portal === 'partner') return config.PARTNER_PORTAL_URL;
  return portal === 'debtor' ? config.DEBTOR_PORTAL_URL : null;
}

/** Exactly the origin of the portal, and present for any change: no other page can read an answer or send an order. */
export function acceptsOrigin(portal: Portal, method: string, origin: string | undefined, config: Config): boolean {
  const expected = originOfPortal(portal, config);
  if (expected === null) return true;
  return origin === undefined ? SAFE.has(method) : origin === expected;
}
