import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createPolicy, createStore } from '@bowerbirdjs/core';
import { startPreview } from '@bowerbirdjs/mcp';
import { afterEach, describe, expect, it } from 'vitest';

const agent = { kind: 'agent', id: 'mcp-claude', name: 'Claude' } as const;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup() {
  const store = createStore({
    registry: createDefaultRegistry(),
    doc: createStarterDoc(),
    policy: createPolicy({ review: { agent: true } }),
  });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  const proposed = store.propose({
    actor: agent,
    label: 'Add hero',
    ops: [
      { op: 'section.insert', section: 'hero' },
      { op: 'props.set', id: 'hero-1/heading', props: { text: 'Proposed heading' } },
    ],
  });
  if (!proposed.ok) throw new Error('propose failed');
  const preview = await startPreview({ store, port: 0 });
  close = preview.close;
  return { store, url: preview.url, id: proposed.changeset.id };
}

const form = (fields: [string, string][]) => ({
  method: 'POST',
  redirect: 'manual' as const,
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

describe('preview review panel', () => {
  it('lists proposals, previews them and accepts selected ops', async () => {
    const { store, url, id } = await setup();
    const page = await (await fetch(`${url}/`)).text();
    expect(page).toContain('Proposed changes (1)');
    expect(page).toContain('add hero section');
    // The op list mentions the text; the page itself doesn't render it until accepted.
    expect(page).not.toMatch(/<h1[^>]*>Proposed heading/);
    const preview = await (await fetch(`${url}/?changeset=${id}`)).text();
    expect(preview).toMatch(/<h1[^>]*>Proposed heading/);
    const token = /name="token" value="([0-9a-f]+)"/.exec(page)?.[1] ?? '';

    const forged = await fetch(`${url}/__bowerbird/changesets/${id}/accept`, form([['ops', '0']]));
    expect(forged.status).toBe(403);
    const crossSite = await fetch(`${url}/__bowerbird/changesets/${id}/accept`, {
      ...form([
        ['token', token],
        ['ops', '0'],
      ]),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://evil.example',
      },
    });
    expect(crossSite.status).toBe(403);
    // Unparseable and opaque origins are refused too (not a server error).
    for (const origin of ['not a url', 'null']) {
      const odd = await fetch(`${url}/__bowerbird/changesets/${id}/accept`, {
        ...form([
          ['token', token],
          ['ops', '0'],
        ]),
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      });
      expect(odd.status).toBe(403);
    }
    expect(store.view.node('hero-1')).toBeUndefined();

    const ok = await fetch(
      `${url}/__bowerbird/changesets/${id}/accept`,
      form([
        ['token', token],
        ['back', '/'],
        ['ops', '0'],
        ['ops', '1'],
      ]),
    );
    expect(ok.status).toBe(303);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Proposed heading');
    expect(store.history.at(-1)).toMatchObject({
      actor: { id: 'mcp-claude' },
      approvedBy: { id: 'reviewer' },
    });
  });

  it('reports refused acceptances instead of redirecting', async () => {
    const { url, id } = await setup();
    const page = await (await fetch(`${url}/`)).text();
    const token = /name="token" value="([0-9a-f]+)"/.exec(page)?.[1] ?? '';
    const res = await fetch(
      `${url}/__bowerbird/changesets/${id}/accept`,
      form([
        ['token', token],
        ['ops', '1'],
      ]),
    );
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/needs op 0/);
  });

  it('previews proposed new pages and asks for a selection', async () => {
    const { store, url, id } = await setup();
    const p = store.propose({
      actor: agent,
      ops: [
        { op: 'page.create', id: 'about', path: '/about', title: 'About' },
        { op: 'section.insert', section: 'cta', page: 'about' },
      ],
    });
    if (!p.ok) throw new Error('propose');
    expect((await fetch(`${url}/about`)).status).toBe(404);
    const about = await fetch(`${url}/about?changeset=${p.changeset.id}`);
    expect(about.status).toBe(200);
    expect(await about.text()).toContain('bb-cta');
    const page = await (await fetch(`${url}/`)).text();
    const token = /name="token" value="([0-9a-f]+)"/.exec(page)?.[1] ?? '';
    const none = await fetch(
      `${url}/__bowerbird/changesets/${id}/accept`,
      form([['token', token]]),
    );
    expect(none.status).toBe(400);
    expect(await none.text()).toMatch(/Nothing was selected/);
  });
});

/** Opens the sync event stream and returns its events as they arrive. */
async function openStream(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const events: { event: string; data: string }[] = [];
  if (res.ok && res.body) {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += value;
          let end = buffer.indexOf('\n\n');
          while (end >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
            const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
            events.push({ event, data });
            end = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Aborted.
      }
    })();
  }
  return { res, events, close: () => controller.abort() };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe('preview sync endpoint', () => {
  it('needs the key from syncUrl, and attributes edits to the connected person', async () => {
    const { store, url } = await setup();
    const preview = await startPreview({ store, port: 0, maxSyncConnections: 1 });
    try {
      expect(preview.syncUrl).toMatch(/\/__bowerbird\/sync\?key=[0-9a-f]{32}$/);
      expect((await fetch(`${preview.url}/__bowerbird/sync`)).status).toBe(403);
      expect((await fetch(`${preview.url}/__bowerbird/sync?key=nope`)).status).toBe(403);
      const stream = await openStream(preview.syncUrl!);
      expect(stream.res.status).toBe(200);
      await until(() => stream.events.length > 0);
      const id = stream.events[0]!.data;
      expect(stream.events[0]!.event).toBe('connection');
      // One connection allowed in this test.
      expect((await fetch(preview.syncUrl!)).status).toBe(503);
      const post = (message: unknown) =>
        fetch(`${preview.url}/__bowerbird/sync/${id}`, {
          method: 'POST',
          body: JSON.stringify(message),
        });
      // Messages before hello are refused with a reason.
      await post({ type: 'presence', state: {} });
      await until(() => stream.events.some((e) => e.data.includes('Say hello first')));
      await post({ type: 'hello', actor: { kind: 'user', id: 'sam' } });
      await until(() => stream.events.some((e) => e.data.includes('"welcome"')));
      await post({
        type: 'tx',
        id: 'c-1',
        input: { ops: [{ op: 'page.update', id: 'home', title: 'Synced' }] },
      });
      await until(() => store.doc.pages.home?.title === 'Synced');
      expect(store.history.at(-1)?.actor.id).toBe('sam');
      stream.close();
    } finally {
      await preview.close();
    }
    expect(url).toBeTruthy();
  });
});
