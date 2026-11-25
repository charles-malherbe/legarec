import { randomBytes, randomUUID } from 'node:crypto';
import { generateSync } from 'otplib';
import { vi } from 'vitest';
import { CHEAP, type TestApp } from './app';

export const PASSWORD = 'Trois-mots-bien-choisis-7';
export const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
/** Each on its own network, so that the limits of one test do not stop another. */
export const newAddress = () => `10.${randomBytes(3).join('.')}`;

export interface Answer {
  status: number;
  body: unknown;
  headers: Headers;
}

/** A browser: its cookies, its name and its network. */
export class Browser {
  /** `Set-Cookie` lines of the last answer. */
  set: string[] = [];
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly test: TestApp,
    readonly portal: 'staff' | 'partner' = 'staff',
    private readonly options: { ip?: string; agent?: string } = {},
  ) {
    this.options = { ip: newAddress(), agent: CHROME, ...options };
  }

  get token(): string | undefined {
    return this.cookies.get(`__Host-${this.portal}`);
  }
  get device(): string | undefined {
    return this.cookies.get('__Host-device');
  }
  put(name: string, value: string): this {
    this.cookies.set(`__Host-${name}`, value);
    return this;
  }
  /** The same browser, after the session has ended: it is still recognised. */
  closed(): Browser {
    const next = new Browser(this.test, this.portal, this.options);
    return this.device ? next.put('device', this.device) : next;
  }

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
    const answer = await this.test.call(method, `/${this.portal}${path}`, {
      body,
      headers: {
        'user-agent': this.options.agent!,
        'x-forwarded-for': this.options.ip!,
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
        ...headers,
      },
    });
    this.set = answer.headers.getSetCookie();
    for (const line of this.set) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      if (line.endsWith('Max-Age=0')) this.cookies.delete(pair.slice(0, at));
      else this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return answer;
  }
  get = (path: string, headers?: Record<string, string>) => this.call('GET', path, undefined, headers);
  post = (path: string, body?: unknown, headers?: Record<string, string>) => this.call('POST', path, body, headers);
  change = (path: string, body?: unknown, headers?: Record<string, string>) => this.call('PUT', path, body, headers);
  delete = (path: string, headers?: Record<string, string>) => this.call('DELETE', path, undefined, headers);

  login(email: string, password = PASSWORD, remember = false): Promise<Answer> {
    return this.post('/auth/login', { email, password, remember, portal: this.portal === 'staff' ? 'espace' : 'partenaires' });
  }
  /** 200 for whoever is signed in. */
  session = () => this.get('/auth/session');
}

const rows = async <T extends object>({ database }: TestApp, sql: string, values: unknown[] = []) => (await database.admin.query<T>(sql, values)).rows;

export async function givePassword(test: TestApp, ...ids: string[]): Promise<void> {
  const hash = await CHEAP.hash(PASSWORD);
  await rows(test, 'UPDATE users SET password_hash = $1 WHERE id = ANY ($2::uuid[])', [hash, ids]);
}
export const emailOf = async (test: TestApp, id: string) => (await rows<{ email: string }>(test, 'SELECT email FROM users WHERE id = $1', [id]))[0]!.email;

/** One more account with a password, for a test that changes it. */
export async function newAccount(test: TestApp, { role = 'CLAIMS_OFFICER', creditorId = null as string | null, status = 'ACTIVE' } = {}) {
  const email = `${randomUUID()}@exemple.test`;
  const [row] = await rows<{ id: string }>(
    test,
    `INSERT INTO users (role, status, first_name, last_name, email, creditor_id, disabled_at)
     VALUES ($1, $2::user_status, 'Nora', 'Test', $3, $4, CASE WHEN $2::user_status = 'DISABLED' THEN now() END) RETURNING id`,
    [role, status, email, creditorId],
  );
  const { id } = row!;
  await givePassword(test, id);
  return { id, email };
}

/** In the middle of a step of the applications, and staying there: a code does not change between its reading and its use. */
export const freezeClock = () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Math.floor(Date.now() / 30_000) * 30_000 + 15_000 });
};
/** Code of the application for this key, as the telephone shows it; `steps` later or earlier. */
export const codeOf = (key: string, steps = 0) => generateSync({ secret: key.replace(/ /gu, ''), epoch: Math.floor(Date.now() / 1000) + steps * 30 });

/** Sets up the application of a signed-in account. */
export async function setUpTotp(browser: Browser): Promise<{ key: string; backupCodes: string[] }> {
  const { body } = await browser.post('/account/two-factor/totp');
  const { key } = body as { key: string };
  const answer = await browser.post('/account/two-factor/totp/verify', { code: codeOf(key, -1) });
  return { key, backupCodes: (answer.body as { backupCodes: string[] }).backupCodes };
}
