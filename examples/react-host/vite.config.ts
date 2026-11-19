import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  oxc: { jsx: { runtime: 'automatic' } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
