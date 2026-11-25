import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Applies the SQL migrations in order, each in its own transaction, once. Same files and same table as Prisma Migrate,
 * without its native engine, which is downloaded when it first runs and escapes the lockfile.
 */
export async function migrate(url: string, directory: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url, application_name: 'legarec-migrate' });
  await client.connect();
  const applied: string[] = [];
  try {
    // Two deployments at the same time: the second waits, then finds nothing left to do.
    await client.query('SELECT pg_advisory_lock(714002)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS _prisma_migrations (
        id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL,
        logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
    const { rows } = await client.query<{ migration_name: string; checksum: string }>(
      'SELECT migration_name, checksum FROM _prisma_migrations WHERE rolled_back_at IS NULL',
    );
    const known = new Map(rows.map((row) => [row.migration_name, row.checksum]));
    const names = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const missing = [...known.keys()].filter((name) => !names.includes(name));
    if (missing.length) throw new Error(`Migrations applied but absent from the code: ${missing.join(', ')}`);
    for (const name of names) {
      const sql = readFileSync(join(directory, name, 'migration.sql'), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const before = known.get(name);
      if (before === checksum) continue;
      if (before !== undefined) throw new Error(`Migration changed after it was applied: ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, $3, clock_timestamp(), 1)',
          [randomUUID(), checksum, name],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(name);
    }
  } finally {
    await client.end();
  }
  return applied;
}
