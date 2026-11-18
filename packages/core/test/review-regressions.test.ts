import {
  ancestors,
  createEmptyDoc,
  createPolicy,
  createRegistry,
  createStore,
  defineSection,
  descendants,
  MAX_DEPTH,
  type NodeInput,
  type Store,
  t,
} from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { agent, features, hero, human, makeStore, tokens } from './fixtures.js';

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
const uniqueOrders = (store: Store, parent: string) => {
  const orders = store.view.children(parent).map((c) => c.order);
  return new Set(orders).size === orders.length;
};

describe('injection and prototype safety', () => {
  it('rejects token paths and theme names that reach the prototype', () => {
    const store = makeStore();
    expect(
      errors(store.apply({ ops: [{ op: 'token.set', path: '__proto__.children', value: 'x' }] }))[0]
        ?.code,
    ).toBe('invalid_token');
    expect(({} as Record<string, unknown>).children).toBeUndefined();
    expect(
      errors(
        store.apply({
          ops: [{ op: 'token.set', path: 'color.surface', value: '#000', theme: 'constructor' }],
        }),
      )[0]?.code,
    ).toBe('invalid_token');
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
  });

  it('does not treat inherited names as nodes, pages, states or variant axes', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    expect(
      errors(store.apply({ ops: [{ op: 'props.set', id: 'constructor', props: {} }] }))[0]?.code,
    ).toBe('not_found');
    expect(
      errors(store.apply({ ops: [{ op: 'section.insert', section: 'hero', page: 'toString' }] }))[0]
        ?.code,
    ).toBe('not_found');
    expect(
      errors(
        store.apply({
          ops: [{ op: 'style.set', id: 'hero-1', state: 'constructor', css: 'display: grid' }],
        }),
      )[0]?.code,
    ).toBe('unknown_state');
    expect(
      errors(
        store.apply({
          ops: [{ op: 'section.insert', section: 'hero', variant: { toString: 'x' } }],
        }),
      )[0]?.code,
    ).toBe('invalid_variant');
  });

  it('validates property names in node styles', () => {
    const store = makeStore();
    const res = store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: {
            type: 'box',
            styles: {
              base: { default: { 'color:red}body{display:none}.x{color': 'var(--color-accent)' } },
            },
          },
        },
      ],
    });
    expect(errors(res)[0]?.code).toBe('invalid_style');
  });

  it('rejects token values that would break out of the stylesheet', () => {
    const store = makeStore();
    for (const value of ['red}body{background:red', 'red; x: y', '"unclosed', 'calc(1 + (2)']) {
      expect(
        errors(store.apply({ ops: [{ op: 'token.set', path: 'color.evil', value }] }))[0]?.code,
      ).toBe('invalid_token');
    }
    ok(
      store.apply({
        ops: [{ op: 'token.set', path: 'font.display', value: '"Inter Variable", sans-serif' }],
      }),
    );
  });

  it('rejects style values with unbalanced brackets or quotes', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    for (const css of [
      'padding: calc(var(--space-md)',
      'grid-area: "a',
      'width: min(var(--space-md))]',
    ]) {
      expect(errors(store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css }] }))[0]?.code).toBe(
        'invalid_style',
      );
    }
  });

  it('flags raw values written in scientific notation or as rare colour names', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    expect(
      errors(store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'width: 1e3px' }] }))[0]
        ?.code,
    ).toBe('raw_value');
    expect(
      errors(
        store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'color: rebeccapurple' }] }),
      )[0]?.code,
    ).toBe('raw_value');
  });

  it('rejects page paths that leave the site or cannot be reached', () => {
    const store = makeStore();
    for (const path of ['//evil.example', '/a/../b', '/a//b', '/./x']) {
      expect(errors(store.apply({ ops: [{ op: 'page.create', path, title: 'X' }] }))[0]?.code).toBe(
        'invalid_op',
      );
    }
    ok(store.apply({ ops: [{ op: 'page.create', path: '/blog/first-post', title: 'Post' }] }));
  });
});

describe('policy', () => {
  it('protects locked nodes from ancestor removal, moves, page removal and variant switches', () => {
    const store = makeStore({ lockedNodes: ['hero-1/heading', 'hero-1/media'] });
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero', variant: { layout: 'split' } },
          { op: 'section.insert', section: 'features' },
          { op: 'page.create', path: '/about', title: 'About' },
        ],
      }),
    );
    expect(
      errors(store.apply({ ops: [{ op: 'node.remove', id: 'hero-1' }] }))[0]?.message,
    ).toContain('contains locked');
    expect(
      errors(store.apply({ ops: [{ op: 'node.move', id: 'hero-1', after: 'features-1' }] }))[0]
        ?.code,
    ).toBe('policy');
    expect(errors(store.apply({ ops: [{ op: 'page.remove', id: 'home' }] }))[0]?.code).toBe(
      'policy',
    );
    expect(
      errors(
        store.apply({
          ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'centered' } }],
        }),
      )[0]?.code,
    ).toBe('policy');
  });

  it('checks locks on the page root for section.insert by page', () => {
    const store = makeStore({ lockedNodes: ['root-home'] });
    expect(
      errors(store.apply({ ops: [{ op: 'section.insert', section: 'hero', page: 'home' }] }))[0]
        ?.code,
    ).toBe('policy');
  });

  it('requires design access for styling smuggled into inserts', () => {
    const store = makeStore({ levels: { agent: 'layout' } });
    ok(
      store.apply({
        actor: agent,
        ops: [{ op: 'section.insert', section: 'hero', content: { heading: { text: 'OK' } } }],
      }),
    );
    expect(
      errors(
        store.apply({
          actor: agent,
          ops: [
            {
              op: 'node.insert',
              parent: 'hero-1/content',
              node: { type: 'text', css: 'display: none' },
            },
          ],
        }),
      )[0]?.code,
    ).toBe('policy');
    expect(
      errors(
        store.apply({
          actor: agent,
          ops: [{ op: 'section.insert', section: 'hero', content: { heading: { tag: 'p' } } }],
        }),
      )[0]?.code,
    ).toBe('policy');
  });
});

describe('robustness', () => {
  it('refuses to nest deeper than MAX_DEPTH instead of throwing', () => {
    const store = makeStore();
    let input: NodeInput = { type: 'box' };
    for (let i = 0; i < MAX_DEPTH + 5; i++) input = { type: 'box', children: [input] };
    const res = store.apply({ ops: [{ op: 'node.insert', parent: 'root-home', node: input }] });
    expect(errors(res)[0]?.message).toContain(`${MAX_DEPTH} levels`);
  });
});

describe('ids are never reused', () => {
  it('gives a new section a new id after the old one was removed', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(store.apply({ ops: [{ op: 'node.remove', id: 'hero-1' }] }));
    ok(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', content: { heading: { text: 'New' } } }],
      }),
    );
    expect(store.doc.nodes['hero-2/heading']?.props.text).toBe('New');
    expect(store.doc.nodes['hero-1']).toBeUndefined();
  });

  it('does not hand out the id of a deleted copy again', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'features' }] }));
    ok(store.apply({ ops: [{ op: 'node.duplicate', id: 'features-1/item-3' }] }));
    ok(store.apply({ ops: [{ op: 'node.remove', id: 'features-1/item-4' }] }));
    const res = ok(store.apply({ ops: [{ op: 'node.duplicate', id: 'features-1/item-3' }] }));
    expect(res.summary.created).toContain('features-1/item-5');
  });

  it('gives sections copied inside a box their own consistent ids', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [{ op: 'node.insert', parent: 'root-home', node: { type: 'box', id: 'wrap' } }],
      }),
    );
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero', parent: 'wrap' }] }));
    const res = ok(store.apply({ ops: [{ op: 'node.duplicate', id: 'wrap' }] }));
    expect(res.summary.created).toEqual(
      expect.arrayContaining(['hero-2', 'hero-2/heading', 'hero-2/content']),
    );
    ok(store.apply({ ops: [{ op: 'props.set', id: 'hero-2/heading', props: { text: 'Copy' } }] }));
    expect(store.doc.nodes['hero-1/heading']?.props.text).toBe('Your headline');
  });
});

describe('undo', () => {
  it('moves past an entry whose changes all conflict instead of getting stuck', () => {
    const store = makeStore();
    ok(store.apply({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        actor: agent,
        ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'A' } }],
      }),
    );
    ok(store.apply({ actor: human, ops: [{ op: 'node.remove', id: 'hero-1/heading' }] }));
    const first = ok(store.undo({ actorId: 'claude' }));
    expect(first.warnings.some((w) => w.code === 'conflict')).toBe(true);
    ok(store.undo({ actorId: 'claude' }));
    expect(store.doc.nodes['hero-1']).toBeUndefined();
  });

  it('merges token undo per token, keeping unrelated later token edits', () => {
    const store = makeStore();
    ok(
      store.apply({
        actor: agent,
        ops: [{ op: 'token.set', path: 'color.accent', value: '#111111' }],
      }),
    );
    ok(
      store.apply({
        actor: human,
        ops: [{ op: 'token.set', path: 'color.surface', value: '#fafafa' }],
      }),
    );
    ok(store.undo({ actorId: 'claude' }));
    const color = store.doc.tokens.color as Record<string, { $value: string }>;
    expect(color.accent?.$value).toBe('#4f46e5');
    expect(color.surface?.$value).toBe('#fafafa');
  });

  it('keeps sibling order keys unique after restoring a position', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        actor: agent,
        ops: [{ op: 'node.move', id: 'hero-1/heading', after: 'hero-1/cta' }],
      }),
    );
    ok(
      store.apply({
        actor: human,
        ops: [
          {
            op: 'node.insert',
            parent: 'hero-1/content',
            before: 'hero-1/subheading',
            node: { type: 'text', id: 'x' },
          },
        ],
      }),
    );
    ok(store.undo({ actorId: 'claude' }));
    expect(uniqueOrders(store, 'hero-1/content')).toBe(true);
    ok(
      store.apply({
        ops: [
          {
            op: 'node.insert',
            parent: 'hero-1/content',
            before: 'x',
            node: { type: 'text', id: 'z' },
          },
        ],
      }),
    );
    const ids = store.view.children('hero-1/content').map((c) => c.id);
    expect(ids.indexOf('z')).toBe(ids.indexOf('x') - 1);
  });
});

describe('tokens', () => {
  it('refuses to remove groups, loops between aliases, and clashing variable names', () => {
    const store = makeStore();
    expect(
      errors(store.apply({ ops: [{ op: 'token.set', path: 'color', value: null }] }))[0]?.code,
    ).toBe('invalid_token');
    ok(store.apply({ ops: [{ op: 'token.set', path: 'color.a', value: '{color.accent}' }] }));
    expect(
      errors(
        store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: '{color.a}' }] }),
      )[0]?.message,
    ).toContain('loop');
    expect(
      errors(store.apply({ ops: [{ op: 'token.set', path: 'color-accent', value: '#000' }] }))[0]
        ?.message,
    ).toContain('same CSS variable');
  });

  it('counts theme overrides as token users', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [{ op: 'token.set', path: 'color.surface', value: '{color.accent}', theme: 'dark' }],
      }),
    );
    expect(
      errors(store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: null }] }))[0]
        ?.message,
    ).toContain('theme "dark"');
  });
});

describe('section.variant merge', () => {
  const promo = defineSection({
    name: 'promo',
    version: 1,
    title: 'Promo',
    description: 'test',
    variants: { layout: ['plain', 'split'] },
    template: ({ variant }) => {
      const content = t.box({ part: 'content' }, [
        t.text({ part: 'heading', tag: variant.layout === 'split' ? 'h1' : 'h3', text: 'Promo' }),
      ]);
      return t.box({ tag: 'section' }, [
        variant.layout === 'split' ? t.box({}, [content]) : content,
      ]);
    },
  });
  const setup = () => {
    const store = createStore({
      registry: createRegistry({ sections: [promo, hero, features] }),
      doc: createEmptyDoc({ tokens }),
      policy: createPolicy(),
    });
    ok(
      store.apply({
        ops: [
          { op: 'page.create', path: '/', title: 'Home' },
          { op: 'section.insert', section: 'promo' },
        ],
      }),
    );
    return store;
  };

  it('never overwrites added nodes with unnamed template nodes or creates cycles', () => {
    const store = setup();
    ok(
      store.apply({
        ops: [{ op: 'node.insert', parent: 'promo-1/content', node: { type: 'box' } }],
      }),
    );
    expect(store.doc.nodes['promo-1/box-1']).toBeDefined();
    ok(
      store.apply({
        ops: [{ op: 'section.variant', id: 'promo-1', variant: { layout: 'split' } }],
      }),
    );
    const all = descendants(store.view, 'promo-1').map((n) => n.id);
    for (const id of all) expect(ancestors(store.view, id).at(-1)?.id).toBe('root-home');
    const wrapper = store.view.children('promo-1')[0]!;
    expect(wrapper.id).not.toBe('promo-1/box-1');
    expect(store.doc.nodes['promo-1/content']?.parent).toBe(wrapper.id);
    expect(store.doc.nodes['promo-1/box-1']?.parent).toBe('promo-1/content');
  });

  it("applies the new variant's defaults but keeps edited values", () => {
    const store = setup();
    ok(store.apply({ ops: [{ op: 'props.set', id: 'promo-1/heading', props: { text: 'Mine' } }] }));
    ok(
      store.apply({
        ops: [{ op: 'section.variant', id: 'promo-1', variant: { layout: 'split' } }],
      }),
    );
    expect(store.doc.nodes['promo-1/heading']?.props).toEqual({ tag: 'h1', text: 'Mine' });
  });

  it('leaves a part that was moved out of the section alone', () => {
    const store = setup();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({
        ops: [{ op: 'node.move', id: 'hero-1/subheading', parent: 'promo-1/content' }],
      }),
    );
    ok(
      store.apply({ ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'split' } }] }),
    );
    expect(store.doc.nodes['hero-1/subheading']?.parent).toBe('promo-1/content');
    expect(Object.keys(store.doc.nodes).some((id) => id.startsWith('hero-1/subheading-'))).toBe(
      false,
    );
  });
});
