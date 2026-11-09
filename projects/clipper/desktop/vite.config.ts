import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Tauri loads this from devUrl in dev and from frontendDist in builds (src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve workspace libs to their TypeScript source (see customConditions in tsconfig.base.json).
    conditions: ['@universe/source'],
  },
  // Rust errors would otherwise be cleared off the terminal by Vite.
  clearScreen: false,
  build: {
    outDir: join(import.meta.dirname, '../../../dist/projects/clipper/desktop'),
    emptyOutDir: true,
    // WebView2 is Chromium, kept current by Windows.
    target: 'chrome120',
  },
  server: {
    port: 4212,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**', '**/crates/**', '**/target/**'] },
  },
});
