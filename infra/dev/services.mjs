#!/usr/bin/env node
// PostgreSQL 17 and Valkey 8.1 for development and tests: no root, no system service, loopback only.
// This machine also runs production: installing the Debian packages would register services at boot that could
// take its ports. The same packages are therefore downloaded (apt-get checks them) and extracted in a private folder.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
export const POSTGRES_PORT = 55432;
export const VALKEY_PORT = 56379;
const HOME = process.env.LEGAREC_DEV_HOME ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'legarec-dev');
const DEBS = join(HOME, 'packages');
const ROOT = join(HOME, 'debian');
const DATA = join(HOME, 'postgres');
const CACHE = join(HOME, 'valkey');
const VALUES = join(HOME, 'values.env');
const PACKAGES = ['postgresql-17', 'postgresql-client-17', 'libpq5', 'libxslt1.1', 'libgcrypt20', 'libgpg-error0', 'valkey-server', 'valkey-tools', 'liblzf1'];
const BOOTSTRAP = fileURLToPath(new URL('../../apps/api/prisma/bootstrap.sql', import.meta.url));
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));

const privateDir = (path) => mkdirSync(path, { recursive: true, mode: 0o700 });
const say = (text) => process.stderr.write(`${text}\n`);

function tools() {
  for (const base of ['', ROOT]) {
    const postgres = join(base || '/', 'usr/lib/postgresql/17/bin');
    const valkey = join(base || '/', 'usr/bin');
    if (existsSync(join(postgres, 'postgres')) && existsSync(join(valkey, 'valkey-server'))) return { postgres, valkey };
  }
  return null;
}
// The libraries of the private folder are only used by the programs of that folder.
const env = () => ({ ...process.env, LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, join(ROOT, 'usr/lib/x86_64-linux-gnu')].filter(Boolean).join(':') });

export function install() {
  if (tools()) return;
  privateDir(DEBS);
  privateDir(ROOT);
  say('Téléchargement de PostgreSQL 17 et de Valkey 8.1 (paquets Debian, sans installation système)…');
  execFileSync('apt-get', ['download', ...PACKAGES], { cwd: DEBS, stdio: ['ignore', 'ignore', 'inherit'] });
  for (const file of readdirSync(DEBS).filter((name) => name.endsWith('.deb'))) execFileSync('dpkg-deb', ['-x', join(DEBS, file), ROOT]);
  if (!tools()) throw new Error('Paquets extraits, mais PostgreSQL 17 ou Valkey introuvable.');
}

const KEY_NAMES = ['VAULT_MASTER_KEY', 'SESSION_SIGNING_KEY'];
/** Random values of this machine, for development only. Never printed, never committed. */
export function values() {
  if (existsSync(VALUES))
    return Object.fromEntries(
      readFileSync(VALUES, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
  privateDir(HOME);
  const secret = () => randomBytes(24).toString('base64url');
  const [admin, owner, app, jobs, valkey] = [secret(), secret(), secret(), secret(), secret()];
  const url = (user, password, database) => `postgresql://${user}:${password}@${HOST}:${POSTGRES_PORT}/${database}`;
  const result = {
    TEST_ADMIN_DATABASE_URL: url('legarec_admin', admin, 'postgres'),
    MIGRATION_DATABASE_URL: url('legarec_owner', owner, 'legarec_dev'),
    DATABASE_URL: url('legarec_app', app, 'legarec_dev'),
    JOBS_DATABASE_URL: url('legarec_jobs', jobs, 'legarec_dev'),
    VALKEY_URL: `redis://:${valkey}@${HOST}:${VALKEY_PORT}/0`,
    ...Object.fromEntries(KEY_NAMES.map((name) => [name, randomBytes(32).toString('base64')])),
  };
  writeFileSync(
    VALUES,
    `${Object.entries(result)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n')}\n`,
    { mode: 0o600 },
  );
  return result;
}

const listening = (port) =>
  new Promise((resolve) => {
    const socket = connect({ host: HOST, port, timeout: 1000 });
    const end = (answer) => (socket.destroy(), resolve(answer));
    socket
      .once('connect', () => end(true))
      .once('error', () => end(false))
      .once('timeout', () => end(false));
  });
async function waitFor(port, name) {
  for (let i = 0; i < 100; i += 1) {
    if (await listening(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} ne répond pas sur ${HOST}:${port}. Voir ${HOME}.`);
}

/** Passwords only go to our own servers, never to another program that would hold the port. */
const postgresRuns = (bin) => spawnSync(join(bin, 'pg_ctl'), ['-D', DATA, 'status'], { env: env(), stdio: 'ignore' }).status === 0;
function valkeyPid() {
  try {
    const pid = Number(readFileSync(join(HOME, 'valkey.pid'), 'utf8'));
    // Its name and its port: another Valkey of this machine may have been given the same number.
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(`valkey-server ${HOST}:${VALKEY_PORT}`) ? pid : null;
  } catch {
    return null;
  }
}
async function refuseTaken(port) {
  if (await listening(port)) throw new Error(`Le port ${port} est pris par un autre programme. Rien n’a été démarré.`);
}

function initCluster(bin) {
  if (existsSync(join(DATA, 'PG_VERSION'))) return;
  privateDir(DATA);
  const passwordFile = join(HOME, 'initdb-password');
  writeFileSync(passwordFile, new URL(values().TEST_ADMIN_DATABASE_URL).password, { mode: 0o600 });
  try {
    execFileSync(
      join(bin, 'initdb'),
      [
        '-D',
        DATA,
        '-U',
        'legarec_admin',
        '--auth=scram-sha-256',
        `--pwfile=${passwordFile}`,
        '--encoding=UTF8',
        '--locale=C.UTF-8',
        '--locale-provider=icu',
        '--icu-locale=fr-FR',
      ],
      { env: env(), stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } finally {
    unlinkSync(passwordFile);
  }
  // Development data only: durability is traded for speed.
  writeFileSync(
    join(DATA, 'postgresql.auto.conf'),
    [
      `listen_addresses = '${HOST}'`,
      `port = ${POSTGRES_PORT}`,
      "unix_socket_directories = ''",
      "timezone = 'UTC'",
      'fsync = off',
      'synchronous_commit = off',
      'full_page_writes = off',
      'max_connections = 200',
      "log_statement = 'none'",
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

async function startPostgres(bin) {
  initCluster(bin);
  if (!postgresRuns(bin)) {
    await refuseTaken(POSTGRES_PORT);
    const log = openSync(join(HOME, 'postgres.log'), 'a', 0o600);
    const started = spawnSync(join(bin, 'pg_ctl'), ['-D', DATA, '-w', 'start'], { env: env(), stdio: ['ignore', log, log] });
    closeSync(log);
    if (started.status !== 0) throw new Error(`PostgreSQL ne démarre pas. Voir ${join(HOME, 'postgres.log')}.`);
  }
  await waitFor(POSTGRES_PORT, 'PostgreSQL');
}

async function startValkey(bin) {
  if (!valkeyPid()) {
    await refuseTaken(VALKEY_PORT);
    privateDir(CACHE);
    const config = join(HOME, 'valkey.conf');
    const password = new URL(values().VALKEY_URL).password;
    writeFileSync(
      config,
      [
        `bind ${HOST}`,
        `port ${VALKEY_PORT}`,
        `dir ${CACHE}`,
        `requirepass ${password}`,
        'appendonly yes',
        'maxmemory 256mb',
        'maxmemory-policy noeviction',
        'databases 64',
        'daemonize yes',
        `pidfile ${join(HOME, 'valkey.pid')}`,
        `logfile ${join(HOME, 'valkey.log')}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    execFileSync(join(bin, 'valkey-server'), [config], { env: env(), stdio: 'ignore' });
  }
  await waitFor(VALKEY_PORT, 'Valkey');
}

/** Creates the roles and the development database; safe to run again. */
export async function bootstrap() {
  const { Client } = apiRequire('pg');
  const all = values();
  const admin = new Client({ connectionString: all.TEST_ADMIN_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(readFileSync(BOOTSTRAP, 'utf8'));
    for (const name of ['MIGRATION_DATABASE_URL', 'DATABASE_URL', 'JOBS_DATABASE_URL']) {
      const { username, password } = new URL(all[name]);
      await admin.query(`ALTER ROLE ${admin.escapeIdentifier(username)} PASSWORD ${admin.escapeLiteral(password)}`);
    }
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'legarec_dev'");
    if (!rowCount) await admin.query('CREATE DATABASE legarec_dev OWNER legarec_owner');
    await admin.query('REVOKE ALL ON DATABASE legarec_dev FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE legarec_dev TO legarec_app, legarec_jobs');
  } finally {
    await admin.end();
  }
}

export async function start() {
  install();
  values();
  const bin = tools();
  await startPostgres(bin.postgres);
  await startValkey(bin.valkey);
  await bootstrap();
}

export async function stop() {
  const bin = tools();
  if (!bin) return;
  if (postgresRuns(bin.postgres)) spawnSync(join(bin.postgres, 'pg_ctl'), ['-D', DATA, '-m', 'fast', '-w', 'stop'], { env: env(), stdio: 'ignore' });
  const pid = valkeyPid();
  if (pid) process.kill(pid, 'SIGTERM');
}

const command = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] ? (process.argv[2] ?? 'status') : null;
if (command === 'install') install();
else if (command === 'start') {
  await start();
  say(`PostgreSQL (${POSTGRES_PORT}) et Valkey (${VALKEY_PORT}) prêts sur ${HOST}. Valeurs de développement : ${VALUES}`);
} else if (command === 'stop') await stop();
else if (command === 'status') {
  const bin = tools();
  for (const [name, port, runs] of [
    ['PostgreSQL', POSTGRES_PORT, bin && postgresRuns(bin.postgres)],
    ['Valkey', VALKEY_PORT, valkeyPid() !== null],
  ])
    say(`${name} ${HOST}:${port} : ${runs ? 'démarré' : (await listening(port)) ? 'port pris par un autre programme' : 'arrêté'}`);
} else if (command) {
  say('Usage : node infra/dev/services.mjs install | start | stop | status');
  process.exitCode = 1;
}
