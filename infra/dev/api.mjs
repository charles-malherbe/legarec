#!/usr/bin/env node
// Starts the API and the worker for development: services, migrations, build on change, restart.
// The test keys of the firm, if any, come from the `.env` of this checkout; their values are never printed.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { start, values } from './services.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const API = join(ROOT, 'apps', 'api');
const ENV_FILE = join(ROOT, '.env');

await start();
/** Test keys a `.env` may give: nothing else of it reaches a program. The services of this machine always win. */
const TEST_KEYS = ['RESEND_API_KEY', 'RESEND_ACCOUNT_API_KEY', 'RESEND_WEBHOOK_SECRET', 'MYSENDINGBOX_TEST_API_KEY', 'DEV_RECIPIENTS'];
const own = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
const services = values();
const pick = (source, names) => Object.fromEntries(names.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
const COMMON = ['VALKEY_URL', 'VAULT_MASTER_KEY', 'SESSION_SIGNING_KEY'];
/** Each program receives what it needs, and a single account of PostgreSQL: its own. */
const NEEDS = { migrate: ['MIGRATION_DATABASE_URL'], main: [...COMMON, 'DATABASE_URL'], worker: [...COMMON, 'JOBS_DATABASE_URL'] };
const envOf = (name) => ({
  ...pick(process.env, ['PATH', 'HOME', 'LANG', 'TZ', 'LOG_LEVEL']),
  NODE_ENV: 'development',
  PORT: process.env.PORT ?? '3000',
  ...(name === 'migrate' ? {} : pick(own, TEST_KEYS)),
  ...pick(services, NEEDS[name]),
});
const run = (name) => spawn(process.execPath, ['--enable-source-maps', `dist/${name}.js`], { cwd: API, env: envOf(name), stdio: 'inherit' });
const wait = (child) => new Promise((resolve) => child.once('exit', resolve));

const { build } = await import(createRequire(join(API, 'package.json')).resolve('vite'));

let children = [];
async function restart() {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(wait));
  children = [];
  if ((await wait(run('migrate'))) !== 0) return;
  children = ['main', 'worker'].map(run);
}
const watcher = await build({ root: API, configFile: join(API, 'vite.config.ts'), logLevel: 'warn', build: { watch: {} } });
watcher.on('event', (event) => {
  if (event.code === 'END') void restart();
  if (event.code === 'ERROR') console.error(event.error.message);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of children) child.kill('SIGTERM');
    void watcher.close().then(() => process.exit(0));
  });
}
