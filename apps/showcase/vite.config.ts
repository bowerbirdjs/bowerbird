import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { type Connect, defineConfig, type Logger, type Plugin, type ProxyOptions } from 'vite';
import { findApiKey, type KeyLookup, maskKey } from './server/api-key.js';

// The Claude API key stays on the dev server: the browser calls /api/anthropic and the proxy adds
// the key. It comes from a .env file in apps/showcase or the repository root, or from the
// ANTHROPIC_API_KEY environment variable (see server/api-key.ts), and is read on every request.
// Without a key, the showcase still works with the demo agent.
//
// The proxy spends your key, so it only forwards what the showcase needs (POST /v1/messages) and
// only for requests from this machine, even if the server is started with --host. Set
// SHOWCASE_ALLOW_REMOTE=1 to let other machines on your network use it.

const SHOWCASE_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));

/** Header the proxy adds to responses, so the page can say which key the API saw. */
const KEY_HEADER = 'x-showcase-api-key';
/** Headers a browser adds that a server-side call shouldn't pass on. */
const BROWSER_HEADERS = [
  'origin',
  'referer',
  'cookie',
  'anthropic-dangerous-direct-browser-access',
];

/** Header values must be plain ASCII (a non-ASCII folder name becomes ?). */
const ascii = (text: string) => text.replace(/…/g, '...').replace(/[^\x20-\x7e]/g, '?');

function describe(lookup: KeyLookup): string {
  if (lookup.key) return `${lookup.source} (${maskKey(lookup.key)})`;
  return [
    'No ANTHROPIC_API_KEY found. Put the line ANTHROPIC_API_KEY=sk-ant-… in a file named .env in',
    `${REPO_DIR} or ${SHOWCASE_DIR}, or set the environment variable.`,
    ...lookup.notes,
  ].join(' ');
}

const anthropic = (lookup: () => KeyLookup): ProxyOptions => ({
  target: 'https://api.anthropic.com',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      // Replaces the placeholder the page sends. The guard answers when there is no key.
      const { key } = lookup();
      if (key) req.setHeader('x-api-key', key);
      else req.removeHeader('x-api-key');
      for (const name of BROWSER_HEADERS) req.removeHeader(name);
    });
    proxy.on('proxyRes', (res) => {
      res.headers[KEY_HEADER] = ascii(describe(lookup()));
    });
  },
});

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

type Refusal = [status: number, type: string, message: string];

function refusal(req: IncomingMessage, lookup: () => KeyLookup): Refusal | undefined {
  const path = (req.url ?? '').split('?')[0];
  const local = LOOPBACK.has(req.socket.remoteAddress ?? '');
  if (req.method !== 'POST' || path !== '/v1/messages')
    return [403, 'permission_error', 'Only POST /v1/messages is forwarded.'];
  if (!local && process.env.SHOWCASE_ALLOW_REMOTE !== '1')
    return [
      403,
      'permission_error',
      'The API proxy only serves requests from this machine (set SHOWCASE_ALLOW_REMOTE=1 to change that).',
    ];
  const found = lookup();
  // No key: say so here instead of letting the API answer "x-api-key header is required".
  return found.key ? undefined : [401, 'authentication_error', describe(found)];
}

const guard =
  (lookup: () => KeyLookup) =>
  (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction): void => {
    const refused = refusal(req, lookup);
    if (!refused) {
      next();
      return;
    }
    const [status, type, message] = refused;
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ type: 'error', error: { type, message } }));
  };

/** Says in the terminal where the key comes from, or why there is none. */
function report(logger: Logger, lookup: KeyLookup): void {
  if (lookup.key) logger.info(`  Claude: using the API key from ${describe(lookup)}`);
  else logger.warn(`  Claude: ${describe(lookup)} The demo agent works without a key.`);
  if (lookup.key) for (const note of lookup.notes) logger.warn(`  Claude: ${note}`);
}

/** Runs before Vite's own middlewares (including the proxy) on the dev and preview servers. */
const proxyGuard = (lookup: () => KeyLookup): Plugin => ({
  name: 'showcase-api-guard',
  configureServer(server) {
    server.middlewares.use('/api/anthropic', guard(lookup));
    server.httpServer?.once('listening', () => report(server.config.logger, lookup()));
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/anthropic', guard(lookup));
    server.httpServer.once('listening', () => report(server.config.logger, lookup()));
  },
});

export default defineConfig(({ mode }) => {
  const lookup = () => findApiKey([REPO_DIR, SHOWCASE_DIR], mode);
  const proxy = { '/api/anthropic': anthropic(lookup) };
  return {
    base: './',
    plugins: [proxyGuard(lookup)],
    oxc: { jsx: { runtime: 'automatic' } },
    server: { proxy },
    preview: { proxy },
    build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  };
});
