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
const own = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
// The services of this machine always win: a `.env` cannot point the API at another database.
const env = { ...own, ...process.env, NODE_ENV: 'development', PORT: process.env.PORT ?? '3000', ...values() };
const run = (command, args, options = {}) => spawn(command, args, { cwd: API, env, stdio: 'inherit', ...options });
const wait = (child) => new Promise((resolve) => child.once('exit', resolve));

if ((await wait(run('pnpm', ['exec', 'prisma', 'migrate', 'deploy']))) !== 0) process.exit(1);
const { build } = await import(createRequire(join(API, 'package.json')).resolve('vite'));

let children = [];
async function restart() {
  for (const child of children) child.kill('SIGTERM');
  await Promise.all(children.map(wait));
  children = ['main', 'worker'].map((name) => run(process.execPath, ['--enable-source-maps', `dist/${name}.js`]));
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
