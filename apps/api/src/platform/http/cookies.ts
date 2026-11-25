import type { Response } from 'express';

/** `__Host-`: this host only, over HTTPS only, for the whole of it. Never readable by a script, never sent by another site. */
const ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';

export class CookieJar {
  private readonly received = new Map<string, string>();
  private readonly changed = new Map<string, string>();

  constructor(
    header: string | undefined,
    private readonly response: Response,
  ) {
    for (const part of (header ?? '').split(';')) {
      const at = part.indexOf('=');
      if (at > 0) this.received.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.received.get(`__Host-${name}`);
  }

  /** Without a duration, it ends with the browser. */
  set(name: string, value: string, seconds?: number): void {
    this.write(name, `__Host-${name}=${value}; ${ATTRIBUTES}${seconds === undefined ? '' : `; Max-Age=${seconds}`}`);
  }

  clear(name: string): void {
    this.write(name, `__Host-${name}=; ${ATTRIBUTES}; Max-Age=0`);
  }

  private write(name: string, cookie: string): void {
    this.changed.set(name, cookie);
    this.response.setHeader('Set-Cookie', [...this.changed.values()]);
  }
}
