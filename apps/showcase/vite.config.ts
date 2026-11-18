import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Connect, defineConfig, type Plugin, type ProxyOptions } from 'vite';

// The Claude API key stays on the dev server: the browser calls /api/anthropic and the proxy adds
// the key from ANTHROPIC_API_KEY. Without a key, the showcase still works with the demo agent.
//
// The proxy spends your key, so it only forwards what the showcase needs (POST /v1/messages) and
// only for requests from this machine, even if the server is started with --host. Set
// SHOWCASE_ALLOW_REMOTE=1 to let other machines on your network use it.
const anthropic: ProxyOptions = {
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      const key = process.env.ANTHROPIC_API_KEY;
      if (key) req.setHeader('x-api-key', key);
      else req.removeHeader('x-api-key');
    });
  },
};

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function guard(req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction): void {
  const path = (req.url ?? '').split('?')[0];
  const local = LOOPBACK.has(req.socket.remoteAddress ?? '');
  const reason =
    req.method !== 'POST' || path !== '/v1/messages'
      ? 'Only POST /v1/messages is forwarded.'
      : !local && process.env.SHOWCASE_ALLOW_REMOTE !== '1'
        ? 'The API proxy only serves requests from this machine (set SHOWCASE_ALLOW_REMOTE=1 to change that).'
        : undefined;
  if (!reason) {
    next();
    return;
  }
  res.statusCode = 403;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ type: 'error', error: { type: 'permission_error', message: reason } }));
}

/** Runs before Vite's own middlewares (including the proxy) on the dev and preview servers. */
const proxyGuard: Plugin = {
  name: 'showcase-api-guard',
  configureServer(server) {
    server.middlewares.use('/api/anthropic', guard);
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/anthropic', guard);
  },
};

export default defineConfig({
  base: './',
  plugins: [proxyGuard],
  oxc: { jsx: { runtime: 'automatic' } },
  server: { proxy: { '/api/anthropic': anthropic } },
  preview: { proxy: { '/api/anthropic': anthropic } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
