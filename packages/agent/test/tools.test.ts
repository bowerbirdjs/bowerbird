import {
  createAgentTools,
  runTool,
  sectionParts,
  toolDefinitions,
  toolResultContent,
} from '@bowerbirdjs/agent';
import { createDefaultRegistry, createStarterDoc, hero, pricing } from '@bowerbirdjs/blocks';
import { createPolicy, createStore } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

function setup() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'test-agent' } });
  return { store, tools, run: (name: string, input: unknown = {}) => runTool(tools, name, input) };
}

describe('agent tools', async () => {
  it('lists section parts with keyed paths', async () => {
    expect(sectionParts(hero).map((p) => p.path)).toEqual([
      'content',
      'eyebrow',
      'heading',
      'subheading',
      'actions',
      'primary',
      'secondary',
    ]);
    expect(sectionParts(hero, { layout: 'split' }).map((p) => p.path)).toContain('media');
    const paths = sectionParts(pricing).map((p) => p.path);
    expect(paths).toContain('tier-pro/badge');
    expect(paths).toContain('tier-team/feature-3');
  });

  it('gives context, sections and tokens', async () => {
    const { run } = setup();
    const ctx = (await run('get_context')).text;
    expect(ctx).toContain('Pages: home "/" (Home)');
    expect(ctx).toContain('only design tokens are allowed');
    expect(ctx).toContain('## Op examples');
    expect((await run('list_sections', { name: 'pricing' })).text).toContain(
      'tier-pro/price  text<span>  "$29"',
    );
    expect((await run('list_tokens', { prefix: 'space' })).text).toContain('--space-lg: 1.5rem');
  });

  it('applies ops, reports what changed and shows the new outline', async () => {
    const { run, store } = setup();
    const res = await run('apply', {
      label: 'Add hero',
      ops: [
        { op: 'section.insert', section: 'hero', content: { heading: { text: 'Hello agents' } } },
      ],
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain('Applied tx-2');
    expect(res.text).toContain('Created: hero-1 (+');
    expect(res.text).toContain('hero-1/heading');
    expect(store.history.at(-1)?.actor.id).toBe('test-agent');
    expect((await run('get_outline')).text).toContain('"Hello agents"');
  });

  it('returns actionable errors and changes nothing on failure', async () => {
    const { run, store } = setup();
    const res = await run('apply', {
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'style.set', id: 'hero-1/heading', css: 'color: #ff0000' },
        { op: 'node.remove', id: 'hero-1' },
      ],
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('No changes were applied');
    expect(res.text).toContain('[raw_value]');
    expect(res.text).toContain('var(--color-');
    expect(res.text).toContain('ops after ops[1] were not checked');
    expect(store.doc.nodes['hero-1']).toBeUndefined();
  });

  it('rejects malformed tool input clearly', async () => {
    const { run } = setup();
    expect((await run('apply', { ops: 'nope' })).text).toContain('Invalid input');
    expect((await run('apply', { ops: [{ op: 'sectoin.insert' }] })).text).toContain(
      'Did you mean "section.insert"',
    );
    expect((await run('nope')).text).toContain('Unknown tool');
  });

  it('imports HTML after an anchor, in order, with notes', async () => {
    const { run, store } = setup();
    await run('apply', {
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'section.insert', section: 'cta' },
      ],
    });
    const res = await run('import_html', {
      after: 'hero-1',
      html: '<section class="x"><h2>Story</h2></section><section><h2>Team</h2></section>',
    });
    expect(res.isError).toBeFalsy();
    expect(res.text).toContain('Note: class attributes were ignored');
    expect(store.view.children('root-home').map((n) => n.id)).toEqual([
      'hero-1',
      'box-1',
      'box-2',
      'cta-1',
    ]);
    const raw = await run('import_html', { html: '<p style="padding: 13px">x</p>' });
    expect(raw.isError).toBe(true);
    expect(raw.text).toContain('Closest tokens: var(--space-sm)');
  });

  it('lints pages', async () => {
    const { run } = setup();
    await run('apply', { ops: [{ op: 'section.insert', section: 'hero' }] });
    const text = (await run('lint')).text;
    expect(text).toMatch(/^page home: 0 errors, \d+ warnings, \d+ notes/);
    expect(text).toContain('template-text hero-1/heading');
  });

  it('undoes only its own changes', async () => {
    const { run, store } = setup();
    await run('apply', { ops: [{ op: 'section.insert', section: 'hero' }] });
    store.apply({
      actor: { kind: 'user', id: 'ana' },
      ops: [{ op: 'section.insert', section: 'cta' }],
    });
    const res = await run('undo');
    expect(res.text).toContain('Applied');
    expect(store.doc.nodes['hero-1']).toBeUndefined();
    expect(store.doc.nodes['cta-1']).toBeDefined();
  });

  it('produces JSON Schema tool definitions', async () => {
    const { tools } = setup();
    const defs = toolDefinitions(tools);
    const apply = defs.find((d) => d.name === 'apply')!;
    expect(apply.input_schema.type).toBe('object');
    expect(JSON.stringify(apply.input_schema)).toContain('section.insert');
    expect(defs.map((d) => d.name)).toEqual([
      'get_context',
      'get_outline',
      'get_nodes',
      'list_sections',
      'list_tokens',
      'apply',
      'import_html',
      'lint',
      'undo',
    ]);
  });
});

describe('agent tools (phase 2)', () => {
  it('apply proposes when review is required, and with propose: true', async () => {
    const store = createStore({
      registry: createDefaultRegistry(),
      doc: createStarterDoc(),
      policy: createPolicy({ review: { agent: true } }),
    });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'a' } });
    const res = await runTool(tools, 'apply', { ops: [{ op: 'section.insert', section: 'hero' }] });
    expect(res.text).toMatch(/^Proposed cs-1 \(1 op\) for review/);
    expect(res.text).toContain('Would create: hero-1');
    expect(store.view.node('hero-1')).toBeUndefined();
    expect((await runTool(tools, 'get_context', {})).text).toContain(
      'Your open proposals: cs-1 (1 open ops)',
    );
  });

  it('overwrite lets an agent change a person’s edit when protection asks for confirmation', async () => {
    const store = createStore({
      registry: createDefaultRegistry(),
      doc: createStarterDoc(),
      policy: createPolicy({ protectHumanEdits: 'confirm' }),
    });
    store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'section.insert', section: 'hero' },
      ],
    });
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Mine' } }],
      actor: { kind: 'user', id: 'sam' },
    });
    const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'a' } });
    const ops = [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Agent' } }];
    const refused = await runTool(tools, 'apply', { ops });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('[human_edit]');
    expect((await runTool(tools, 'get_outline', {})).text).toContain('[edited by sam]');
    expect((await runTool(tools, 'apply', { ops, overwrite: true })).isError).toBeFalsy();
  });

  it('lists symbols in the context and shows links in get_nodes', async () => {
    const { store, run } = setup();
    store.apply({
      ops: [
        { op: 'section.insert', section: 'footer' },
        { op: 'symbol.create', id: 'footer-1', name: 'Site footer' },
      ],
    });
    expect((await run('get_context')).text).toContain(
      'site-footer "Site footer" (definition symbol-site-footer, 1 instances)',
    );
    const nodes = JSON.parse((await run('get_nodes', { ids: ['footer-1'] })).text);
    expect(nodes[0]).toMatchObject({ linkedTo: 'symbol-site-footer', symbol: 'site-footer' });
  });

  it('offers layout and screenshot tools when a provider is given', async () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const widths: number[] = [];
    const tools = createAgentTools({
      store,
      layout: {
        snapshot: async ({ page, width }) => {
          widths.push(width);
          return {
            page,
            width,
            height: 500,
            overflowX: 0,
            boxes: [
              { id: 'root-home', parent: null, tag: 'div', x: 0, y: 0, w: width, h: 500 },
              { id: 'box-1', parent: 'root-home', tag: 'div', x: 0, y: 0, w: width + 40, h: 100 },
            ],
          };
        },
        screenshot: async () => ({ data: 'iVBORw0KGgo=', mimeType: 'image/png' }),
      },
    });
    const layout = await runTool(tools, 'get_layout', { bp: 'base' });
    expect(widths).toEqual([390]);
    expect(layout.text).toContain('horizontal-overflow box-1');
    const shot = await runTool(tools, 'screenshot', {});
    expect(shot.images).toEqual([{ data: 'iVBORw0KGgo=', mimeType: 'image/png' }]);
    expect(toolResultContent(shot)[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
    });
    // Without a provider the tools aren't offered.
    expect(createAgentTools({ store }).map((t) => t.name)).not.toContain('get_layout');
  });

  it('lays out at widths inside each breakpoint, and explains unknown breakpoints and themes', async () => {
    const store = createStore({
      registry: createDefaultRegistry(),
      doc: {
        ...createStarterDoc(),
        breakpoints: [
          { id: 'base', minWidth: 0 },
          { id: 'md', minWidth: 900 },
          { id: 'lg', minWidth: 1400 },
        ],
      },
    });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const widths: number[] = [];
    const tools = createAgentTools({
      store,
      layout: {
        snapshot: async ({ width, page }) => {
          widths.push(width);
          return { page, width, height: 1, overflowX: 0, boxes: [] };
        },
      },
    });
    await runTool(tools, 'get_layout', { bp: 'md' });
    await runTool(tools, 'get_layout', { bp: 'lg' });
    expect(widths).toEqual([900, 1400]);
    expect((await runTool(tools, 'get_layout', { bp: 'mobile' })).text).toMatch(
      /No breakpoint "mobile"/,
    );
    expect((await runTool(tools, 'get_layout', { theme: 'sepia' })).text).toMatch(
      /No theme "sepia"/,
    );
  });

  it('dry runs of proposals say what would be proposed; lint can check a proposal', async () => {
    const store = createStore({
      registry: createDefaultRegistry(),
      doc: createStarterDoc(),
      policy: createPolicy({ review: { agent: true } }),
    });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'a' } });
    const dry = await runTool(tools, 'apply', {
      ops: [{ op: 'section.insert', section: 'hero' }],
      dryRun: true,
    });
    expect(dry.text).toMatch(/this would be proposed for review; nothing was stored/);
    expect(store.changesets).toHaveLength(0);
    const proposed = await runTool(tools, 'apply', {
      ops: [{ op: 'section.insert', section: 'hero' }],
    });
    expect(proposed.text).toContain('changeset: "cs-1"');
    expect((await runTool(tools, 'lint', { changeset: 'cs-1' })).text).toContain('template-text');
    expect((await runTool(tools, 'lint', {})).text).not.toContain('template-text');
    expect((await runTool(tools, 'undo', {})).text).toContain('[review_required]');
  });
});
