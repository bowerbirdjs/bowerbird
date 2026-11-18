import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { createMcpServer, startPreview } from '@bowerbirdjs/mcp';
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
});
