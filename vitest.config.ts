import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'front',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'],
          exclude: ['apps/api/src/{platform,modules,health}/**', '**/node_modules/**'],
          css: { modules: { classNameStrategy: 'non-scoped' } },
          testTimeout: 20_000,
        },
      },
      {
        // Real PostgreSQL and Valkey: started by the global setup, or provided by GitHub Actions.
        test: {
          name: 'api',
          environment: 'node',
          root: 'apps/api',
          globalSetup: ['./test/globalSetup.ts'],
          setupFiles: ['./test/setup.ts'],
          include: ['src/{platform,modules,health}/**/*.test.ts', 'test/**/*.test.ts'],
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
