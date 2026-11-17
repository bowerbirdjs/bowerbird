import { outline } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r, null, 2));
  return r as Extract<T, { ok: true }>;
};
const errors = (r: {
  ok: boolean;
  errors?: { code: string; message: string; hint?: string }[];
}) => {
  if (r.ok) throw new Error('expected failure');
  return r.errors!;
};

describe('pages and sections', () => {
  it('creates a page with a root node', () => {
    const store = makeStore();
    expect(store.doc.pages.home).toMatchObject({ path: '/', title: 'Home', rootId: 'root-home' });
    expect(store.doc.nodes['root-home']?.type).toBe('root');
  });

  it('inserts a section with readable, scoped ids and fills content in one op', () => {
    const store = makeStore();
    const res = ok(
      store.apply({
        ops: [
          {
            op: 'section.insert',
            section: 'hero',
            content: { heading: { text: 'Ship pages with your agent' }, cta: { href: '/start' } },
          },
        ],
      }),
    );
    expect(res.summary.created).toContain('hero-1');
    const n = store.doc.nodes;
    expect(n['hero-1']?.section).toEqual({
      name: 'hero',
      version: 1,
      variant: { layout: 'centered' },
    });
    expect(n['hero-1/content']?.part).toBe('content');
    // non-keyed parts don't add a scope level: heading lives at hero-1/heading
    expect(n['hero-1/heading']?.props).toEqual({ tag: 'h1', text: 'Ship pages with your agent' });
    expect(n['hero-1/cta']?.props.href).toBe('/start');
    expect(n['hero-1/media']).toBeUndefined();
  });

  it('scopes keyed items and numbers new sections', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'features' },
          { op: 'section.insert', section: 'features' },
        ],
      }),
    );
    expect(store.doc.nodes['features-1/item-2/title']?.props.text).toBe('Feature 2');
    expect(store.doc.nodes['features-2/item-1']?.key).toBe('1');
  });

  it('honours variants and rejects unknown ones with the allowed values', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', variant: { layout: 'split' } }],
      }),
    );
    expect(store.doc.nodes['hero-1/media']?.type).toBe('image');
    const errs = errors(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', variant: { layout: 'grid' } }],
      }),
    );
    expect(errs[0]?.message).toContain('allowed: centered, split');
  });

  it('suggests close matches for unknown sections and parts', () => {
    const store = makeStore();
    expect(
      errors(store.apply({ ops: [{ op: 'section.insert', section: 'heor' }] }))[0]?.message,
    ).toContain('"hero"');
    const errs = errors(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', content: { headline: { text: 'x' } } }],
      }),
    );
    expect(errs[0]?.code).toBe('unknown_part');
    expect(errs[0]?.message).toContain('"heading"');
  });

  it('places sections before/after siblings', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero' },
          { op: 'section.insert', section: 'features' },
        ],
      }),
    );
    ok(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', id: 'hero-top', before: 'hero-1' }],
      }),
    );
    expect(store.view.children('root-home').map((n) => n.id)).toEqual([
      'hero-top',
      'hero-1',
      'features-1',
    ]);
  });
});

describe('node operations', () => {
  it('moves nodes and prevents cycles', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero' },
          { op: 'section.insert', section: 'features' },
        ],
      }),
    );
    ok(store.apply({ ops: [{ op: 'node.move', id: 'features-1', before: 'hero-1' }] }));
    expect(store.view.children('root-home').map((n) => n.id)).toEqual(['features-1', 'hero-1']);
    expect(
      errors(store.apply({ ops: [{ op: 'node.move', id: 'hero-1', parent: 'hero-1/content' }] }))[0]
        ?.code,
    ).toBe('cycle');
  });

  it('duplicates keyed items with the next free key', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'features' }] }));
    const res = ok(store.apply({ ops: [{ op: 'node.duplicate', id: 'features-1/item-3' }] }));
    expect(res.summary.created).toEqual(
      expect.arrayContaining(['features-1/item-4', 'features-1/item-4/title']),
    );
    expect(store.doc.nodes['features-1/item-4']?.key).toBe('4');
    expect(store.view.children('features-1/grid').map((n) => n.id)).toEqual([
      'features-1/item-1',
      'features-1/item-2',
      'features-1/item-3',
      'features-1/item-4',
    ]);
  });

  it('removes subtrees but never a page root', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(store.apply({ ops: [{ op: 'node.remove', id: 'hero-1' }] }));
    expect(Object.keys(store.doc.nodes)).toEqual(['root-home']);
    expect(errors(store.apply({ ops: [{ op: 'node.remove', id: 'root-home' }] }))[0]?.code).toBe(
      'root_node',
    );
  });

  it('generates ids inside the nearest scope for inserted nodes', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        ops: [
          {
            op: 'node.insert',
            parent: 'hero-1/content',
            node: { type: 'text', props: { text: 'New line' } },
          },
        ],
      }),
    );
    expect(store.doc.nodes['hero-1/text-1']?.props.text).toBe('New line');
  });
});

describe('validation messages', () => {
  it('reports unknown props with a suggestion and the valid list', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'props.set', id: 'hero-1/cta', props: { herf: '/x' } }] }),
    );
    expect(e?.code).toBe('unknown_prop');
    expect(e?.message).toContain('Did you mean "href"');
    expect(e?.hint).toContain('Props of link');
  });

  it('reports invalid enum values with the allowed values', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'props.set', id: 'hero-1/heading', props: { tag: 'h7' } }] }),
    );
    expect(e?.hint).toContain('h1');
  });

  it('suggests node ids', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'props.set', id: 'hero-1/headng', props: { text: 'x' } }] }),
    );
    expect(e?.message).toContain('"hero-1/heading"');
  });

  it('is all-or-nothing and reports the failing op', () => {
    const store = makeStore();
    const res = store.apply({
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'props.set', id: 'nope', props: {} },
      ],
    });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.failedOp).toBe(1);
    expect(store.doc.revision).toBe(1);
    expect(store.doc.nodes['hero-1']).toBeUndefined();
  });

  it('rejects unknown op names with a suggestion', () => {
    const store = makeStore();
    const [e] = errors(store.apply({ ops: [{ op: 'section.add', section: 'hero' }] }));
    expect(e?.message).toContain('Unknown op');
    expect(e?.hint).toContain('section.insert');
  });

  it('edits text by exact unique match', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        ops: [{ op: 'text.edit', id: 'hero-1/heading', find: 'Your', replace: 'Our' }],
      }),
    );
    expect(store.doc.nodes['hero-1/heading']?.props.text).toBe('Our headline');
    expect(
      errors(
        store.apply({ ops: [{ op: 'text.edit', id: 'hero-1/heading', find: 'xyz', replace: '' }] }),
      )[0]?.hint,
    ).toContain('Our headline');
  });
});

describe('styles and variables', () => {
  it('stores token-based declarations per breakpoint and state', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        ops: [
          { op: 'style.set', id: 'hero-1', css: 'padding-block: var(--space-lg); display: grid' },
          { op: 'style.set', id: 'hero-1', bp: 'md', css: 'padding-block: var(--space-md)' },
          {
            op: 'style.set',
            id: 'hero-1/cta',
            state: 'hover',
            css: 'background: var(--color-accent-hover)',
          },
        ],
      }),
    );
    expect(store.doc.nodes['hero-1']?.styles).toEqual({
      base: { default: { 'padding-block': 'var(--space-lg)', display: 'grid' } },
      md: { default: { 'padding-block': 'var(--space-md)' } },
    });
    ok(
      store.apply({
        ops: [{ op: 'style.set', id: 'hero-1', bp: 'md', remove: ['padding-block'] }],
      }),
    );
    expect(store.doc.nodes['hero-1']?.styles?.md).toBeUndefined();
  });

  it('rejects raw values by default and suggests tokens', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'padding: 24px' }] }),
    );
    expect(e?.code).toBe('raw_value');
    expect(e?.hint).toContain('var(--space-md)');
    expect(
      errors(store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'color: #fff' }] }))[0]
        ?.code,
    ).toBe('raw_value');
  });

  it('allows raw values when policy permits', () => {
    const store = makeStore({ allowRawValues: true });
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'padding: 24px; color: #fff' }] }),
    );
  });

  it('rejects unknown tokens with a suggestion and unsafe values', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'gap: var(--space-lgg)' }] }),
    );
    expect(e?.code).toBe('unknown_token');
    expect(e?.message).toContain('--space-lg');
    expect(
      errors(
        store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'color: red}body{color:red' }] }),
      )[0]?.code,
    ).toBe('invalid_style');
  });

  it('sets section variables and token overrides via vars.set', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        ops: [{ op: 'vars.set', id: 'hero-1', vars: { '--hero-bg': 'var(--color-accent)' } }],
      }),
    );
    ok(
      store.apply({
        ops: [
          {
            op: 'vars.set',
            id: 'hero-1/content',
            vars: { '--color-surface': 'var(--color-accent)' },
          },
        ],
      }),
    );
    const [e] = errors(
      store.apply({ ops: [{ op: 'vars.set', id: 'hero-1', vars: { '--hero-bgg': 'x' } }] }),
    );
    expect(e?.code).toBe('invalid_var');
    expect(e?.message).toContain('--hero-bg');
  });

  it('changes tokens and theme values', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: '#0ea5e9' }] }));
    ok(
      store.apply({
        ops: [{ op: 'token.set', path: 'color.surface', value: '#000000', theme: 'dark' }],
      }),
    );
    expect(store.doc.themes).toEqual({ dark: { 'color.surface': '#000000' } });
    expect(
      errors(store.apply({ ops: [{ op: 'token.set', path: 'color.x', value: '{color.nope}' }] }))[0]
        ?.code,
    ).toBe('unknown_token');
  });
});

describe('transactions, history and undo', () => {
  it('rejects stale base revisions', () => {
    const store = makeStore();
    const [e] = errors(
      store.apply({ baseRevision: 0, ops: [{ op: 'section.insert', section: 'hero' }] }),
    );
    expect(e?.code).toBe('stale_revision');
  });

  it('supports dry runs', () => {
    const store = makeStore();
    const res = ok(store.apply({ dryRun: true, ops: [{ op: 'section.insert', section: 'hero' }] }));
    expect(res.dryRun).toBe(true);
    expect(res.summary.created).toContain('hero-1');
    expect(store.doc.nodes['hero-1']).toBeUndefined();
  });

  it("undoes one actor's transaction while keeping another actor's later edits", () => {
    const store = makeStore();
    ok(
      store.apply({
        actor: agent,
        label: 'Add hero',
        ops: [{ op: 'section.insert', section: 'hero' }],
      }),
    );
    ok(
      store.apply({
        actor: human,
        ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Human title' } }],
      }),
    );
    ok(
      store.apply({
        actor: agent,
        label: 'Restyle',
        ops: [
          { op: 'props.set', id: 'hero-1/heading', props: { tag: 'h2' } },
          { op: 'props.set', id: 'hero-1/cta', props: { text: 'Start now' } },
        ],
      }),
    );
    ok(
      store.apply({
        actor: human,
        ops: [{ op: 'props.set', id: 'hero-1/cta', props: { text: 'Go' } }],
      }),
    );

    const undo = ok(store.undo({ actorId: 'claude' }));
    expect(undo.warnings.some((w) => w.code === 'conflict' && w.nodeId === 'hero-1/cta')).toBe(
      true,
    );
    // agent's tag change reverted, human's later text edits kept
    expect(store.doc.nodes['hero-1/heading']?.props).toEqual({ tag: 'h1', text: 'Human title' });
    expect(store.doc.nodes['hero-1/cta']?.props.text).toBe('Go');

    // the next agent undo reaches back to the section insert
    ok(store.undo({ actorId: 'claude' }));
    expect(store.doc.nodes['hero-1']).toBeUndefined();
    expect(errors(store.undo({ actorId: 'claude' }))[0]?.code).toBe('nothing_to_undo');
  });

  it('redoes undone work and clears redo after a new edit', () => {
    const store = makeStore();
    ok(store.apply({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(store.undo({ actorId: 'claude' }));
    expect(store.doc.nodes['hero-1']).toBeUndefined();
    ok(store.redo({ actorId: 'claude' }));
    expect(store.doc.nodes['hero-1/heading']).toBeDefined();
    ok(store.undo({ actorId: 'claude' }));
    ok(store.apply({ actor: agent, ops: [{ op: 'section.insert', section: 'features' }] }));
    expect(errors(store.redo({ actorId: 'claude' }))[0]?.code).toBe('nothing_to_undo');
  });

  it('restores removed subtrees on undo', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'features' }] }));
    const before = structuredClone(store.doc.nodes);
    ok(store.apply({ ops: [{ op: 'node.remove', id: 'features-1' }] }));
    ok(store.undo());
    expect(store.doc.nodes).toEqual(before);
  });

  it('notifies subscribers with the history entry', () => {
    const store = makeStore();
    const seen: string[] = [];
    store.subscribe((e) =>
      seen.push(`${e.entry.txId}:${e.entry.actor.id}:${e.summary.created.length}`),
    );
    ok(store.apply({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] }));
    expect(seen).toEqual(['tx-2:claude:5']);
  });
});

describe('policy', () => {
  it('limits agents to content edits when configured', () => {
    const store = makeStore({ levels: { agent: 'content' } });
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        actor: agent,
        ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Allowed' } }],
      }),
    );
    const [e] = errors(
      store.apply({
        actor: agent,
        ops: [{ op: 'props.set', id: 'hero-1/heading', props: { tag: 'h2' } }],
      }),
    );
    expect(e?.code).toBe('policy');
    expect(
      errors(store.apply({ actor: agent, ops: [{ op: 'node.remove', id: 'hero-1' }] }))[0]?.code,
    ).toBe('policy');
  });

  it('protects locked subtrees', () => {
    const store = makeStore({ lockedNodes: ['hero-1'] });
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'x' } }] }),
    );
    expect(e?.message).toContain('locked');
  });
});

describe('outline', () => {
  it('renders a compact, depth-limited outline', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero' },
          { op: 'section.insert', section: 'features' },
        ],
      }),
    );
    const shallow = outline(store.view, { depth: 2 });
    expect(shallow).toContain('page home  "/"  title="Home"');
    expect(shallow).toContain('  hero-1  section:hero[layout=centered]');
    expect(shallow).toContain('    hero-1/content  box<div>  [+3 more]');
    expect(shallow).toMatch(/features-1\/grid {2}box<ul> {2}\[\+9 more\]/);
    const deep = outline(store.view);
    expect(deep).toContain('      hero-1/heading  text<h1>  "Your headline"');
    expect(outline(store.view, { root: 'hero-1/cta' })).toBe('hero-1/cta  link  "Get started" → #');
  });
});
