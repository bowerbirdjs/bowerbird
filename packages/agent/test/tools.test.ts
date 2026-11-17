import { createAgentTools, runTool, sectionParts, toolDefinitions } from '@bowerbirdjs/agent';
import { createDefaultRegistry, createStarterDoc, hero, pricing } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

function setup() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'test-agent' } });
  return { store, tools, run: (name: string, input: unknown = {}) => runTool(tools, name, input) };
}

describe('agent tools', () => {
  it('lists section parts with keyed paths', () => {
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

  it('gives context, sections and tokens', () => {
    const { run } = setup();
    const ctx = run('get_context').text;
    expect(ctx).toContain('Pages: home "/" (Home)');
    expect(ctx).toContain('only design tokens are allowed');
    expect(ctx).toContain('## Op examples');
    expect(run('list_sections', { name: 'pricing' }).text).toContain(
      'tier-pro/price  text<span>  "$29"',
    );
    expect(run('list_tokens', { prefix: 'space' }).text).toContain('--space-lg: 1.5rem');
  });

  it('applies ops, reports what changed and shows the new outline', () => {
    const { run, store } = setup();
    const res = run('apply', {
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
    expect(run('get_outline').text).toContain('"Hello agents"');
  });

  it('returns actionable errors and changes nothing on failure', () => {
    const { run, store } = setup();
    const res = run('apply', {
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

  it('rejects malformed tool input clearly', () => {
    const { run } = setup();
    expect(run('apply', { ops: 'nope' }).text).toContain('Invalid input');
    expect(run('apply', { ops: [{ op: 'sectoin.insert' }] }).text).toContain(
      'Did you mean "section.insert"',
    );
    expect(run('nope').text).toContain('Unknown tool');
  });

  it('imports HTML after an anchor, in order, with notes', () => {
    const { run, store } = setup();
    run('apply', {
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'section.insert', section: 'cta' },
      ],
    });
    const res = run('import_html', {
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
    const raw = run('import_html', { html: '<p style="padding: 13px">x</p>' });
    expect(raw.isError).toBe(true);
    expect(raw.text).toContain('Closest tokens: var(--space-sm)');
  });

  it('lints pages', () => {
    const { run } = setup();
    run('apply', { ops: [{ op: 'section.insert', section: 'hero' }] });
    const text = run('lint').text;
    expect(text).toMatch(/^page home: 0 errors, \d+ warnings, \d+ notes/);
    expect(text).toContain('template-text hero-1/heading');
  });

  it('undoes only its own changes', () => {
    const { run, store } = setup();
    run('apply', { ops: [{ op: 'section.insert', section: 'hero' }] });
    store.apply({
      actor: { kind: 'user', id: 'ana' },
      ops: [{ op: 'section.insert', section: 'cta' }],
    });
    const res = run('undo');
    expect(res.text).toContain('Applied');
    expect(store.doc.nodes['hero-1']).toBeUndefined();
    expect(store.doc.nodes['cta-1']).toBeDefined();
  });

  it('produces JSON Schema tool definitions', () => {
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
