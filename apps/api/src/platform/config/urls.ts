const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
/** Standard ports of PostgreSQL and Valkey: taken by other services of the development machine. */
const STANDARD = ['', '5432', '6379'];

/** Parses without ever quoting the value: the error of Node would print a password. */
export function parseUrl(value: string): URL | null {
  return URL.canParse(value) ? new URL(value) : null;
}

/**
 * Address of a service of development: this machine, a port of our own, and nothing hidden after it. `pg` lets a
 * parameter (`?host=`, `?port=`) override the address, so none is accepted.
 */
export function isOwnService(value: string): boolean {
  const url = parseUrl(value);
  return url !== null && LOOPBACK.includes(url.hostname) && !STANDARD.includes(url.port) && url.search === '' && url.hash === '';
}
