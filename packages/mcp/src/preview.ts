import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Actor, describeOp, formatIssue, type Store } from '@bowerbirdjs/core';
import { escapeAttr, escapeHtml, renderDocument } from '@bowerbirdjs/html';

export interface PreviewOptions {
  store: Store;
  port?: number;
  host?: string;
  /** Who accepts or rejects proposals from the preview page. */
  reviewer?: Actor;
}

export interface PreviewServer {
  url: string;
  close(): Promise<void>;
}

const EVENTS_PATH = '/__bowerbird/events';
const CHANGESETS_PATH = '/__bowerbird/changesets/';

/** A panel listing open proposals, with per-op checkboxes and accept/reject buttons. */
function reviewPanel(store: Store, token: string, current: string, shown?: string): string {
  const open = store.changesets.filter((c) => c.status.includes('open'));
  if (!open.length) return '';
  const items = open
    .map((c) => {
      const ops = c.ops
        .map((op, i) =>
          c.status[i] === 'open'
            ? `<li><label><input type="checkbox" name="ops" value="${i}" checked> <code>${escapeHtml(describeOp(op))}</code></label>${
                c.needs[i]?.length ? ` <small>needs ${c.needs[i]!.join(', ')}</small>` : ''
              }</li>`
            : '',
        )
        .join('');
      const notes = c.warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join('');
      const action = `${CHANGESETS_PATH}${encodeURIComponent(c.id)}`;
      const back = escapeAttr(current);
      return `<details${shown === c.id ? ' open' : ''}><summary><strong>${escapeHtml(c.id)}</strong> by ${escapeHtml(c.actor.name ?? c.actor.id)}: ${escapeHtml(c.label ?? `${c.ops.length} changes`)}</summary>
<form method="post" action="${action}/accept">
<input type="hidden" name="token" value="${token}"><input type="hidden" name="back" value="${back}">
<ul>${ops}</ul>${notes ? `<p>Notes:</p><ul>${notes}</ul>` : ''}
<a href="?changeset=${encodeURIComponent(c.id)}&amp;badge=0">Preview</a> · <a href="?badge=0">Current page</a>
<button>Accept selected</button>
<button formaction="${action}/reject">Reject selected</button>
</form></details>`;
    })
    .join('');
  return `<aside style="position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:min(560px,calc(100vw - 24px));max-height:60vh;overflow:auto;padding:12px 14px;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 10px 30px #0f172a40;font:13px/1.45 system-ui,sans-serif;text-align:left">
<strong>Proposed changes (${open.length})</strong>${shown ? ` · previewing ${escapeHtml(shown)}` : ''}
${items}</aside>`;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error('Form too large.');
  }
  return new URLSearchParams(body);
}

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
  const reviewer: Actor = options.reviewer ?? { kind: 'user', id: 'reviewer', name: 'Reviewer' };
  // Accept/reject forms carry this token, so other sites can't submit them (CSRF).
  const token = randomBytes(16).toString('hex');
  const clients = new Set<ServerResponse>();
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', host]);
  let lastChange = 'No changes yet';

  const unsubscribe = store.subscribe(({ entry }) => {
    lastChange = `rev ${entry.revision} · ${entry.actor.name ?? entry.actor.id}: ${entry.label ?? `${entry.changes.length} changes`}`;
    for (const client of clients) client.write(`data: ${entry.revision}\n\n`);
  });
  const offChangesets = store.onChangesets(() => {
    for (const client of clients) client.write('data: changesets\n\n');
  });

  const server = createServer((req, res) => {
    // Only answer requests addressed to this machine, so a web page can't read the site through
    // DNS rebinding.
    const hostname = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!allowedHosts.has(hostname)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden host');
      return;
    }
    const fail = (error: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Preview failed: ${error instanceof Error ? error.message : String(error)}`);
    };
    try {
      if (req.method === 'POST') review(req, res).catch(fail);
      else handle(req, res);
    } catch (error) {
      fail(error);
    }
  });

  /** POST /__bowerbird/changesets/<id>/(accept|reject) from the review panel. */
  async function review(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = /^\/__bowerbird\/changesets\/([^/]+)\/(accept|reject)$/.exec(url.pathname);
    const origin = req.headers.origin;
    const sameOrigin =
      !origin || allowedHosts.has(new URL(origin).hostname.replace(/^\[|\]$/g, ''));
    const form = await readForm(req);
    if (!match || !sameOrigin || form.get('token') !== token) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const id = decodeURIComponent(match[1]!);
    const ops = form.getAll('ops').map(Number).filter(Number.isInteger);
    if (!ops.length) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nothing was selected: tick the changes to accept or reject, then try again.');
      return;
    }
    const message =
      match[2] === 'accept'
        ? (() => {
            const result = store.acceptChangeset(id, { by: reviewer, ops });
            return result.ok ? '' : result.errors.map(formatIssue).join('\n');
          })()
        : (store.rejectChangeset(id, { by: reviewer, ops }).errors.map(formatIssue).join('\n') ??
          '');
    if (message) {
      res.writeHead(409, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Not applied:\n${message}`);
      return;
    }
    const back = form.get('back') ?? '/';
    res.writeHead(303, { location: back.startsWith('/') && !back.startsWith('//') ? back : '/' });
    res.end();
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
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
    const badge = url.searchParams.get('badge') !== '0';
    // ?changeset=cs-1 shows the site as it would be with that proposal accepted: its new pages
    // can be opened, and removed pages are gone.
    const shown = url.searchParams.get('changeset') ?? undefined;
    const preview = shown ? store.previewChangeset(shown).doc : undefined;
    const doc = preview ?? store.doc;
    const query = shown ? `?changeset=${encodeURIComponent(shown)}&amp;badge=0` : '';
    const page = Object.values(doc.pages).find((p) => p.path === url.pathname);
    if (!page) {
      const links = Object.values(doc.pages)
        .map(
          (p) =>
            `<li><a href="${escapeAttr(p.path)}${query}">${escapeHtml(p.title)}</a> <code>${escapeHtml(p.path)}</code></li>`,
        )
        .join('');
      res.writeHead(Object.keys(doc.pages).length && url.pathname !== '/' ? 404 : 200, {
        'content-type': 'text/html; charset=utf-8',
      });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Bowerbird preview</title><body style="font:16px system-ui;padding:2rem">` +
          `<h1>Bowerbird preview</h1>${links ? `<p>Pages${shown ? ` (with ${escapeHtml(shown)})` : ''}:</p><ul>${links}</ul>` : '<p>No pages yet. Ask your agent to build one.</p>'}` +
          reviewPanel(store, token, url.pathname, preview ? shown : undefined) +
          `${liveScript(lastChange, badge)}</body>`,
      );
      return;
    }
    const theme = url.searchParams.get('theme');
    const html = renderDocument(doc, store.registry, page.id, {
      ...(theme && /^[a-z0-9-]+$/.test(theme) ? { theme } : {}),
      bodyEnd:
        reviewPanel(store, token, url.pathname, preview ? shown : undefined) +
        liveScript(preview ? `Preview of ${shown}` : lastChange, badge),
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  }

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
        offChangesets();
        for (const client of clients) client.end();
        server.close(() => resolve());
      }),
  };
}
