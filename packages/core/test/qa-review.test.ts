// Regressions from the exploratory QA pass (use cases by host apps and agents).
import {
  createEmptyDoc,
  createRegistry,
  createStore,
  defineSection,
  type Issue,
  type Store,
  t,
} from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { agent, hero, human, makeStore, tokens } from './fixtures.js';

type Actor = Parameters<Store['apply']>[0]['actor'];
const ok = (store: Store, ops: unknown[], actor: Actor = human) => {
  const res = store.apply({ ops, actor });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
  return res;
};
const errors = (res: ReturnType<Store['apply']>): Issue[] => (res.ok ? [] : res.errors);
const warnings = (res: ReturnType<Store['apply']>): Issue[] => (res.ok ? res.warnings : []);

describe('what people write into new nodes is theirs', () => {
  it('content given with a section is protected from agents; template placeholders are not', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [
      { op: 'section.insert', section: 'hero', content: { heading: { text: 'Ana wrote this' } } },
    ]);
    const res = store.apply({
      actor: agent,
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Agent' } }],
    });
    expect(errors(res)[0]).toMatchObject({ code: 'human_edit', nodeId: 'hero-1/heading' });
    // The placeholder subheading came from the template: agents may fill it in.
    ok(store, [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'Agent copy' } }], agent);
    // With warn (the default), the overwrite goes through with a warning.
    const warned = makeStore();
    ok(warned, [
      { op: 'node.insert', parent: 'root-home', node: { type: 'text', props: { text: 'Mine' } } },
    ]);
    const w = warned.apply({
      actor: agent,
      ops: [{ op: 'props.set', id: 'text-1', props: { text: 'Agent' } }],
    });
    expect(warnings(w).map((i) => i.code)).toContain('human_edit');
  });

  it('agents are stopped before removing what a person added, reported once per subtree', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    const res = store.apply({ actor: agent, ops: [{ op: 'node.remove', id: 'hero-1' }] });
    expect(errors(res)).toHaveLength(1);
    expect(errors(res)[0]?.message).toMatch(/Removes "hero-1", which ana \(user\) .* added/);
    // When the person asked for it, the agent can pass overwrite.
    expect(
      store.apply({ actor: agent, ops: [{ op: 'node.remove', id: 'hero-1' }], overwrite: true }).ok,
    ).toBe(true);
  });

  it('placeholders inside what a person added, and instance copies, stay free to change', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    // A template part of the person's section is placeholder: the agent may remove it.
    ok(store, [{ op: 'node.remove', id: 'hero-1/subheading' }], agent);
    // A person's instance follows its definition: removing a definition part removes the
    // instance's copy without a conflict (only overrides would be theirs).
    ok(store, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo' }], agent);
    ok(store, [{ op: 'symbol.insert', symbol: 'promo' }]);
    const res = store.apply({ actor: agent, ops: [{ op: 'node.remove', id: 'symbol-promo/cta' }] });
    expect(res.ok).toBe(true);
    expect(warnings(res).filter((w) => w.code === 'human_edit')).toEqual([]);
    expect(store.view.node('hero-2/cta')).toBeUndefined();
    // Removing the person's instance itself is protected.
    expect(
      errors(store.apply({ actor: agent, ops: [{ op: 'node.remove', id: 'hero-2' }] }))[0]?.message,
    ).toMatch(/Removes "hero-2", which ana \(user\) in revision \d+ added/);
  });

  it('an agent undoing its page.create can’t silently delete a section a person added there', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'page.create', id: 'about', path: '/about', title: 'About' }], agent);
    ok(store, [{ op: 'section.insert', section: 'hero', page: 'about' }]);
    const res = store.undo({ actorId: agent.id, actor: agent });
    expect(errors(res)[0]?.code).toBe('human_edit');
    // The hint points at something the agent can actually do.
    expect(errors(res).at(-1)?.hint).toMatch(/undo with overwrite: true/);
    expect(store.doc.pages.about).toBeDefined();
    expect(store.undo({ actorId: agent.id, actor: agent, overwrite: true }).ok).toBe(true);
    expect(store.doc.pages.about).toBeUndefined();
  });
});

describe('misspelled op fields', () => {
  it('are refused with a suggestion instead of being dropped', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    const local = errors(
      store.apply({
        ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Hallo' }, local: 'de' }],
      }),
    );
    expect(local[0]).toMatchObject({ code: 'invalid_op', path: 'local' });
    expect(local[0]?.message).toMatch(/props.set: has no field "local". Did you mean "locale"\?/);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Your headline');
    const bp = errors(
      store.apply({
        ops: [{ op: 'style.set', id: 'hero-1', css: 'gap: var(--space-md)', breakpoint: 'lg' }],
      }),
    );
    expect(bp[0]?.message).toMatch(/"breakpoint".*Did you mean "bp"\?|has no field "breakpoint"/);
    const node = errors(
      store.apply({
        ops: [{ op: 'node.insert', parent: 'hero-1/content', node: { type: 'text', text: 'Hi' } }],
      }),
    );
    expect(node[0]?.message).toMatch(/"node" has no field "text"/);
    expect(node[0]?.hint).toMatch(/Node fields: type, id, part, key, props/);
  });
});

describe('locks', () => {
  it('a locked page root keeps its page from being removed or renamed', () => {
    const store = makeStore({ lockedNodes: ['root-about'] });
    ok(store, [{ op: 'page.create', id: 'about', path: '/about', title: 'About' }]);
    expect(errors(store.apply({ ops: [{ op: 'page.remove', id: 'about' }] }))[0]?.code).toBe(
      'policy',
    );
    expect(
      errors(store.apply({ ops: [{ op: 'page.update', id: 'about', title: 'Team' }] }))[0]?.code,
    ).toBe('policy');
    expect(store.doc.pages.about?.title).toBe('About');
  });
});

describe('explicit ids', () => {
  it('never reuse a retired id (undo would otherwise rebuild a broken tree)', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    ok(store, [{ op: 'node.remove', id: 'hero-1' }]);
    const res = store.apply({
      actor: agent,
      ops: [{ op: 'section.insert', section: 'features', id: 'hero-1' }],
    });
    expect(errors(res)[0]).toMatchObject({ code: 'duplicate_id', nodeId: 'hero-1' });
    expect(errors(res)[0]?.message).toMatch(/was used before/);
    const node = store.apply({
      ops: [{ op: 'node.insert', parent: 'root-home', node: { type: 'box', id: 'hero-1' } }],
    });
    expect(errors(node)[0]?.code).toBe('duplicate_id');
    // "-0" ids are never generated, so they are free to use.
    ok(store, [{ op: 'node.insert', parent: 'root-home', node: { type: 'box', id: 'box-0' } }]);
  });

  it('can’t take a section part’s place outside the section', () => {
    const store = makeStore();
    const res = store.apply({
      ops: [
        { op: 'node.insert', parent: 'root-home', node: { type: 'text', id: 'hero-1/heading' } },
      ],
    });
    expect(errors(res)[0]).toMatchObject({ code: 'invalid_id', nodeId: 'hero-1/heading' });
    // Inside the section, scoped and plain explicit ids are fine.
    ok(store, [
      { op: 'section.insert', section: 'hero', content: { heading: { text: 'Mine' } } },
      { op: 'node.insert', parent: 'hero-1/content', node: { type: 'text', id: 'hero-1/note' } },
      { op: 'node.insert', parent: 'hero-1/content', node: { type: 'text', id: 'note' } },
    ]);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Mine');
  });

  it('generated section ids skip scopes that stray nodes already use', () => {
    // A document from before scoped ids were enforced, with a stray "hero-1/heading".
    const store = makeStore();
    const doc = structuredClone(store.doc);
    doc.nodes['hero-1/heading'] = {
      id: 'hero-1/heading',
      type: 'text',
      parent: 'root-home',
      order: 'a0',
      props: { text: 'Stray' },
    };
    store.load(doc);
    ok(store, [{ op: 'section.insert', section: 'hero', content: { heading: { text: 'Fresh' } } }]);
    expect(store.view.node('hero-2/heading')?.props.text).toBe('Fresh');
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Stray');
  });
});

describe('tokens and themes', () => {
  it('theme values can’t form alias loops, alone or with base values', () => {
    const store = makeStore();
    ok(store, [{ op: 'token.set', path: 'color.text', value: '#111111' }]);
    ok(store, [{ op: 'token.set', path: 'color.surface', theme: 'dark', value: '{color.text}' }]);
    const loop = errors(
      store.apply({
        ops: [{ op: 'token.set', path: 'color.text', theme: 'dark', value: '{color.surface}' }],
      }),
    );
    expect(loop[0]?.message).toMatch(/In theme "dark", token aliases would form a loop/);
    // A base value can close a loop that only exists under a theme.
    const base = errors(
      store.apply({ ops: [{ op: 'token.set', path: 'color.text', value: '{color.surface}' }] }),
    );
    expect(base[0]?.message).toMatch(/In theme "dark", token aliases would form a loop/);
  });

  it('a token referring to itself gets a clear message', () => {
    const store = makeStore();
    const res = errors(
      store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: '{color.accent}' }] }),
    );
    expect(res[0]?.message).toBe('"color.accent" can\'t refer to itself ({color.accent}).');
  });

  it('undo restores who set a token, so agents aren’t blocked by an undone edit', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'token.set', path: 'color.accent', value: '#111111' }]);
    expect(store.doc.tokenEdits?.['token:color.accent']?.by).toBe('ana');
    ok(store, [{ op: 'token.set', path: 'color.surface', value: '#fafafa' }], agent);
    expect(store.undo({ actorId: 'ana' }).ok).toBe(true);
    expect(store.doc.tokenEdits?.['token:color.accent']).toBeUndefined();
    // The agent's own token edit keeps its stamp.
    expect(store.doc.tokenEdits?.['token:color.surface']?.by).toBe('claude');
    ok(store, [{ op: 'token.set', path: 'color.accent', value: '#222222' }], agent);
    // Redo brings ana's value and stamp back (the agent's later value conflicts and stays).
    const redo = store.redo({ actorId: 'ana' });
    expect(redo.ok).toBe(true);
    expect(store.doc.tokenEdits?.['token:color.accent']?.by).toBe('claude');
  });
});

describe('languages', () => {
  it('codes that differ only in case are one language', () => {
    const store = makeStore();
    const res = errors(store.apply({ ops: [{ op: 'locale.set', add: ['pt-BR', 'pt-br'] }] }));
    expect(res[0]?.message).toMatch(/"pt-BR" is the same language as "pt-br"/);
    ok(store, [{ op: 'locale.set', add: ['pt-BR'] }]);
    expect(errors(store.apply({ ops: [{ op: 'locale.set', add: ['pt-br'] }] }))[0]?.hint).toBe(
      'Use "pt-BR".',
    );
  });
});

describe('robustness', () => {
  it('a host section whose template throws gives an error, not an exception', () => {
    const broken = defineSection({
      name: 'broken',
      version: 1,
      title: 'Broken',
      description: 'Throws for one variant.',
      variants: { mode: ['ok', 'bad'] },
      template: ({ variant }) => {
        if (variant.mode === 'bad') throw new Error('no such layout');
        return t.box({ tag: 'section' }, [t.text({ part: 'heading', text: 'Hi' })]);
      },
    });
    const store = createStore({
      registry: createRegistry({ sections: [hero, broken] }),
      doc: createEmptyDoc({ tokens }),
    });
    ok(store, [{ op: 'page.create', path: '/', title: 'Home' }]);
    const res = store.apply({
      ops: [
        {
          op: 'section.insert',
          section: 'broken',
          variant: { mode: 'bad' },
          content: { heading: { text: 'x' } },
        },
      ],
    });
    expect(errors(res)[0]?.message).toMatch(/failed to build: Error: no such layout/);
  });

  it('a lock that stops instance sync says so (nothing is being reverted)', () => {
    const store = makeStore({ lockedNodes: ['hero-2/heading'] });
    ok(store, [
      { op: 'section.insert', section: 'hero' },
      { op: 'symbol.create', id: 'hero-1', name: 'Promo' },
      { op: 'symbol.insert', symbol: 'promo' },
    ]);
    const res = errors(
      store.apply({
        ops: [{ op: 'props.set', id: 'symbol-promo/heading', props: { text: 'New' } }],
      }),
    );
    expect(res[0]?.message).toMatch(
      /is locked, so this linked component instance can't be updated/,
    );
    expect(res[0]?.message).not.toMatch(/reverted/);
  });
});

describe('people-facing messages and checks', () => {
  it('misspelled CSS properties are refused with a suggestion; newer ones pass', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    const typo = errors(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'colr: var(--color-accent)' }] }),
    );
    expect(typo[0]).toMatchObject({ code: 'invalid_style', path: 'colr', nodeId: 'hero-1' });
    expect(typo[0]?.message).toBe('"colr" is not a CSS property. Did you mean "color"?');
    expect(
      errors(
        store.apply({
          ops: [
            {
              op: 'node.insert',
              parent: 'hero-1/content',
              node: { type: 'box', css: 'background-colour: var(--color-surface)' },
            },
          ],
        }),
      )[0]?.message,
    ).toMatch(/Did you mean "background-color"/);
    // Unknown names with no close match (new or experimental properties) and prefixes still work.
    ok(store, [
      { op: 'style.set', id: 'hero-1', css: 'reading-flow: normal; -webkit-line-clamp: 2' },
    ]);
  });

  it('page titles can’t be emptied (an empty translation falls back to the default)', () => {
    const store = makeStore();
    expect(
      errors(store.apply({ ops: [{ op: 'page.create', path: '/a', title: ' ' }] }))[0]?.message,
    ).toBe("A page title can't be empty.");
    expect(
      errors(store.apply({ ops: [{ op: 'page.update', id: 'home', title: '' }] }))[0]?.code,
    ).toBe('invalid_op');
    ok(store, [
      { op: 'locale.set', add: ['de'] },
      { op: 'page.update', id: 'home', locale: 'de', title: 'Start' },
      { op: 'page.update', id: 'home', locale: 'de', title: '' },
    ]);
    expect(store.doc.pages.home?.l10n).toBeUndefined();
  });

  it('refusals say what the change is in words, and keep the op name for agents', () => {
    const store = makeStore({ actors: { ana: 'content' } });
    const res = errors(
      store.apply({
        actor: human,
        ops: [{ op: 'token.set', path: 'color.accent', value: '#000000' }],
      }),
    );
    expect(res[0]?.message).toBe(
      'user "ana" may make content changes, but changing design tokens (brand colours, spacing, fonts) (token.set) needs design access.',
    );
  });
});

describe('review and pages', () => {
  it('actors under review can withdraw their own proposals but not reject others’', () => {
    const store = makeStore({ review: { agent: true } });
    const other = { kind: 'agent', id: 'other-bot' } as const;
    const p = store.propose({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] });
    if (!p.ok) throw new Error('propose');
    const refused = store.rejectChangeset(p.changeset.id, { by: other });
    expect(refused.ok).toBe(false);
    expect(refused.errors[0]?.code).toBe('review_required');
    expect(store.rejectChangeset(p.changeset.id, { by: agent }).rejected).toEqual([0]);
  });

  it('a style that uses a token created in the same proposal depends on it', () => {
    const store = makeStore({ review: { agent: true } });
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    const p = store.propose({
      actor: agent,
      ops: [
        { op: 'token.set', path: 'color.highlight', value: '#fde68a' },
        { op: 'style.set', id: 'hero-1', css: 'background: var(--color-highlight)' },
        { op: 'style.set', id: 'hero-1/heading', css: 'color: var(--color-accent)' },
      ],
    });
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    expect(p.changeset.needs).toEqual([[], [0], []]);
    expect(store.rejectChangeset(p.changeset.id, { by: human, ops: [0] }).rejected).toEqual([0, 1]);
    expect(store.acceptChangeset(p.changeset.id, { by: human }).ok).toBe(true);
  });

  it('page paths that differ only in case are one page', () => {
    const store = makeStore();
    ok(store, [{ op: 'page.create', id: 'about', path: '/about', title: 'About' }]);
    const res = errors(
      store.apply({ ops: [{ op: 'page.create', id: 'about-2', path: '/About/', title: 'About' }] }),
    );
    expect(res[0]?.message).toBe(
      'Page "about" already uses "/about", the same URL once letter case is ignored (as exported folders are on macOS and Windows) as "/About/".',
    );
  });
});

describe('links', () => {
  it('can’t contain links or buttons, directly or deeper down', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    const direct = errors(
      store.apply({
        ops: [{ op: 'node.insert', parent: 'hero-1/cta', node: { type: 'button', props: {} } }],
      }),
    );
    expect(direct[0]?.message).toBe('"hero-1/cta" (link) can\'t contain a button.');
    ok(store, [{ op: 'node.insert', parent: 'hero-1/cta', node: { type: 'box' } }]);
    const deep = errors(
      store.apply({
        ops: [{ op: 'node.insert', parent: 'hero-1/box-1', node: { type: 'link', props: {} } }],
      }),
    );
    expect(deep[0]?.message).toMatch(
      /can't be inside link "hero-1\/cta": links can't contain links, buttons or form parts/,
    );
    // Moving a link into a link is refused the same way; images and text are fine.
    expect(
      errors(
        store.apply({ ops: [{ op: 'node.move', id: 'hero-1/box-1', parent: 'hero-1/content' }] }),
      ),
    ).toEqual([]);
    ok(store, [
      {
        op: 'node.insert',
        parent: 'hero-1/cta',
        node: { type: 'image', props: { src: '/a.png', alt: '' } },
      },
    ]);
  });
});
