import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { FEATURES, unknownFeatures } from './src/app/features.ts';

export default defineConfig({
  plugins: [
    react(),
    {
      // A part of the portal named wrongly in `VITE_FEATURES` would stay hidden without a word: the build stops instead.
      name: 'legarec-features',
      configResolved({ env }) {
        const unknown = unknownFeatures(env.VITE_FEATURES as string | undefined);
        if (unknown.length > 0) throw new Error(`VITE_FEATURES: unknown ${unknown.join(', ')} (known: ${FEATURES.join(', ')})`);
      },
    },
  ],
  // public/ only holds the simulated API worker: it never ships.
  build: { copyPublicDir: false },
  // Development: what the simulations let through (`VITE_API`) goes to the API of this machine, under the same origin.
  server: { proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? 3000}`, rewrite: (path) => path.replace(/^\/api(?=\/)/u, '/staff') } } },
});
