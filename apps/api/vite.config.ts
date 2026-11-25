import { defineConfig } from 'vite';

/** Two programs from the same code: the HTTP API and the worker. The dependencies stay outside, installed beside. */
export default defineConfig({
  // No `.env` is ever read here: the values reach the process when it starts.
  envDir: false,
  build: {
    ssr: true,
    target: 'node26',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: { input: { main: 'src/main.ts', worker: 'src/worker.ts' } },
  },
  ssr: { noExternal: [/^@legarec\//u] },
});
