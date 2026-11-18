import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { createMcpServer, PAGE_VIEW_URI, startPreview } from '@bowerbirdjs/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

async function connect() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  const server = createMcpServer({ store, previewUrl: () => 'http://localhost:4321' });
  const client = new Client({ name: 'Test Client', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const content = res.content as { type: string; text: string }[];
    return { text: content.map((c) => c.text).join('\n'), isError: !!res.isError };
  };
  return { store, client, call };
}

describe('MCP server', () => {
  it('lists tools with JSON schemas and annotations', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('apply');
    const apply = tools.find((t) => t.name === 'apply')!;
    expect(apply.inputSchema.type).toBe('object');
    expect(apply.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'get_outline')?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toContain('get_context');
  });

  it('builds a page over MCP and attributes changes to the client', async () => {
    const { store, call } = await connect();
    expect((await call('get_context')).text).toContain(
      'Live preview (tell the user): http://localhost:4321',
    );
    const res = await call('apply', {
      label: 'Landing page',
      ops: [
        { op: 'section.insert', section: 'nav' },
        { op: 'section.insert', section: 'hero', content: { heading: { text: 'Hello from MCP' } } },
        { op: 'section.insert', section: 'footer' },
      ],
    });
    expect(res.isError).toBe(false);
    expect(store.history.at(-1)?.actor).toEqual({
      kind: 'agent',
      id: 'mcp-test-client',
      name: 'Test Client',
    });
    expect((await call('get_outline', { depth: 1 })).text).toContain(
      'hero-1  section:hero[layout=centered]',
    );
    const bad = await call('apply', {
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { txt: 'x' } }],
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Did you mean "text"');
  });

  it('serves a live preview of every page', async () => {
    const { store } = await connect();
    store.apply({
      ops: [
        { op: 'section.insert', section: 'hero', content: { heading: { text: 'Preview me' } } },
      ],
    });
    const preview = await startPreview({ store, port: 0 });
    try {
      const html = await (await fetch(`${preview.url}/`)).text();
      expect(html).toContain('<h1 class="bb-hero__heading">Preview me</h1>');
      expect(html).toContain('EventSource');
      const missing = await fetch(`${preview.url}/nope`);
      expect(missing.status).toBe(404);
    } finally {
      await preview.close();
    }
  });

  it('shows pages as an MCP Apps view', async () => {
    const { store, client, call } = await connect();
    store.apply({
      ops: [
        { op: 'section.insert', section: 'hero', content: { heading: { text: 'Shown inline' } } },
      ],
    });
    const { tools } = await client.listTools();
    const show = tools.find((t) => t.name === 'show_page')!;
    expect(show._meta).toMatchObject({ ui: { resourceUri: PAGE_VIEW_URI } });
    expect((await call('show_page', { page: 'home' })).text).toContain('Showing page home');
    expect((await call('show_page', { page: 'nope' })).isError).toBe(true);
    const { resources } = await client.listResources();
    expect(resources).toEqual([
      expect.objectContaining({ uri: PAGE_VIEW_URI, mimeType: 'text/html;profile=mcp-app' }),
    ]);
    const read = await client.readResource({ uri: PAGE_VIEW_URI });
    const html = (read.contents[0] as { text: string }).text;
    expect(html).toContain('<h1 class="bb-hero__heading">Shown inline</h1>');
    expect(html).not.toContain('<script');
  });

  it('show_page ignores prototype names, and each call names its own view', async () => {
    const { store, client, call } = await connect();
    store.apply({
      ops: [
        { op: 'section.insert', section: 'hero', content: { heading: { text: 'Hello' } } },
        { op: 'page.create', id: 'about', path: '/about', title: 'About' },
        { op: 'locale.set', add: ['de'] },
        { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
      ],
    });
    for (const page of ['constructor', '__proto__', 'toString']) {
      const res = await call('show_page', { page });
      expect(res.isError).toBe(true);
      expect(res.text).toContain(`No page "${page}"`);
    }
    expect((await call('show_page', { locale: 'xx' })).isError).toBe(true);
    const res = await client.callTool({
      name: 'show_page',
      arguments: { page: 'home', locale: 'de' },
    });
    const uri = (res._meta as { ui: { resourceUri: string } }).ui.resourceUri;
    expect(uri).toBe(`${PAGE_VIEW_URI}?page=home&locale=de`);
    expect(res.structuredContent).toEqual({ page: 'home', locale: 'de' });
    // A later call shows another page, but the first call's view still shows its own page.
    await call('show_page', { page: 'about' });
    const first = (await client.readResource({ uri })).contents[0] as { text: string };
    expect(first.text).toContain('Hallo');
    expect(first.text).toContain('<html lang="de"');
    const latest = (await client.readResource({ uri: PAGE_VIEW_URI })).contents[0] as {
      text: string;
    };
    expect(latest.text).toContain('<title>About</title>');
    await expect(client.readResource({ uri: 'ui://bowerbird/other' })).rejects.toThrow();
  });
});
