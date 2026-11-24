import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// public/ only holds the simulated API worker: it never ships.
export default defineConfig({ plugins: [react()], build: { copyPublicDir: false } });
