import { instancesOf, overridesOf, type Store } from '@bowerbirdjs/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

const sys = { kind: 'system', id: 'setup' } as const;

function ok(store: Store, ops: unknown[], actor: Parameters<Store['apply']>[0]['actor'] = human) {
  const res = store.apply({ ops, actor });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 2));
  return res;
}

const text = (store: Store, id: string) => store.view.node(id)?.props.text;

describe('symbols', () => {
  let store: Store;
  beforeEach(() => {
    store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }], sys);
    ok(store, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo hero' }]);
  });

  it('creates a definition outside the page and links the original as the first instance', () => {
    const symbol = store.doc.symbols?.['promo-hero'];
    expect(symbol).toMatchObject({ name: 'Promo hero', rootId: 'symbol-promo-hero' });
    const def = store.view.node('symbol-promo-hero');
    expect(def).toMatchObject({ parent: null, symbol: 'promo-hero', section: { name: 'hero' } });
    expect(store.view.node('symbol-promo-hero/heading')?.props.text).toBe('Your headline');
    expect(store.view.node('hero-1')?.link).toEqual({
      symbol: 'promo-hero',
      node: 'symbol-promo-hero',
    });
    expect(store.view.node('hero-1/heading')?.link?.node).toBe('symbol-promo-hero/heading');
    // The definition is not on any page.
    const pageIds = store.view.children(store.doc.pages.home!.rootId).map((n) => n.id);
    expect(pageIds).toEqual(['hero-1']);
  });

  it('inserts instances with scoped ids and content overrides', () => {
    ok(store, [
      { op: 'symbol.insert', symbol: 'promo-hero', content: { heading: { text: 'Second' } } },
    ]);
    expect(store.view.node('hero-2')?.link?.node).toBe('symbol-promo-hero');
    expect(text(store, 'hero-2/heading')).toBe('Second');
    expect(overridesOf(store.view, store.view.node('hero-2/heading')!)).toEqual(['props.text']);
    expect(
      instancesOf(store.view, 'promo-hero')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['hero-1', 'hero-2']);
  });

  it('definition edits reach instances, except overridden fields', () => {
    ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }]);
    ok(store, [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Local' } }]);
    ok(store, [
      { op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Shared' } },
      { op: 'props.set', id: 'symbol-promo-hero/subheading', props: { text: 'Sub' } },
      { op: 'style.set', id: 'symbol-promo-hero/heading', css: 'color: var(--color-accent)' },
    ]);
    expect(text(store, 'hero-1/heading')).toBe('Local');
    expect(text(store, 'hero-2/heading')).toBe('Shared');
    expect(text(store, 'hero-1/subheading')).toBe('Sub');
    expect(store.view.node('hero-1/heading')?.styles).toEqual(
      store.view.node('symbol-promo-hero/heading')?.styles,
    );
  });

  it('definition edits in the same transaction as create/insert still reach instances', () => {
    ok(store, [
      { op: 'symbol.insert', symbol: 'promo-hero', content: { subheading: { text: 'Own' } } },
      { op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Same tx' } },
      { op: 'props.set', id: 'symbol-promo-hero/subheading', props: { text: 'Def sub' } },
    ]);
    expect(text(store, 'hero-1/heading')).toBe('Same tx');
    expect(text(store, 'hero-2/heading')).toBe('Same tx');
    expect(text(store, 'hero-2/subheading')).toBe('Own');
    expect(text(store, 'hero-1/subheading')).toBe('Def sub');
    const fresh = makeStore();
    ok(fresh, [
      { op: 'section.insert', section: 'hero' },
      { op: 'symbol.create', id: 'hero-1', name: 'Fresh' },
      { op: 'props.set', id: 'symbol-fresh/heading', props: { text: 'Edited at once' } },
    ]);
    expect(text(fresh, 'hero-1/heading')).toBe('Edited at once');
  });

  it('structure changes in the definition are mirrored; instance structure is locked', () => {
    ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }]);
    ok(store, [
      {
        op: 'node.insert',
        parent: 'symbol-promo-hero/content',
        node: { type: 'text', part: 'note', props: { text: 'New' } },
      },
      { op: 'node.remove', id: 'symbol-promo-hero/cta' },
      { op: 'node.move', id: 'symbol-promo-hero/subheading', before: 'symbol-promo-hero/heading' },
    ]);
    for (const root of ['hero-1', 'hero-2']) {
      const kids = store.view.children(`${root}/content`).map((n) => n.id);
      expect(kids).toEqual([`${root}/subheading`, `${root}/heading`, `${root}/note`]);
      expect(store.view.node(`${root}/note`)?.link?.node).toBe('symbol-promo-hero/note');
    }
    for (const op of [
      { op: 'node.remove', id: 'hero-1/heading' },
      { op: 'node.insert', parent: 'hero-1/content', node: { type: 'text', props: { text: 'x' } } },
      { op: 'node.move', id: 'hero-1/heading', before: 'hero-1/subheading' },
      { op: 'node.duplicate', id: 'hero-1/heading' },
      { op: 'section.variant', id: 'hero-1', variant: { layout: 'split' } },
    ]) {
      const res = store.apply({ ops: [op] });
      expect(res.ok, op.op).toBe(false);
      if (!res.ok) expect(res.errors[0]?.code).toBe('instance');
    }
  });

  it('variant changes on the definition re-expand every instance', () => {
    ok(store, [{ op: 'section.variant', id: 'symbol-promo-hero', variant: { layout: 'split' } }]);
    expect(store.view.node('hero-1')?.section?.variant).toEqual({ layout: 'split' });
    expect(store.view.node('hero-1/media')?.link?.node).toBe('symbol-promo-hero/media');
  });

  it('duplicating, moving and removing a whole instance works', () => {
    ok(store, [{ op: 'node.duplicate', id: 'hero-1' }]);
    expect(store.view.node('hero-2')?.link?.symbol).toBe('promo-hero');
    expect(store.view.node('hero-2/heading')?.link?.node).toBe('symbol-promo-hero/heading');
    ok(store, [{ op: 'node.remove', id: 'hero-2' }]);
    expect(instancesOf(store.view, 'promo-hero')).toHaveLength(1);
  });

  it('detach, reset, update and remove', () => {
    ok(store, [
      { op: 'symbol.insert', symbol: 'promo-hero', content: { heading: { text: 'Mine' } } },
    ]);
    ok(store, [{ op: 'symbol.reset', id: 'hero-2' }]);
    expect(text(store, 'hero-2/heading')).toBe('Your headline');
    ok(store, [{ op: 'symbol.detach', id: 'hero-2' }]);
    expect(store.view.node('hero-2/heading')?.link).toBeUndefined();
    ok(store, [{ op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Shared' } }]);
    expect(text(store, 'hero-2/heading')).toBe('Your headline');
    ok(store, [{ op: 'symbol.update', symbol: 'promo-hero', name: 'Hero (shared)' }]);
    expect(store.doc.symbols?.['promo-hero']?.name).toBe('Hero (shared)');

    const refused = store.apply({ ops: [{ op: 'symbol.remove', symbol: 'promo-hero' }] });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]?.hint).toMatch(/detach/);
    ok(store, [{ op: 'symbol.remove', symbol: 'promo-hero', instances: 'detach' }]);
    expect(store.doc.symbols).toBeUndefined();
    expect(store.view.node('symbol-promo-hero')).toBeUndefined();
    expect(text(store, 'hero-1/heading')).toBe('Shared');
    expect(store.view.node('hero-1')?.link).toBeUndefined();
  });

  it('undo reverts a definition edit and its effect on instances in one step', () => {
    ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }]);
    ok(
      store,
      [{ op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Shared' } }],
      agent,
    );
    expect(store.undo({ actorId: agent.id }).ok).toBe(true);
    expect(text(store, 'hero-1/heading')).toBe('Your headline');
    expect(text(store, 'hero-2/heading')).toBe('Your headline');
    // Undoing the symbol itself unlinks the original and removes the definition.
    const created = store.history.find(
      (e) => e.label === undefined && e.changes.some((c) => c.kind === 'symbol'),
    );
    expect(created).toBeDefined();
    expect(store.revert(created!.txId).ok).toBe(true);
    expect(store.doc.symbols?.['promo-hero']).toBeUndefined();
    expect(store.view.node('hero-1')?.link).toBeUndefined();
  });

  it('rejects nesting and bad references with actionable errors', () => {
    const nested = store.apply({
      ops: [{ op: 'symbol.insert', symbol: 'promo-hero', parent: 'symbol-promo-hero/content' }],
    });
    expect(nested.ok).toBe(false);
    const again = store.apply({ ops: [{ op: 'symbol.create', id: 'hero-1/heading', name: 'x' }] });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0]?.code).toBe('instance');
    const typo = store.apply({ ops: [{ op: 'symbol.insert', symbol: 'promo-heroo' }] });
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.errors[0]?.message).toMatch(/Did you mean "promo-hero"/);
    const out = store.apply({
      ops: [
        { op: 'node.move', id: 'symbol-promo-hero/heading', parent: store.doc.pages.home!.rootId },
      ],
    });
    expect(out.ok).toBe(false);
  });

  it('a content-level actor may insert instances but not create symbols', () => {
    store.setPolicy(
      (() => {
        const p = makeStore({ levels: { user: 'layout' } }).policy;
        return p;
      })(),
    );
    expect(store.apply({ ops: [{ op: 'symbol.insert', symbol: 'promo-hero' }] }).ok).toBe(true);
    expect(store.apply({ ops: [{ op: 'symbol.create', id: 'hero-2', name: 'x' }] }).ok).toBe(false);
  });
});
