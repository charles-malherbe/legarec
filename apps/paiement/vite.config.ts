import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// public/ only holds the simulated API worker: it never ships.
// In development, /api goes to the API of this machine: this portal names /debtor in its own paths.
export default defineConfig({
  plugins: [react()],
  build: { copyPublicDir: false },
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3000}`, rewrite: (path) => path.replace(/^\/api(?=\/)/u, '') } } },
});
