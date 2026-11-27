import { z } from 'zod';
import { isDatabaseUrl, isOwnService, isValkeyUrl } from './urls';

const key = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, { error: '32 bytes in base64 expected' });
const origin = z.url().transform((value) => new URL(value).origin);
/** A malformed address is refused here, without being quoted anywhere. */
const database = z.string().refine(isDatabaseUrl, { error: 'address expected' });
const emptyAsAbsent = (value: unknown) => (value === '' ? undefined : value);
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
  /** `production`: the reminders leave for the debtors. Otherwise, whatever NODE_ENV says, only for test addresses. */
  RESEND_ENV: z.enum(['test', 'production']).default('test'),
  /** Absent: the AI is off, whatever the settings say. */
  AI_ENABLED: z.literal('true').optional(),
  /** The two levels of model (docs/ia.md): absent, the AI is off. Never a name in the code. */
  IA_MODELE_RAPIDE: z
    .string()
    .regex(/^[\w.:/-]{1,120}$/u)
    .optional(),
  IA_MODELE_AVANCE: z
    .string()
    .regex(/^[\w.:/-]{1,120}$/u)
    .optional(),
  /** The provider behind the single interface; `simulated` outside production only. */
  AI_PROVIDER: z.enum(['anthropic', 'openai-compatible', 'simulated']).optional(),
  /** Address of a provider compatible with OpenAI (OVHcloud, or the server of the firm). */
  AI_BASE_URL: z.url().optional(),
  /** What a million tokens costs, in euros, sent and received: without it, no budget can be kept, and the AI stays off. */
  AI_PRICE_INPUT: z.coerce.number().min(0).max(1000).optional(),
  AI_PRICE_OUTPUT: z.coerce.number().min(0).max(1000).optional(),
  /** Folder of the documents (a volume in production): all of them without a bucket, those written before it otherwise. Required in production. */
  DOCUMENTS_DIR: z.string().startsWith('/').optional(),
  /**
   * Bucket of the documents at OVHcloud, and its region (`eu-west-par`): with both, and the two keys in the vault, the
   * files go to the bucket; otherwise they stay in `DOCUMENTS_DIR`. A line left empty counts as absent. In production
   * only: development and the tests keep their files on the disk.
   */
  S3_DOCUMENTS_BUCKET: z.preprocess(
    emptyAsAbsent,
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u)
      .optional(),
  ),
  S3_REGION: z.preprocess(
    emptyAsAbsent,
    z
      .string()
      .regex(/^[a-z0-9-]{2,40}$/u)
      .optional(),
  ),
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
  /** Outside production only: addresses of the firm a test key of Resend may write to, besides `@resend.dev`. */
  DEV_RECIPIENTS: z
    .string()
    .max(2000)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.email()).max(20))
    .optional(),
  /** clamd of the server (`tcp://clamav:3310`). Absent in production: files wait, unread, for the antivirus. */
  CLAMAV_URL: z
    .string()
    .regex(/^tcp:\/\/[a-z0-9.-]+:\d{1,5}$/u)
    .optional(),
  /** Chromium of the image, for the PDF; absent: that of Playwright (development, tests). */
  CHROMIUM_PATH: z.string().startsWith('/').optional(),
});

export type Config = Readonly<z.infer<typeof apiSchema>>;
export type WorkerConfig = Readonly<z.infer<typeof workerSchema>>;
export const CONFIG = Symbol('CONFIG');

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Env = Record<string, string | undefined>;
/** Reads the startup values. An error names the variables, never their content. */
function read<T extends z.ZodType<Partial<Config> & Pick<Config, 'NODE_ENV' | 'MYSENDINGBOX_ENV' | 'RESEND_ENV'>>>(schema: T, env: Env): Readonly<z.infer<T>> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
    throw new ConfigError(`Missing or invalid startup values: ${names.join(', ')}`);
  }
  const config = parsed.data;
  // No bucket at all outside production, whatever its name: with keys in the vault, the real provider would be called.
  // Refused first, whatever else is wrong with it.
  if (config.NODE_ENV !== 'production' && config.S3_DOCUMENTS_BUCKET) throw new ConfigError('Bucket refused outside production: S3_DOCUMENTS_BUCKET');
  if (config.S3_DOCUMENTS_BUCKET && !config.S3_REGION) throw new ConfigError('Missing or invalid startup values: S3_REGION');
  if (config.NODE_ENV === 'production') {
    const plain = (['STAFF_PORTAL_URL', 'PARTNER_PORTAL_URL', 'DEBTOR_PORTAL_URL'] as const).filter((name) => !env[name]?.startsWith('https://'));
    if (plain.length) throw new ConfigError(`https:// expected in production: ${plain.join(', ')}`);
    if (!config.DOCUMENTS_DIR) throw new ConfigError('Missing or invalid startup values: DOCUMENTS_DIR');
    if (config.AI_PROVIDER === 'simulated') throw new ConfigError('Missing or invalid startup values: AI_PROVIDER');
    return Object.freeze(config);
  }
  // Production runs on the development machine too, on the standard ports: they are never used outside of it.
  const foreign = (['DATABASE_URL', 'JOBS_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'VALKEY_URL'] as const).filter((name) => {
    const value = config[name];
    return value !== undefined && !isOwnService(value);
  });
  if (foreign.length) throw new ConfigError(`Outside production, only 127.0.0.1 and never port 5432 or 6379: ${foreign.join(', ')}`);
  // No live key outside production, even by mistake.
  const live = Object.keys(env).filter((name) => env[name]?.startsWith('live_'));
  if (live.length) throw new ConfigError(`Live keys refused outside production: ${live.join(', ')}`);
  if (config.MYSENDINGBOX_ENV === 'production') throw new ConfigError('Real letters refused outside production: MYSENDINGBOX_ENV');
  if (config.RESEND_ENV === 'production') throw new ConfigError('Real e-mails refused outside production: RESEND_ENV');
  return Object.freeze(config);
}

export const readConfig = (env: Env): Config => read(apiSchema, env);
export function readWorkerConfig(env: Env): WorkerConfig {
  const config = read(workerSchema, env);
  if (config.NODE_ENV === 'production' && config.DEV_MAIL_DIR) throw new ConfigError('Refused in production: DEV_MAIL_DIR');
  if (config.NODE_ENV === 'production' && config.DEV_RECIPIENTS) throw new ConfigError('Refused in production: DEV_RECIPIENTS');
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
