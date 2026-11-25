import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from './config';

const base = () => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:pw@127.0.0.1:55432/legarec_dev',
  VALKEY_URL: 'redis://:pw@127.0.0.1:56379/0',
  VAULT_MASTER_KEY: randomBytes(32).toString('base64'),
  SESSION_SIGNING_KEY: randomBytes(32).toString('base64'),
});
const portals = {
  STAFF_PORTAL_URL: 'https://espace.legarec.fr',
  PARTNER_PORTAL_URL: 'https://partenaires.legarec.fr',
  DEBTOR_PORTAL_URL: 'https://paiement.legarec.fr',
};

describe('startup values', () => {
  it('names what is missing, without any value', () => {
    const secret = randomBytes(16).toString('hex');
    try {
      readConfig({ ...base(), VAULT_MASTER_KEY: secret, SESSION_SIGNING_KEY: undefined });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toBe('Missing or invalid startup values: SESSION_SIGNING_KEY, VAULT_MASTER_KEY');
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it.each([
    ['DATABASE_URL', 'postgresql://app:pw@127.0.0.1:5432/legarec'],
    ['DATABASE_URL', 'postgresql://app:pw@127.0.0.1/legarec'],
    ['DATABASE_URL', 'postgresql://app:pw@db.exemple.test:55432/legarec'],
    ['JOBS_DATABASE_URL', 'postgresql://jobs:pw@127.0.0.1:5432/legarec'],
    ['VALKEY_URL', 'redis://127.0.0.1:6379'],
  ])('never reaches the services of production: %s', (name, value) => {
    expect(() => readConfig({ ...base(), [name]: value })).toThrow(name);
  });

  it('refuses a live key, the real bucket and real letters outside production', () => {
    expect(() => readConfig({ ...base(), MYSENDINGBOX_API_KEY: 'live_x' })).toThrow('MYSENDINGBOX_API_KEY');
    expect(() => readConfig({ ...base(), SCW_DOCUMENTS_BUCKET: 'legarec-documents' })).toThrow('SCW_DOCUMENTS_BUCKET');
    expect(() => readConfig({ ...base(), MYSENDINGBOX_ENV: 'production' })).toThrow('MYSENDINGBOX_ENV');
  });

  it('requires the three portals over https in production', () => {
    const production = {
      ...base(),
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:pw@postgres:5432/legarec',
      VALKEY_URL: 'redis://:pw@valkey:6379/0',
    };
    expect(() => readConfig(production)).toThrow('STAFF_PORTAL_URL, PARTNER_PORTAL_URL, DEBTOR_PORTAL_URL');
    expect(readConfig({ ...production, ...portals })).toMatchObject({ STAFF_PORTAL_URL: 'https://espace.legarec.fr', MYSENDINGBOX_ENV: 'test' });
  });

  it('keeps the AI off unless it is explicitly on', () => {
    expect(readConfig(base()).AI_ENABLED).toBeUndefined();
    expect(() => readConfig({ ...base(), AI_ENABLED: '1' })).toThrow('AI_ENABLED');
  });
});

describe('addresses of the services', () => {
  const url = (value: string) => ({ ...base(), DATABASE_URL: value });
  it.each([
    'postgresql://app:pw@127.0.0.1:55432/legarec_dev',
    'postgresql://app:pw@localhost:55432/legarec_dev',
    'postgresql://app:pw@[::1]:55432/legarec_dev',
    'postgresql://app:p%40ss%2Fw%3F@127.0.0.1:55432/legarec_dev',
  ])('may be this machine: %s', (value) => {
    expect(readConfig(url(value)).DATABASE_URL).toBe(value);
  });

  it.each([
    'postgresql://app:pw@[::1]:5432/legarec',
    'postgresql://app:pw@[::1]/legarec',
    'postgresql://app:pw@[fe80::1]:55432/legarec',
    'postgresql://app:pw@[::ffff:127.0.0.1]:55432/legarec',
    'postgresql://app:pw@[::]:55432/legarec',
    'postgresql://app:pw@0.0.0.0:55432/legarec',
    'postgresql://app:pw@127.0.0.1:05432/legarec',
    'postgresql://app:pw@127.0.0.1:6379/legarec',
    'postgresql://app:pw@127.0.0.1.exemple.test:55432/legarec',
    'postgresql://127.0.0.1:55432@db.exemple.test:55432/legarec',
    'postgresql://app:pw@127.0.0.1,db.exemple.test:55432/legarec',
    'postgresql://app:pw@localhost.:55432/legarec',
    'postgresql:///legarec',
    'postgresql://',
  ])('are refused elsewhere: %s', (value) => {
    expect(() => readConfig(url(value))).toThrow(ConfigError);
    expect(() => readConfig(url(value))).toThrow('DATABASE_URL');
  });

  // Defect: `pg` reads `host` and `port` in the query of the URL, and they win over the address that is checked.
  it.fails.each([
    'postgresql://app:pw@127.0.0.1:55432/legarec?host=db.exemple.test',
    'postgresql://app:pw@127.0.0.1:55432/legarec?port=5432',
    'postgresql://app:pw@127.0.0.1:55432/legarec?sslmode=disable&host=/var/run/postgresql',
  ])('are refused when the query hides another one: %s', (value) => {
    expect(() => readConfig(url(value))).toThrow('DATABASE_URL');
  });

  it.each([
    ['DATABASE_URL', 'mysql://app:zz-secret-zz@127.0.0.1:55432/x'],
    ['DATABASE_URL', 'zz-secret-zz'],
    ['DATABASE_URL', ''],
    ['JOBS_DATABASE_URL', 'http://zz-secret-zz'],
    ['VALKEY_URL', 'http://:zz-secret-zz@127.0.0.1:56379'],
    ['STAFF_PORTAL_URL', 'zz-secret-zz'],
  ])('are named, never quoted, when they are not addresses: %s', (name, value) => {
    const read = () => readConfig({ ...base(), [name]: value });
    expect(read).toThrow(ConfigError);
    expect(read).toThrow(`Missing or invalid startup values: ${name}`);
  });

  // Defect: `new URL()` throws an error that carries the whole address, password included, and Node prints it when the API stops.
  it.fails.each([
    ['DATABASE_URL', 'postgresql://app:zz-secret-zz@127.0.0.1:99999/legarec'],
    ['JOBS_DATABASE_URL', 'postgresql://jobs:zz-secret-zz@127.0.0.1:port/legarec'],
    ['VALKEY_URL', 'redis://:zz-secret-zz@[127.0.0.1]:56379/0'],
  ])('are named, never quoted, when they are malformed: %s', (name, value) => {
    let error: unknown;
    try {
      readConfig({ ...base(), [name]: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain(name);
    expect(`${(error as Error).message} ${JSON.stringify(error)}`).not.toContain('zz-secret-zz');
  });
});

describe('values that protect', () => {
  it.each([
    ['VAULT_MASTER_KEY', randomBytes(31).toString('base64')],
    ['VAULT_MASTER_KEY', randomBytes(33).toString('base64')],
    ['VAULT_MASTER_KEY', randomBytes(32).toString('hex')],
    ['SESSION_SIGNING_KEY', randomBytes(16).toString('base64')],
    ['VAULT_MASTER_KEY_PREVIOUS', randomBytes(16).toString('base64')],
    ['SESSION_SIGNING_KEY_PREVIOUS', ''],
    // Every address of the header would be believed.
    ['TRUSTED_PROXIES', 'true'],
    ['TRUSTED_PROXIES', '3'],
    ['TRUSTED_PROXIES', '-1'],
    ['LOG_LEVEL', 'trace'],
    ['NODE_ENV', 'prod'],
    ['PORT', '70000'],
    ['MYSENDINGBOX_ENV', 'live'],
  ])('are refused when they do not: %s', (name, value) => {
    expect(() => readConfig({ ...base(), [name]: value })).toThrow(`Missing or invalid startup values: ${name}`);
  });

  it('apply to development when nothing says what the environment is', () => {
    const { NODE_ENV: _unset, ...rest } = base();
    expect(readConfig(rest).NODE_ENV).toBe('development');
    expect(() => readConfig({ ...rest, DATABASE_URL: 'postgresql://app:pw@postgres:5432/legarec' })).toThrow('DATABASE_URL');
    expect(() => readConfig({ ...rest, MYSENDINGBOX_ENV: 'production' })).toThrow('MYSENDINGBOX_ENV');
  });

  it('apply to the tests like to development', () => {
    const tests = { ...base(), NODE_ENV: 'test' };
    expect(() => readConfig({ ...tests, VALKEY_URL: 'redis://127.0.0.1:6379' })).toThrow('VALKEY_URL');
    expect(() => readConfig({ ...tests, MYSENDINGBOX_ENV: 'production' })).toThrow('MYSENDINGBOX_ENV');
  });

  it('refuse a live key under any name, and name it without showing it', () => {
    try {
      readConfig({ ...base(), ANY_OTHER_NAME: 'live_zz-secret-zz' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('ANY_OTHER_NAME');
      expect((error as Error).message).not.toContain('zz-secret-zz');
    }
  });

  it('cannot be changed once read', () => {
    const config = readConfig(base());
    expect(() => Object.assign(config, { MYSENDINGBOX_ENV: 'production' })).toThrow(TypeError);
    expect(config.MYSENDINGBOX_ENV).toBe('test');
  });

  it('in production: exact https origins only, and real letters only when asked for', () => {
    const production = {
      ...base(),
      ...portals,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://app:pw@postgres:5432/legarec',
      VALKEY_URL: 'redis://:pw@valkey:6379/0',
    };
    expect(readConfig({ ...production, STAFF_PORTAL_URL: 'https://espace.legarec.fr/chemin?x=1' }).STAFF_PORTAL_URL).toBe('https://espace.legarec.fr');
    for (const name of Object.keys(portals)) {
      expect(() => readConfig({ ...production, [name]: 'http://espace.legarec.fr' }), name).toThrow(name);
      expect(() => readConfig({ ...production, [name]: undefined }), name).toThrow(name);
    }
    expect(readConfig(production).MYSENDINGBOX_ENV).toBe('test');
    expect(readConfig({ ...production, MYSENDINGBOX_ENV: 'production' }).MYSENDINGBOX_ENV).toBe('production');
    expect(Object.isFrozen(readConfig(production))).toBe(true);
  });
});
