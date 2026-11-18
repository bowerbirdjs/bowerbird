import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Base URLs of the built apps, or null when Playwright isn't installed (tests skip). */
    apps: {
      vanilla: string;
      vue: string;
      showcase: string;
      hostile: string;
      collab: string;
    } | null;
  }
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APPS = {
  vanilla: 'examples/vanilla',
  vue: 'examples/vue',
  showcase: 'apps/showcase',
  hostile: 'examples/hostile-css',
  collab: 'examples/collab',
  mcpEditor: 'examples/mcp-editor',
} as const;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function hasPlaywright(): boolean {
  try {
    createRequire(import.meta.url).resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

function serve(dir: string): Promise<Server> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    let file = join(dir, path);
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

export default async function setup(project: TestProject) {
  if (!hasPlaywright()) {
    console.warn('[e2e] Playwright is not installed; browser tests are skipped.');
    project.provide('apps', null);
    return;
  }
  const servers: Server[] = [];
  const urls = {} as Record<keyof typeof APPS, string>;
  // Vitest sets NODE_ENV=test, which would make Vite build development bundles (Lit dev mode and
  // its warnings); test what people ship.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  for (const [name, dir] of Object.entries(APPS) as [keyof typeof APPS, string][]) {
    const root = resolve(ROOT, dir);
    await build({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
    const server = await serve(join(root, 'dist'));
    servers.push(server);
    urls[name] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  }
  process.env.NODE_ENV = env;
  project.provide('apps', urls);
  return async () => {
    await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  };
}
