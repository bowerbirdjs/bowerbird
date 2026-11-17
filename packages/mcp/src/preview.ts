import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Store } from '@bowerbirdjs/core';
import { escapeHtml, renderDocument } from '@bowerbirdjs/html';

export interface PreviewOptions {
  store: Store;
  port?: number;
  host?: string;
}

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

const EVENTS_PATH = '/__bowerbird/events';

function liveScript(label: string, showBadge: boolean): string {
  const badge = showBadge
    ? `<div style="position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:60ch;padding:6px 12px;border-radius:999px;background:#0f172ad9;color:#fff;font:12px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</div>`
    : '';
  return `${badge}<script>new EventSource(${JSON.stringify(EVENTS_PATH)}).onmessage = () => location.reload();</script>`;
}

/**
 * Serves every page of the store at its path and reloads open tabs whenever the document changes,
 * so you can watch an agent work. `?theme=dark` previews a theme; `?badge=0` hides the status badge.
 */
export async function startPreview(options: PreviewOptions): Promise<PreviewServer> {
  const { store } = options;
  const host = options.host ?? '127.0.0.1';
  const clients = new Set<ServerResponse>();
  let lastChange = 'No changes yet';

  const unsubscribe = store.subscribe(({ entry }) => {
    lastChange = `rev ${entry.revision} · ${entry.actor.name ?? entry.actor.id}: ${entry.label ?? `${entry.changes.length} changes`}`;
    for (const client of clients) client.write(`data: ${entry.revision}\n\n`);
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === EVENTS_PATH) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/__bowerbird/doc.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(store.doc, null, 2));
      return;
    }
    const doc = store.doc;
    const badge = url.searchParams.get('badge') !== '0';
    const page = Object.values(doc.pages).find((p) => p.path === url.pathname);
    if (!page) {
      const links = Object.values(doc.pages)
        .map(
          (p) =>
            `<li><a href="${escapeHtml(p.path)}">${escapeHtml(p.title)}</a> <code>${escapeHtml(p.path)}</code></li>`,
        )
        .join('');
      res.writeHead(doc.pages && Object.keys(doc.pages).length ? 404 : 200, {
        'content-type': 'text/html; charset=utf-8',
      });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Bowerbird preview</title><body style="font:16px system-ui;padding:2rem">` +
          `<h1>Bowerbird preview</h1>${links ? `<p>Pages:</p><ul>${links}</ul>` : '<p>No pages yet. Ask your agent to build one.</p>'}` +
          `${liveScript(lastChange, badge)}</body>`,
      );
      return;
    }
    const theme = url.searchParams.get('theme');
    const html = renderDocument(doc, store.registry, page.id, {
      ...(theme && /^[a-z0-9-]+$/.test(theme) ? { theme } : {}),
      bodyEnd: liveScript(lastChange, badge),
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4321, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        unsubscribe();
        for (const client of clients) client.end();
        server.close(() => resolve());
      }),
  };
}
