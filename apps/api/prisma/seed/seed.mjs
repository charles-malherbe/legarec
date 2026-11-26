#!/usr/bin/env node
// Demonstration accounts and cases of the development database, the same people as in the simulations: never anywhere else.
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
/** Reference, debtor, SIRET (none for an individual), creditor, invoices, euros left, days late, status, officer. */
const CASES = [
  ['LGR-2026-00142', 'Bâtiplus SAS', '51233487100088', 'Matériaux Delta', 3, 48200, 64, 'OVERDUE', 'cl'],
  ['LGR-2026-00151', 'Groupe Hélio', '31993518500011', 'Médiatel', 2, 36750, 38, 'REMINDER', 'hb'],
  ['LGR-2026-00098', 'Garage Valmont', '19378657100094', 'TransAlp Leasing', 4, 23900, 97, 'FORMAL_NOTICE', 'cl'],
  ['LGR-2026-00163', 'Nordis Logistique', '85432319300045', 'Énergies Rhône', 1, 21400, 45, 'PROMISE', 'sm'],
  ['LGR-2026-00170', 'Atelier Mistral', '97574911000089', 'Matériaux Delta', 1, 18320, 52, 'DISPUTE', 'hb'],
  ['LGR-2026-00177', 'Cabinet Orsay', '72527601800084', 'Médiatel', 2, 14800, 12, 'PLAN', 'sm'],
  ['LGR-2026-00181', 'Fromagerie Durand', '65597971400012', 'Énergies Rhône', 2, 6240, 21, 'REMINDER', 'cl'],
  ['LGR-2026-00203', 'Paul Meunier', null, 'Crédit Horizon', 1, 2150, 18, 'REMINDER', null],
  ['LGR-2026-00087', 'Hôtel Lagarde', '40211855600027', 'Énergies Rhône', 2, 11900, 73, 'OVERDUE', 'mdu'],
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
  for (const [name] of CREDITORS)
    await client.query(
      `INSERT INTO mandates (creditor_id, starts_on, amicable_rate_bp, litigation_rate_bp, plan_months_without_consent, discount_max_bp, litigation_needs_consent, interest_mode, fixed_indemnity, reporting_day, scenario)
       SELECT k.id, '2024-03-12', 800, 1200, 6, 500, true, 'ECB_PLUS_TEN', true, 5, 'BUSINESS' FROM creditors k
       WHERE k.name = $1 AND NOT EXISTS (SELECT 1 FROM mandates m WHERE m.creditor_id = k.id)`,
      [name],
    );
  for (const [reference, name, siret, creditor, invoices, euros, days, status, officer] of CASES) {
    if ((await client.query('SELECT 1 FROM cases WHERE reference = $1', [reference])).rowCount) continue;
    const { rows: debtors } = await client.query('INSERT INTO debtors (kind, name, siren) VALUES ($1, $2, $3) RETURNING id', [
      siret ? 'COMPANY' : 'INDIVIDUAL',
      name,
      siret?.slice(0, 9) ?? null,
    ]);
    const { rows: made } = await client.query(
      `INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, status, mandate_id, debtor_siret, scenario, created_by, opened_on)
       SELECT $1, k.id, $2, (SELECT id FROM users WHERE email = $3), $4, m.id, $5, 'BUSINESS', u.id, '2026-09-15'
       FROM creditors k JOIN mandates m ON m.creditor_id = k.id, users u WHERE k.name = $6 AND u.email = 'cl@legarec.fr' RETURNING id, creditor_id`,
      [reference, debtors[0].id, officer ? `${officer}@legarec.fr` : null, status, siret, creditor],
    );
    for (let index = 0; index < invoices; index += 1) {
      const cents = Math.floor((euros * 100) / invoices) + (index === 0 ? (euros * 100) % invoices : 0);
      await client.query(
        `INSERT INTO case_invoices (case_id, creditor_id, number, issued_on, due_on, claimed_cents, principal_cents, created_by)
         SELECT $1, $2, $3, current_date - $4::int - 30, current_date - $4::int, $5, $5, u.id FROM users u WHERE u.email = 'cl@legarec.fr'`,
        [made[0].id, made[0].creditor_id, `F-${reference.slice(-5)}-${index + 1}`, days - index * 5, cents],
      );
    }
  }
  // Announced to their debtor (first letter of the demonstration): the space of payment opens for them, with the code a
  // colleague shows in the case.
  await client.query(
    `UPDATE cases SET first_letter_reference = 'LR-2026-' || lpad(right(reference, 4), 4, '0'), first_letter_on = '2026-10-01'
     WHERE status <> 'NEW' AND first_letter_on IS NULL AND reference LIKE 'LGR-2026-%'`,
  );
  // The next ones do not take the numbers above.
  await client.query(
    "INSERT INTO number_sequences (kind, year, last_value) VALUES ('CASE', 2026, 300) ON CONFLICT (kind, year) DO UPDATE SET last_value = greatest(number_sequences.last_value, 300)",
  );
  await client.query('COMMIT');
  process.stdout.write(`${PEOPLE.length + CONTACTS.length} comptes et ${CASES.length} dossiers de démonstration, mot de passe ${PASSWORD}.\n`);
} finally {
  await client.end();
}
