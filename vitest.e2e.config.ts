import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

// Browser tests: the global setup builds the examples and the showcase with Vite, serves them and
// drives them with Playwright. Run with `pnpm test:e2e`; skipped when Playwright isn't installed.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@bowerbirdjs\/(core|css|html|blocks)$/, replacement: pkg('$1') }],
  },
  test: {
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
