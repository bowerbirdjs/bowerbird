import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Tests run against package sources, so no build is needed first.
    alias: [
      {
        find: /^@bowerbirdjs\/(core|css|html|blocks|agent|mcp|import|layout|export|sync|editor|react|vue)$/,
        replacement: pkg('$1'),
      },
    ],
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'bench/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
    ],
  },
});
