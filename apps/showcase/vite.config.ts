import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { type Connect, defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';

// The Claude API key stays on the dev server: the browser calls /api/anthropic and the proxy adds
// the key from ANTHROPIC_API_KEY. Without a key, the showcase still works with the demo agent.
//
// The key comes from the environment or from a .env file in the repository root or in
// apps/showcase (that one wins; a variable set in the shell wins over both). Only the server
// reads it: Vite gives the browser VITE_-prefixed variables only.
//
// The proxy spends your key, so it only forwards what the showcase needs (POST /v1/messages) and
// only for requests from this machine, even if the server is started with --host. Set
// SHOWCASE_ALLOW_REMOTE=1 to let other machines on your network use it.
type Env = Record<string, string | undefined>;
/** Reads the environment and the .env files again, so editing .env needs no restart. */
type ReadEnv = () => Env;

const SHOWCASE_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));

const anthropic = (readEnv: ReadEnv): ProxyOptions => ({
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      const key = readEnv().ANTHROPIC_API_KEY?.trim();
      if (key) req.setHeader('x-api-key', key);
      else req.removeHeader('x-api-key');
    });
  },
});

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const guard =
  (readEnv: ReadEnv) =>
  (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction): void => {
    const path = (req.url ?? '').split('?')[0];
    const local = LOOPBACK.has(req.socket.remoteAddress ?? '');
    const reason =
      req.method !== 'POST' || path !== '/v1/messages'
        ? 'Only POST /v1/messages is forwarded.'
        : !local && readEnv().SHOWCASE_ALLOW_REMOTE !== '1'
          ? 'The API proxy only serves requests from this machine (set SHOWCASE_ALLOW_REMOTE=1 to change that).'
          : undefined;
    if (!reason) {
      next();
      return;
    }
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({ type: 'error', error: { type: 'permission_error', message: reason } }),
    );
  };

/** Runs before Vite's own middlewares (including the proxy) on the dev and preview servers. */
const proxyGuard = (readEnv: ReadEnv): Plugin => ({
  name: 'showcase-api-guard',
  configureServer(server) {
    server.middlewares.use('/api/anthropic', guard(readEnv));
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/anthropic', guard(readEnv));
  },
});

export default defineConfig(({ mode }) => {
  // loadEnv with an empty prefix reads every variable, for this config only (nothing reaches the
  // browser); variables already in the environment win over the files.
  const readEnv: ReadEnv = () => ({
    ...loadEnv(mode, REPO_DIR, ''),
    ...loadEnv(mode, SHOWCASE_DIR, ''),
  });
  const proxy = { '/api/anthropic': anthropic(readEnv) };
  return {
    base: './',
    plugins: [proxyGuard(readEnv)],
    oxc: { jsx: { runtime: 'automatic' } },
    server: { proxy },
    preview: { proxy },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  };
});
