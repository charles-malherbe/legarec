import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './database';

/** These rules hold for every table, those of the next lots included. */
let test: TestDatabase;
const rows = async <T extends object>(sql: string, values: unknown[] = []) => (await test.admin.query<T>(sql, values)).rows;
const TABLES = "c.relkind = 'r' AND n.nspname = 'public' AND c.relname <> '_prisma_migrations'";

beforeAll(async () => {
  test = await createTestDatabase();
});
afterAll(() => test.drop());

describe('row-level security', () => {
  it('is enabled and forced on every table, with at least one policy', async () => {
    const open = await rows(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${TABLES} AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))`);
    expect(open).toEqual([]);
  });

  it('gives nothing to everyone, nor to the login roles', async () => {
    const granted = await rows(`
      SELECT n.nspname, c.relname, coalesce(r.rolname, 'PUBLIC') AS grantee
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
      WHERE n.nspname IN ('public', 'app') AND (a.grantee = 0 OR r.rolname IN ('legarec_app', 'legarec_jobs'))`);
    expect(granted).toEqual([]);
    const functions = await rows(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.prokind = 'f' AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))`);
    // Trigger functions are never called directly.
    expect(functions.map((row) => (row as { proname: string }).proname).filter((name) => name !== 'refuse_change')).toEqual([]);
  });

  it.each(['app', 'jobs'] as const)('refuses everything to legarec_%s until it takes a role', async (role) => {
    const client = new pg.Client({ connectionString: test.url(role) });
    await client.connect();
    try {
      const tables = await rows<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE ${TABLES}`);
      expect(tables.length).toBeGreaterThan(10);
      for (const { relname } of tables) {
        for (const sql of [`SELECT * FROM public.${relname}`, `DELETE FROM public.${relname}`])
          await expect(client.query(sql)).rejects.toThrow(/permission denied/u);
      }
      await expect(client.query('SELECT app.log($1, NULL, NULL, $1)', ['X'])).rejects.toThrow(/permission denied/u);
      for (const forbidden of ['legarec_owner', 'legarec_definer', role === 'app' ? 'legarec_worker' : 'legarec_auth', 'legarec_admin']) {
        await expect(client.query(`SET ROLE ${forbidden}`)).rejects.toThrow(/permission denied|does not exist/u);
      }
    } finally {
      await client.end();
    }
  });

  it('cannot be bypassed by any role of the application', async () => {
    const roles = await rows(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'legarec\\_%' AND rolname <> 'legarec_admin' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit OR rolreplication)",
    );
    expect(roles).toEqual([]);
  });
});

describe('tables of a case', () => {
  it('carry the creditor of the case, checked by a composite key without cascade', async () => {
    const tables = await rows<{ table_name: string }>(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'case_id'",
    );
    expect(tables.length).toBeGreaterThan(0);
    for (const { table_name } of tables) {
      const keys = await rows<{ definition: string; confupdtype: string; confdeltype: string }>(
        "SELECT pg_get_constraintdef(oid) AS definition, confupdtype, confdeltype FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f' AND confrelid = 'cases'::regclass",
        [table_name],
      );
      expect(keys, table_name).toEqual([
        { definition: 'FOREIGN KEY (case_id, creditor_id) REFERENCES cases(id, creditor_id)', confupdtype: 'a', confdeltype: 'a' },
      ]);
      const optional = await rows("SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'case_id' AND is_nullable = 'YES'", [
        table_name,
      ]);
      if (optional.length) {
        const check = await rows(
          "SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%case_id IS NULL%creditor_id IS NOT NULL%'",
          [table_name],
        );
        expect(check, `${table_name}: a case without its creditor`).toHaveLength(1);
      }
    }
  });

  it('never cascade a change nor a deletion, whatever the table', async () => {
    const cascades = await rows(
      "SELECT conrelid::regclass::text AS source, conname FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND (confupdtype <> 'a' OR confdeltype NOT IN ('a', 'r'))",
    );
    expect(cascades).toEqual([]);
  });
});

describe('functions that see more than their caller', () => {
  it('belong to a role without login, with a fixed search path', async () => {
    const wrong = await rows(`
      SELECT p.proname, r.rolname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname IN ('app', 'public') AND p.prosecdef AND (r.rolname <> 'legarec_definer' OR r.rolcanlogin OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'])`);
    expect(wrong).toEqual([]);
  });
});

describe('rights of the roles that face the outside', () => {
  // Any addition shows here: it must be wanted.
  const expected: Record<string, string[]> = {
    legarec_auth: [],
    legarec_hook: ['webhook_events INSERT (id, provider, provider_event_id)', 'webhook_events SELECT (id, provider, provider_event_id)'],
    legarec_public: [],
    legarec_service: [],
    legarec_partner: [
      'case_events SELECT (actor_kind, actor_label, case_id, creditor_id, detail, id, kind, occurred_at, title, tone, visible_to_creditor)',
      'cases SELECT (closed_on, creditor_id, debtor_id, external_reference, id, opened_on, reference, status)',
      'creditors SELECT (id, name, siren, status)',
      'debtors SELECT (id, kind, name, siren)',
      'idempotency_keys INSERT (*)',
      'idempotency_keys SELECT (*)',
      'idempotency_keys UPDATE (result, status)',
      'users SELECT (creditor_id, email, first_name, id, last_name, role, status)',
    ],
    legarec_debtor: [
      'cases SELECT (closed_on, creditor_id, debtor_id, id, opened_on, reference, status)',
      'debtors SELECT (id, kind, name, siren)',
      'idempotency_keys INSERT (*)',
      'idempotency_keys SELECT (*)',
      'idempotency_keys UPDATE (result, status)',
    ],
  };
  it.each(Object.entries(expected))('%s', async (role, rights) => {
    const found = await rows<{ entry: string }>(
      `SELECT c.relname || ' ' || a.privilege_type || ' (*)' AS entry
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1
       UNION ALL
       SELECT c.relname || ' ' || a.privilege_type || ' (' || string_agg(t.attname, ', ' ORDER BY t.attname) || ')'
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid CROSS JOIN LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1 GROUP BY c.relname, a.privilege_type
       ORDER BY 1`,
      [role],
    );
    expect(found.map((row) => row.entry)).toEqual(rights);
  });

  it('never let the team read a password, a token or an encrypted value', async () => {
    const readable = await rows(`
      SELECT c.relname, t.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid
      WHERE n.nspname = 'public' AND t.attnum > 0 AND t.attname ~ '(_hash|_cipher|_hmac)$' AND c.relkind = 'r'
        AND has_column_privilege('legarec_staff', c.oid, t.attname, 'SELECT') AND c.relname <> 'idempotency_keys'`);
    expect(readable).toEqual([]);
  });
});

describe('schema', () => {
  it('is the same in Prisma and in the migrations', () => {
    const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema', '--exit-code'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, MIGRATION_DATABASE_URL: test.url('owner'), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});
