import { z } from 'zod';
import { isOwnService, parseUrl } from './urls';

const key = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, { error: '32 bytes in base64 expected' });
const origin = z.url().transform((value) => new URL(value).origin);
/** A malformed address is refused here, without being quoted anywhere. */
const address = (scheme: RegExp) => z.string().refine((value) => scheme.test(value) && parseUrl(value) !== null, { error: 'address expected' });
const schema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: address(/^postgresql:\/\//u),
  JOBS_DATABASE_URL: address(/^postgresql:\/\//u).optional(),
  MIGRATION_DATABASE_URL: address(/^postgresql:\/\//u).optional(),
  VALKEY_URL: address(/^rediss?:\/\//u),
  VAULT_MASTER_KEY: key,
  VAULT_MASTER_KEY_PREVIOUS: key.optional(),
  SESSION_SIGNING_KEY: key,
  SESSION_SIGNING_KEY_PREVIOUS: key.optional(),
  STAFF_PORTAL_URL: origin.default('http://localhost:5173'),
  PARTNER_PORTAL_URL: origin.default('http://localhost:5174'),
  DEBTOR_PORTAL_URL: origin.default('http://localhost:5175'),
  /** Number of proxies in front of the API: Caddy, and nothing else. */
  TRUSTED_PROXIES: z.coerce.number().int().min(0).max(2).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  MYSENDINGBOX_ENV: z.enum(['test', 'production']).default('test'),
  /** Absent: the AI is off, whatever the settings say. */
  AI_ENABLED: z.literal('true').optional(),
});

export type Config = Readonly<z.infer<typeof schema>>;
export const CONFIG = Symbol('CONFIG');

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Reads the startup values. An error names the variables, never their content. */
export function readConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ConfigError(`Missing or invalid startup values: ${names.join(', ')}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    const plain = (['STAFF_PORTAL_URL', 'PARTNER_PORTAL_URL', 'DEBTOR_PORTAL_URL'] as const).filter((name) => !env[name]?.startsWith('https://'));
    if (plain.length) throw new ConfigError(`https:// expected in production: ${plain.join(', ')}`);
    return Object.freeze(config);
  }
  // Production runs on the development machine too, on the standard ports: they are never used outside of it.
  const foreign = (['DATABASE_URL', 'JOBS_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'VALKEY_URL'] as const).filter((name) => {
    const value = config[name];
    return value !== undefined && !isOwnService(value);
  });
  if (foreign.length) throw new ConfigError(`Outside production, only 127.0.0.1 and never port 5432 or 6379: ${foreign.join(', ')}`);
  // No live key and no real bucket outside production, even by mistake.
  const live = Object.keys(env).filter((name) => env[name]?.startsWith('live_'));
  if (live.length) throw new ConfigError(`Live keys refused outside production: ${live.join(', ')}`);
  if (env.SCW_DOCUMENTS_BUCKET === 'legarec-documents') throw new ConfigError('Production bucket refused outside production: SCW_DOCUMENTS_BUCKET');
  if (config.MYSENDINGBOX_ENV === 'production') throw new ConfigError('Real letters refused outside production: MYSENDINGBOX_ENV');
  return Object.freeze(config);
}
