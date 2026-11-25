import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  name: string;
  /** Superuser: builds the fixtures, outside row-level security. */
  admin: pg.Client;
  adminUrl: string;
  url(role: 'owner' | 'app' | 'jobs'): string;
  drop(): Promise<void>;
}

/** A private copy of the migrated database, dropped at the end of the test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('adminUrl');
  const name = `legarec_test_${randomBytes(6).toString('hex')}`;
  const server = new pg.Client({ connectionString: adminUrl });
  await server.connect();
  await server.query(`CREATE DATABASE ${name} OWNER legarec_owner TEMPLATE ${inject('template')}`);
  await server.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
  await server.query(`GRANT CONNECT ON DATABASE ${name} TO legarec_app, legarec_jobs`);
  const own = new URL(adminUrl);
  own.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: own.href });
  await admin.connect();
  return {
    name,
    admin,
    adminUrl: own.href,
    url: (role) => {
      const url = new URL(adminUrl);
      url.username = `legarec_${role}`;
      url.password = inject('passwords')[role];
      url.pathname = `/${name}`;
      return url.href;
    },
    drop: async () => {
      await admin.end();
      await server.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await server.end();
    },
  };
}

/** Two creditors, two officers, two debtors: every isolation test rests on this set. */
export async function seed(admin: pg.Client) {
  const one = async <T = string>(sql: string, values: unknown[] = []) => (await admin.query<{ id: T }>(sql, values)).rows[0]!.id;
  const creditor = (name: string, siren: string) => one('INSERT INTO creditors (name, siren) VALUES ($1, $2) RETURNING id', [name, siren]);
  const creditorA = await creditor('Créancier ALPHA-MARK', '900000001');
  const creditorB = await creditor('Créancier BETA-MARK', '900000002');
  const user = (role: string, first: string, creditorId: string | null = null, status = 'ACTIVE') =>
    one('INSERT INTO users (role, status, first_name, last_name, email, creditor_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [
      role,
      status,
      first,
      'Test',
      `${first.toLowerCase()}@exemple.test`,
      creditorId,
    ]);
  const director = await user('DIRECTOR', 'Dora');
  const manager = await user('COLLECTION_MANAGER', 'Remi');
  const developer = await user('DEVELOPER', 'Devon');
  const officerA = await user('CLAIMS_OFFICER', 'Alba');
  const officerB = await user('CLAIMS_OFFICER', 'Beno');
  const partnerA = await user('CREDITOR', 'Paula', creditorA);
  const partnerB = await user('CREDITOR', 'Quentin', creditorB);
  for (const kind of ['TECHNICAL', 'ADMINISTRATIVE']) await admin.query('INSERT INTO delegations (kind, granted_by) VALUES ($1, $2)', [kind, director]);
  const debtor = (kind: string, name: string, siren: string | null) =>
    one('INSERT INTO debtors (kind, name, siren) VALUES ($1, $2, $3) RETURNING id', [kind, name, siren]);
  const debtorA = await debtor('COMPANY', 'Débiteur UN', '800000001');
  const debtorB = await debtor('INDIVIDUAL', 'Débiteur DEUX', null);
  let number = 0;
  const makeCase = (creditorId: string, debtorId: string, officerId: string | null, announced = true) => {
    number += 1;
    return one(
      'INSERT INTO cases (reference, creditor_id, debtor_id, officer_id, first_letter_reference, first_letter_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [
        `LGR-2026-${String(number).padStart(5, '0')}`,
        creditorId,
        debtorId,
        officerId,
        // The last case has not been announced to its debtor yet.
        ...(announced ? [`LR-2026-${String(number).padStart(4, '0')}`, '2026-11-20'] : [null, null]),
      ],
    );
  };
  const cases = {
    ofA: await makeCase(creditorA, debtorA, officerA),
    ofB: await makeCase(creditorB, debtorA, officerB),
    unassigned: await makeCase(creditorA, debtorB, null),
    ofDirector: await makeCase(creditorB, debtorB, director, false),
  };
  return { creditorA, creditorB, director, manager, developer, officerA, officerB, partnerA, partnerB, debtorA, debtorB, cases };
}
export type Seed = Awaited<ReturnType<typeof seed>>;
