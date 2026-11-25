import { defineConfig } from 'prisma/config';

/** The URL is only needed by the migrations, run as `legarec_owner`; generating the client needs no database. */
export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://unset:unset@127.0.0.1:1/unset' },
});
