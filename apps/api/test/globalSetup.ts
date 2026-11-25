import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { isOwnService } from '../src/platform/config/urls';
import { migrate } from '../src/platform/database/migrate';

const API = fileURLToPath(new URL('..', import.meta.url));
const MIGRATIONS = join(API, 'prisma', 'migrations');

declare module 'vitest' {
  interface ProvidedContext {
    adminUrl: string;
    /** Start of the name of every database of this run. */
    testPrefix: string;
    template: string;
    valkeyUrl: string;
    /** Passwords of the login roles, for this machine only. */
    passwords: { owner: string; app: string; jobs: string };
  }
}

/** Production listens on the standard ports of this machine: a test never goes near them. */
export function assertTestUrl(value: string, name: string): string {
  if (!isOwnService(value)) throw new Error(`${name}: tests only run on 127.0.0.1, never on port 5432 or 6379.`);
  return value;
}

async function settings() {
  const { TEST_ADMIN_DATABASE_URL, TEST_VALKEY_URL } = process.env;
  // GitHub Actions provides both services; elsewhere the development ones are started when needed.
  if (TEST_ADMIN_DATABASE_URL && TEST_VALKEY_URL) {
    const secret = () => randomBytes(18).toString('base64url');
    return { adminUrl: TEST_ADMIN_DATABASE_URL, valkeyUrl: TEST_VALKEY_URL, passwords: { owner: secret(), app: secret(), jobs: secret() }, managed: false };
  }
  const services = (await import(new URL('../../../infra/dev/services.mjs', import.meta.url).href)) as {
    start(): Promise<void>;
    values(): Record<string, string>;
  };
  await services.start();
  const values = services.values();
  const password = (name: string) => new URL(values[name] ?? '').password;
  return {
    adminUrl: values.TEST_ADMIN_DATABASE_URL ?? '',
    valkeyUrl: values.VALKEY_URL ?? '',
    passwords: { owner: password('MIGRATION_DATABASE_URL'), app: password('DATABASE_URL'), jobs: password('JOBS_DATABASE_URL') },
    managed: true,
  };
}

const PREFIX = /^legarec_test_([0-9a-z]+)_/u;
/** Databases left by a run that was interrupted: an hour old, or of a time when the name did not say it. */
const isStale = (name: string) => {
  const started = PREFIX.exec(name)?.[1];
  return started ? Number.parseInt(started, 36) < Date.now() - 3_600_000 : /^legarec_test_[0-9a-f]{12}$/u.test(name);
};

/** Migrations run once, in a template database named after their content; each test file clones it. */
export default async function setup(project: TestProject) {
  const { adminUrl, valkeyUrl, passwords, managed } = await settings();
  assertTestUrl(adminUrl, 'TEST_ADMIN_DATABASE_URL');
  assertTestUrl(valkeyUrl, 'TEST_VALKEY_URL');
  const bootstrap = readFileSync(join(API, 'prisma', 'bootstrap.sql'), 'utf8');
  const hash = createHash('sha256').update(bootstrap);
  for (const name of readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    hash.update(name).update(readFileSync(join(MIGRATIONS, name, 'migration.sql')));
  }
  const template = `legarec_tpl_${hash.digest('hex').slice(0, 12)}`;
  const testPrefix = `legarec_test_${Date.now().toString(36)}_`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock(714001)');
    if (!managed) {
      await admin.query(bootstrap);
      for (const [role, password] of Object.entries(passwords)) await admin.query(`ALTER ROLE legarec_${role} PASSWORD ${admin.escapeLiteral(password)}`);
    }
    // Other checkouts of the repository run their tests here too: a template nobody has used for a day is dropped, not theirs.
    const { rows } = await admin.query<{ datname: string; used: string | null }>(
      "SELECT datname, shobj_description(oid, 'pg_database') AS used FROM pg_database WHERE datname ~ '^legarec_(tpl|template|test)_'",
    );
    const unused = (used: string | null) => Number(used ?? 0) < Date.now() - 86_400_000;
    const old = rows.filter(({ datname, used }) => datname !== template && (datname.startsWith('legarec_test_') ? isStale(datname) : unused(used)));
    for (const { datname } of old) await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeIdentifier(datname)} WITH (FORCE)`);
    if (!rows.some((row) => row.datname === template)) {
      const building = `${template}_building`;
      await admin.query(`DROP DATABASE IF EXISTS ${building} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${building} OWNER legarec_owner`);
      const url = new URL(adminUrl);
      url.username = 'legarec_owner';
      url.password = passwords.owner;
      url.pathname = `/${building}`;
      await migrate(url.href, MIGRATIONS);
      await admin.query(`ALTER DATABASE ${building} RENAME TO ${template}`);
    }
    await admin.query(`COMMENT ON DATABASE ${template} IS '${Date.now()}'`);
  } finally {
    await admin.end();
  }
  project.provide('adminUrl', adminUrl);
  project.provide('testPrefix', testPrefix);
  project.provide('template', template);
  project.provide('valkeyUrl', valkeyUrl);
  project.provide('passwords', passwords);
  // Whatever a test file left behind, even when it failed before its end.
  return async () => {
    const last = new pg.Client({ connectionString: adminUrl });
    await last.connect();
    try {
      const { rows } = await last.query<{ datname: string }>('SELECT datname FROM pg_database WHERE starts_with(datname, $1)', [testPrefix]);
      for (const { datname } of rows) await last.query(`DROP DATABASE IF EXISTS ${last.escapeIdentifier(datname)} WITH (FORCE)`);
    } finally {
      await last.end();
    }
  };
}
