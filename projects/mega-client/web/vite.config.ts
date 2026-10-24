import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve workspace libs to their TypeScript source (see customConditions in tsconfig.base.json).
    conditions: ['@universe/source'],
  },
  build: {
    outDir: join(import.meta.dirname, '../../../dist/projects/mega-client/web'),
    emptyOutDir: true,
    // One small page served on the LAN: react-dom and zod make up most of it, and splitting
    // wouldn't save a first load anything.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 4211,
    // mega-client-service; also carries the /api/stream SSE connection.
    proxy: { '/api': 'http://localhost:3010' },
  },
});
