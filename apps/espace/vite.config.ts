import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // public/ only holds the simulated API worker: it never ships.
  build: { copyPublicDir: false },
  // Development: what the simulations let through (`VITE_API`) goes to the API of this machine, under the same origin.
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3000}`, rewrite: (path) => path.replace(/^\/api(?=\/)/u, '/staff') } } },
});
