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

const rightsOf = async (role: string) =>
  (
    await rows<{ entry: string }>(
      `SELECT c.relname || ' ' || a.privilege_type || ' (*)' AS entry
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1
       UNION ALL
       SELECT c.relname || ' ' || a.privilege_type || ' (' || string_agg(t.attname, ', ' ORDER BY t.attname) || ')'
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid CROSS JOIN LATERAL aclexplode(t.attacl) a JOIN pg_roles r ON r.oid = a.grantee
       WHERE n.nspname = 'public' AND r.rolname = $1 GROUP BY c.relname, a.privilege_type
       ORDER BY 1`,
      [role],
    )
  ).map((row) => row.entry);

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
    expect(await rightsOf(role)).toEqual(rights);
  });

  it('never let the team read a password, a token or an encrypted value', async () => {
    const readable = await rows(`
      SELECT c.relname, t.attname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute t ON t.attrelid = c.oid
      WHERE n.nspname = 'public' AND t.attnum > 0 AND t.attname ~ '(_hash|_cipher|_hmac)$' AND c.relkind = 'r'
        AND has_column_privilege('legarec_staff', c.oid, t.attname, 'SELECT') AND c.relname <> 'idempotency_keys'`);
    expect(readable).toEqual([]);
  });
});

describe('rights of the roles inside', () => {
  // Any addition shows here too: the team reads, and writes by the functions; only the purge erases.
  const expected: Record<string, string[]> = {
    legarec_staff: [
      'audit_log SELECT (*)',
      'case_events SELECT (*)',
      'cases SELECT (*)',
      'cases UPDATE (closed_on, external_reference, first_letter_on, first_letter_reference, status, version)',
      'creditors SELECT (*)',
      'debtors SELECT (*)',
      'delegations SELECT (*)',
      'idempotency_keys INSERT (*)',
      'idempotency_keys SELECT (*)',
      'idempotency_keys UPDATE (result, status)',
      'users SELECT (created_at, creditor_id, disabled_at, email, extension, first_name, id, last_name, last_seen_at, role, status)',
    ],
    legarec_worker: [
      'case_events SELECT (*)',
      'cases SELECT (*)',
      'cases UPDATE (closed_on, external_reference, first_letter_on, first_letter_reference, status, version)',
      'creditors SELECT (*)',
      'debtors SELECT (*)',
      'outbox SELECT (*)',
      'outbox UPDATE (published_at)',
      'users SELECT (creditor_id, email, first_name, id, last_name, role, status)',
      'webhook_events SELECT (*)',
      'webhook_events UPDATE (processed_at, status)',
    ],
    legarec_retention: [
      'idempotency_keys DELETE (*)',
      'idempotency_keys SELECT (created_at)',
      'outbox DELETE (*)',
      'outbox SELECT (id, published_at)',
      'webhook_events DELETE (*)',
      'webhook_events SELECT (id, received_at, status)',
    ],
    legarec_definer: [
      'audit_log DELETE (*)',
      'audit_log INSERT (*)',
      'audit_log SELECT (id, occurred_at)',
      'case_events INSERT (*)',
      'cases SELECT (creditor_id, debtor_id, first_letter_on, id, officer_id, version)',
      'cases UPDATE (officer_id, version)',
      'creditors SELECT (id, name)',
      'delegations SELECT (*)',
      'number_sequences INSERT (*)',
      'number_sequences SELECT (*)',
      'number_sequences UPDATE (*)',
      'outbox INSERT (*)',
      'outbox SELECT (dedupe_key)',
      'users SELECT (creditor_id, first_name, id, last_name, role, status)',
    ],
  };
  it.each(Object.entries(expected))('%s', async (role, rights) => {
    expect(await rightsOf(role)).toEqual(rights);
  });

  it('let nobody create anything, not even for the time of a session', async () => {
    const creators = await rows(`
      SELECT r.rolname FROM pg_roles r
      WHERE r.rolname LIKE 'legarec\\_%' AND r.rolname NOT IN ('legarec_admin', 'legarec_owner')
        AND (has_database_privilege(r.oid, current_database(), 'TEMP') OR has_database_privilege(r.oid, current_database(), 'CREATE')
          OR has_schema_privilege(r.oid, 'public', 'CREATE') OR has_schema_privilege(r.oid, 'app', 'CREATE'))`);
    expect(creators).toEqual([]);
  });

  it('can be taken by one connection each, without inheriting anything', async () => {
    const members = await rows<{ entry: string }>(`
      SELECT m.rolname || ' > ' || r.rolname || CASE WHEN am.inherit_option OR am.admin_option OR NOT am.set_option THEN ' !' ELSE '' END AS entry
      FROM pg_auth_members am JOIN pg_roles r ON r.oid = am.roleid JOIN pg_roles m ON m.oid = am.member WHERE m.rolname LIKE 'legarec\\_%' ORDER BY 1`);
    expect(members.map((row) => row.entry)).toEqual([
      'legarec_app > legarec_auth',
      'legarec_app > legarec_debtor',
      'legarec_app > legarec_hook',
      'legarec_app > legarec_partner',
      'legarec_app > legarec_public',
      'legarec_app > legarec_service',
      'legarec_app > legarec_staff',
      'legarec_jobs > legarec_retention',
      'legarec_jobs > legarec_staff',
      'legarec_jobs > legarec_worker',
      'legarec_owner > legarec_definer',
    ]);
  });
});

describe('rights on the functions', () => {
  const callers = async (name: string) =>
    (
      await rows<{ role: string }>(
        `SELECT replace(r.rolname, 'legarec_', '') AS role FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid = a.grantee
         WHERE n.nspname = 'app' AND p.proname = $1 AND a.privilege_type = 'EXECUTE' AND r.rolname NOT IN ('legarec_owner', 'legarec_definer') ORDER BY 1`,
        [name],
      )
    ).map((row) => row.role);
  // Those that act, or that tell something about someone else.
  it.each([
    ['add_case_event', ['debtor', 'partner', 'staff', 'worker']],
    ['note_consultation', ['staff']],
    ['assign_cases', ['staff']],
    ['next_number', ['staff', 'worker']],
    ['purge_audit', ['retention']],
    ['can_read_case', ['staff']],
    ['can_act_on_case', ['staff']],
    ['is_claims_officer', ['staff']],
    ['director_id', ['staff']],
    // Tools of the migrations.
    ['secure', []],
    ['secure_case_table', []],
    ['append_only', []],
    ['refuse_change', []],
    // Everyone but the pages without any account.
    ...['log', 'enqueue', 'staff_role', 'has_delegation', 'partner_creditor', 'on_behalf_of', 'actor_kind', 'actor_label', 'actor_id', 'actor_key'].map(
      (name) => [name, ['auth', 'debtor', 'hook', 'partner', 'retention', 'service', 'staff', 'worker']] as [string, string[]],
    ),
  ] as [string, string[]][])('%s: %j', async (name, expected) => {
    expect(await callers(name)).toEqual(expected);
  });

  it('are all listed above, but those that read the context of the caller only', async () => {
    const listed = [
      'add_case_event note_consultation assign_cases next_number purge_audit can_read_case can_act_on_case is_claims_officer director_id secure secure_case_table append_only refuse_change',
      'log enqueue staff_role has_delegation partner_creditor on_behalf_of actor_kind actor_label actor_id actor_key',
      'uuid_v7 setting user_id creditor_id debtor_id only_identifiers',
    ].flatMap((names) => names.split(' '));
    const found = await rows<{ proname: string }>(
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY 1",
    );
    expect(found.map((row) => row.proname)).toEqual(listed.sort());
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
