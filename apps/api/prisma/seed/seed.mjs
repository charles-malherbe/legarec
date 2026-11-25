#!/usr/bin/env node
// Demonstration accounts of the development database, the same people as in the simulations: never anywhere else.
// Run after a first `pnpm --filter @legarec/api dev`. Password of everyone: motdepasse12.
import argon2 from 'argon2';
import pg from 'pg';
import { start, values } from '../../../../infra/dev/services.mjs';

const PASSWORD = 'motdepasse12';
const CREDITORS = [
  ['Matériaux Delta', '401228975'],
  ['Énergies Rhône', '626018154'],
  ['Médiatel', '183016617'],
  ['TransAlp Leasing', '418609137'],
  ['Crédit Horizon', '199603085'],
];
const PEOPLE = [
  ['DIRECTOR', 'Marie', 'Dubreuil', 'mdu@legarec.fr', null],
  ['COLLECTION_MANAGER', 'Camille', 'Laurent', 'cl@legarec.fr', '101'],
  // Asked to set up its second factor at the first sign-in.
  ['DEVELOPER', 'Nora', 'Petit', 'support@legarec.fr', null],
  ['CLAIMS_OFFICER', 'Hugo', 'Benali', 'hb@legarec.fr', '102'],
  ['CLAIMS_OFFICER', 'Sarah', 'Morel', 'sm@legarec.fr', '103'],
  ['CLAIMS_OFFICER', 'Thomas', 'Giraud', 'tg@legarec.fr', null],
];
const CONTACTS = [
  ['Claire', 'Besson', 'c.besson@materiauxdelta.example', 'Matériaux Delta'],
  ['Paul', 'Roche', 'p.roche@energiesrhone.example', 'Énergies Rhône'],
];

await start();
// The superuser of the development services, on this machine only: the tables have no other door.
const url = new URL(values().TEST_ADMIN_DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55432') throw new Error('Base de développement seulement.');
url.pathname = '/legarec_dev';
const client = new pg.Client({ connectionString: url.href });
await client.connect();
try {
  await client.query('BEGIN');
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 });
  for (const [name, siren] of CREDITORS)
    await client.query('INSERT INTO creditors (name, siren) VALUES ($1, $2) ON CONFLICT (siren) DO NOTHING', [name, siren]);
  const add = (role, first, last, email, extension, creditor) =>
    client.query(
      `INSERT INTO users (role, status, first_name, last_name, email, extension, creditor_id, password_hash, password_changed_at)
       VALUES ($1, 'ACTIVE', $2, $3, $4, $5, (SELECT id FROM creditors WHERE name = $6), $7, now())
       ON CONFLICT (email) DO UPDATE SET password_hash = $7, status = 'ACTIVE', disabled_at = NULL, disabled_by = NULL, disabled_reason = NULL`,
      [role, first, last, email, extension, creditor, hash],
    );
  for (const [role, first, last, email, extension] of PEOPLE) await add(role, first, last, email, extension, null);
  for (const [first, last, email, creditor] of CONTACTS) await add('CREDITOR', first, last, email, null, creditor);
  await client.query('COMMIT');
  process.stdout.write(`${PEOPLE.length + CONTACTS.length} comptes de démonstration, mot de passe ${PASSWORD}.\n`);
} finally {
  await client.end();
}
