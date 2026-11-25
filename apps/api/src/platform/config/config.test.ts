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
