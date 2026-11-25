import { defineConfig } from 'prisma/config';

/** Only used to generate the client, which needs no database: the migrations have their own program (src/migrate.ts). */
export default defineConfig({ schema: 'prisma/schema' });
