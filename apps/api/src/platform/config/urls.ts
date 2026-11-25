const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
/** Standard ports of PostgreSQL and Valkey: taken by other services of the development machine. */
const STANDARD = ['', '5432', '6379'];

/** Parses without ever quoting the value: the error of Node would print a password. */
export function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}

/** Complete address of a database. Without a server or a name, `pg` would fall back on port 5432 of this machine. */
export function isDatabaseUrl(value: string): boolean {
  const url = /^postgresql:\/\//u.test(value) ? parseUrl(value) : null;
  return url !== null && url.hostname !== '' && url.pathname.length > 1;
}

/** Complete address of a Valkey, with a server. */
export function isValkeyUrl(value: string): boolean {
  const url = /^rediss?:\/\//u.test(value) ? parseUrl(value) : null;
  return url !== null && url.hostname !== '';
}

/**
 * Address of a service of development: this machine, a port of our own, and nothing hidden after it. `pg` lets a
 * parameter (`?host=`, `?port=`) override the address, so none is accepted.
 */
export function isOwnService(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && LOOPBACK.includes(url.hostname) && !STANDARD.includes(url.port) && url.search === '' && url.hash === '';
}
