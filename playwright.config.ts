import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 4,
  reporter: 'line',
  use: { baseURL: 'http://localhost:5173', locale: 'fr-FR', timezoneId: 'Europe/Paris' },
  webServer: [{ command: 'pnpm --filter @legarec/espace dev', url: 'http://localhost:5173', reuseExistingServer: true }],
});
