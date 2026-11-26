import { z } from 'zod';
import { isDatabaseUrl, isOwnService, isValkeyUrl } from './urls';

const key = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, { error: '32 bytes in base64 expected' });
const origin = z.url().transform((value) => new URL(value).origin);
/** A malformed address is refused here, without being quoted anywhere. */
const database = z.string().refine(isDatabaseUrl, { error: 'address expected' });
const common = {
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  VALKEY_URL: z.string().refine(isValkeyUrl, { error: 'address expected' }),
  VAULT_MASTER_KEY: key,
  VAULT_MASTER_KEY_PREVIOUS: key.optional(),
  SESSION_SIGNING_KEY: key,
  SESSION_SIGNING_KEY_PREVIOUS: key.optional(),
  STAFF_PORTAL_URL: origin.default('http://localhost:5173'),
  PARTNER_PORTAL_URL: origin.default('http://localhost:5174'),
  DEBTOR_PORTAL_URL: origin.default('http://localhost:5175'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  MYSENDINGBOX_ENV: z.enum(['test', 'production']).default('test'),
  /** Absent: the AI is off, whatever the settings say. */
  AI_ENABLED: z.literal('true').optional(),
  /** Folder of the documents (a volume in production, until the bucket of lot X). Required in production. */
  DOCUMENTS_DIR: z.string().startsWith('/').optional(),
};
/** Each program has its own account, and needs no other. One that is there all the same is checked too. */
const accounts = { DATABASE_URL: database.optional(), JOBS_DATABASE_URL: database.optional(), MIGRATION_DATABASE_URL: database.optional() };
const apiSchema = z.object({
  ...common,
  ...accounts,
  DATABASE_URL: database,
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Number of proxies in front of the API: Caddy, and nothing else. */
  TRUSTED_PROXIES: z.coerce.number().int().min(0).max(2).default(1),
});
const workerSchema = z.object({
  ...common,
  ...accounts,
  JOBS_DATABASE_URL: database,
  /** Development only: folder where the simulated messages are written. */
  DEV_MAIL_DIR: z.string().startsWith('/').optional(),
  /** clamd of the server (`tcp://clamav:3310`). Absent in production: files wait, unread, for the antivirus. */
  CLAMAV_URL: z
    .string()
    .regex(/^tcp:\/\/[a-z0-9.-]+:\d{1,5}$/u)
    .optional(),
});

export type Config = Readonly<z.infer<typeof apiSchema>>;
export type WorkerConfig = Readonly<z.infer<typeof workerSchema>>;
export const CONFIG = Symbol('CONFIG');

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Env = Record<string, string | undefined>;
/** Reads the startup values. An error names the variables, never their content. */
function read<T extends z.ZodType<Partial<Config> & Pick<Config, 'NODE_ENV' | 'MYSENDINGBOX_ENV'>>>(schema: T, env: Env): Readonly<z.infer<T>> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ConfigError(`Missing or invalid startup values: ${names.join(', ')}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    const plain = (['STAFF_PORTAL_URL', 'PARTNER_PORTAL_URL', 'DEBTOR_PORTAL_URL'] as const).filter((name) => !env[name]?.startsWith('https://'));
    if (plain.length) throw new ConfigError(`https:// expected in production: ${plain.join(', ')}`);
    if (!config.DOCUMENTS_DIR) throw new ConfigError('Missing or invalid startup values: DOCUMENTS_DIR');
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

export const readConfig = (env: Env): Config => read(apiSchema, env);
export function readWorkerConfig(env: Env): WorkerConfig {
  const config = read(workerSchema, env);
  if (config.NODE_ENV === 'production' && config.DEV_MAIL_DIR) throw new ConfigError('Refused in production: DEV_MAIL_DIR');
  return config;
}

/** Address given to the migrations, and to nothing else. */
export function readMigrationUrl(env: Env): string {
  const url = env.MIGRATION_DATABASE_URL;
  if (!url || !isDatabaseUrl(url)) throw new ConfigError('Missing or invalid startup values: MIGRATION_DATABASE_URL');
  if (env.NODE_ENV !== 'production' && !isOwnService(url))
    throw new ConfigError('Outside production, only 127.0.0.1 and never port 5432 or 6379: MIGRATION_DATABASE_URL');
  return url;
}
