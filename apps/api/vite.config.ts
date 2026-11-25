import { defineConfig } from 'vite';

/** Four programs from the same code: the HTTP API, the worker, the migrations and the command of the accounts. The dependencies stay outside, installed beside. */
export default defineConfig({
  // No `.env` is ever read here: the values reach the process when it starts.
  envDir: false,
  build: {
    ssr: true,
    target: 'node26',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: { main: 'src/main.ts', worker: 'src/worker.ts', migrate: 'src/migrate.ts', account: 'src/account.ts' } },
  },
  ssr: { noExternal: [/^@legarec\//u] },
});
