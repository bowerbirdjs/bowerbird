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
