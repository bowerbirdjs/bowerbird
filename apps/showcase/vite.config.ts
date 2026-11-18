import { defineConfig, type ProxyOptions } from 'vite';

// The Claude API key stays on the dev server: the browser calls /api/anthropic and the proxy adds
// the key from ANTHROPIC_API_KEY. Without a key, the showcase still works with the demo agent.
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

export default defineConfig({
  base: './',
  oxc: { jsx: { runtime: 'automatic' } },
  server: { proxy: { '/api/anthropic': anthropic } },
  preview: { proxy: { '/api/anthropic': anthropic } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
