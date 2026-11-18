// Regressions for the Phase 2 engine review.
import { createPolicy, normalizeDoc, type PolicyOptions, type Store } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

const sys = { kind: 'system', id: 'setup' } as const;
const ok = (
  store: Store,
  ops: unknown[],
  actor: Parameters<Store['apply']>[0]['actor'] = human,
) => {
  const res = store.apply({ ops, actor });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
  return res;
};
const text = (store: Store, id: string) => store.view.node(id)?.props.text;

/** A hero turned into the "promo-hero" symbol, plus a second instance (hero-2). */
function withSymbol(policy?: PolicyOptions) {
  const store = makeStore(policy);
  ok(store, [{ op: 'section.insert', section: 'hero' }], sys);
  ok(store, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo hero' }], sys);
  ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }], sys);
  return store;
}

describe('agents under review or protection', () => {
  it('can’t undo directly when review is required', () => {
    const store = makeStore({ review: { agent: true } });
    const p = store.propose({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] });
    if (!p.ok) throw new Error('propose');
    expect(store.acceptChangeset(p.changeset.id, { by: human }).ok).toBe(true);
    const res = store.undo({ actorId: agent.id, actor: agent });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe('review_required');
    expect(store.view.node('hero-1')).toBeDefined();
  });

  it('undo that would delete a person’s edits is protected', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'section.insert', section: 'hero' }], agent);
    ok(store, [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Mine' } }]);
    const res = store.undo({ actorId: agent.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe('human_edit');
    expect(text(store, 'hero-1/heading')).toBe('Mine');
  });

  it('dry runs work for agents under review', () => {
    const store = makeStore({ review: { agent: true } });
    const res = store.apply({
      actor: agent,
      dryRun: true,
      ops: [{ op: 'section.insert', section: 'hero' }],
    });
    expect(res.ok).toBe(true);
    expect(store.view.node('hero-1')).toBeUndefined();
  });

  it('a person’s token edits are protected from agents', () => {
    const store = makeStore({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'token.set', path: 'color.accent', value: '#111111' }]);
    const res = store.apply({
      actor: agent,
      ops: [{ op: 'token.set', path: 'color.accent', value: '#222222' }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.message).toMatch(/token color.accent, last changed by ana/);
  });
});

describe('instance sync respects locks and people’s edits', () => {
  it('a definition edit can’t change a locked instance', () => {
    const store = withSymbol({ lockedNodes: ['hero-2'] });
    const edit = store.apply({
      ops: [{ op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'x' } }],
    });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.errors[0]?.message).toMatch(/locked.*linked component/);
    const remove = store.apply({
      ops: [{ op: 'node.remove', id: 'symbol-promo-hero/subheading' }],
    });
    expect(remove.ok).toBe(false);
  });

  it('an agent’s definition change can’t silently drop a person’s instance override', () => {
    const store = withSymbol({ protectHumanEdits: 'confirm' });
    ok(store, [{ op: 'props.set', id: 'hero-2/heading', props: { text: 'Person override' } }]);
    const res = store.apply({
      actor: agent,
      ops: [{ op: 'node.remove', id: 'symbol-promo-hero/heading' }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.nodeId === 'hero-2/heading')).toBe(true);
  });

  it('sync can’t nest an instance past the depth limit', () => {
    const store = withSymbol();
    let parent = 'symbol-promo-hero/content';
    const ops: unknown[] = [];
    for (let i = 0; i < 39; i++) {
      ops.push({
        op: 'node.insert',
        parent,
        node: { type: 'box', id: `symbol-promo-hero/deep-${i}` },
      });
      parent = `symbol-promo-hero/deep-${i}`;
    }
    const res = store.apply({ ops });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.message).toMatch(/levels deep/);
  });

  it('copies made by sync can be addressed in the same transaction', () => {
    const store = withSymbol();
    ok(store, [
      {
        op: 'node.insert',
        parent: 'symbol-promo-hero/content',
        node: { type: 'text', part: 'note', props: { text: 'Def' } },
      },
      { op: 'props.set', id: 'hero-1/note', props: { text: 'Local' } },
    ]);
    expect(text(store, 'hero-1/note')).toBe('Local');
    expect(text(store, 'hero-2/note')).toBe('Def');
  });
});

describe('symbol consistency', () => {
  it('undoing symbol.create unlinks instances added later, which can then be edited', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }], sys);
    ok(store, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo hero' }], agent);
    ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }]);
    expect(store.undo({ actorId: agent.id }).ok).toBe(true);
    expect(store.view.node('hero-2')?.link).toBeUndefined();
    expect(store.apply({ ops: [{ op: 'node.remove', id: 'hero-2/heading' }] }).ok).toBe(true);
    // A new symbol with the same name gets a fresh definition root.
    ok(store, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo hero' }]);
    expect(store.doc.symbols?.['promo-hero']?.rootId).not.toBe('symbol-promo-hero');
  });

  it('undoing a definition edit reaches instances created after it', () => {
    const store = withSymbol();
    ok(
      store,
      [{ op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Agent text' } }],
      agent,
    );
    ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }]);
    expect(text(store, 'hero-3/heading')).toBe('Agent text');
    expect(store.undo({ actorId: agent.id }).ok).toBe(true);
    for (const id of ['hero-1', 'hero-2', 'hero-3'])
      expect(text(store, `${id}/heading`)).toBe('Your headline');
  });

  it('section.variant refuses to rebuild a section that contains an instance', () => {
    const store = withSymbol();
    ok(store, [{ op: 'section.insert', section: 'hero' }], sys);
    ok(store, [{ op: 'node.move', id: 'hero-2', parent: 'hero-3/content' }]);
    const res = store.apply({
      ops: [{ op: 'section.variant', id: 'hero-3', variant: { layout: 'split' } }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe('instance');
  });

  it('duplicating an instance in the same transaction as create keeps following', () => {
    const store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }], sys);
    ok(store, [
      { op: 'symbol.create', id: 'hero-1', name: 'Promo hero' },
      { op: 'node.duplicate', id: 'hero-1' },
      { op: 'props.set', id: 'symbol-promo-hero/heading', props: { text: 'Shared' } },
    ]);
    expect(text(store, 'hero-1/heading')).toBe('Shared');
    expect(text(store, 'hero-2/heading')).toBe('Shared');
  });

  it('symbol.remove honours locks on instances and the definition', () => {
    const locked = withSymbol({ lockedNodes: ['hero-2'] });
    expect(
      locked.apply({ ops: [{ op: 'symbol.remove', symbol: 'promo-hero', instances: 'remove' }] })
        .ok,
    ).toBe(false);
    const def = withSymbol({ lockedNodes: ['symbol-promo-hero'] });
    expect(
      def.apply({ ops: [{ op: 'symbol.remove', symbol: 'promo-hero', instances: 'detach' }] }).ok,
    ).toBe(false);
  });

  it('symbol.insert content only writes inside the new instance, and ids are never reused', () => {
    const store = withSymbol();
    ok(store, [{ op: 'node.remove', id: 'hero-2' }]);
    const reused = store.apply({
      ops: [{ op: 'symbol.insert', symbol: 'promo-hero', id: 'hero-2' }],
    });
    expect(reused.ok).toBe(false);
    ok(store, [
      {
        op: 'symbol.insert',
        symbol: 'promo-hero',
        id: 'promo-3',
        content: { heading: { text: 'Mine' } },
      },
    ]);
    expect(text(store, 'promo-3/heading')).toBe('Mine');
  });

  it('symbol.reset needs design access; reverting a detach needs layout access', () => {
    const store = withSymbol();
    ok(store, [{ op: 'props.set', id: 'hero-2/heading', props: { text: 'x' } }]);
    store.setPolicy(createPolicy({ levels: { agent: 'layout' } }));
    expect(store.apply({ actor: agent, ops: [{ op: 'symbol.reset', id: 'hero-2' }] }).ok).toBe(
      false,
    );
    store.setPolicy(createPolicy());
    const detach = ok(store, [{ op: 'symbol.detach', id: 'hero-2' }]);
    store.setPolicy(createPolicy({ levels: { agent: 'content' } }));
    expect(store.revert(detach.txId!, agent).ok).toBe(false);
  });
});

describe('changeset review', () => {
  it('partial accepts keep later ops pointing at the rebased ids', () => {
    const store = makeStore({ review: { agent: true } });
    const p = store.propose({
      actor: agent,
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'props.set', id: 'hero-1/heading', props: { text: 'Agent headline' } },
      ],
    });
    if (!p.ok) throw new Error('propose');
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
    ok(store, [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Ana headline' } }]);
    expect(store.acceptChangeset(p.changeset.id, { by: human, ops: [0] }).ok).toBe(true);
    expect(store.acceptChangeset(p.changeset.id, { by: human, ops: [1] }).ok).toBe(true);
    expect(text(store, 'hero-1/heading')).toBe('Ana headline');
    expect(text(store, 'hero-2/heading')).toBe('Agent headline');
  });

  it('only id fields are rebased, and dependencies come from id fields', () => {
    const store = makeStore({ review: { agent: true } });
    const p = store.propose({
      actor: agent,
      ops: [
        { op: 'page.create', path: '/features', title: 'Features' },
        { op: 'section.insert', section: 'features', page: 'features' },
        { op: 'section.insert', section: 'features', page: 'home' },
        {
          op: 'section.insert',
          section: 'hero',
          page: 'home',
          content: { heading: { text: 'features' } },
        },
      ],
    });
    if (!p.ok) throw new Error('propose');
    expect(p.changeset.needs).toEqual([[], [0], [], []]);
    ok(store, [{ op: 'page.create', id: 'features', path: '/our-features', title: 'Ours' }]);
    expect(store.acceptChangeset(p.changeset.id, { by: human }).ok).toBe(true);
    expect(text(store, 'hero-1/heading')).toBe('features');
  });

  it('pinned ids that were used and retired meanwhile get fresh ids', () => {
    const store = makeStore({ review: { agent: true } });
    const p = store.propose({ actor: agent, ops: [{ op: 'section.insert', section: 'features' }] });
    if (!p.ok) throw new Error('propose');
    ok(store, [{ op: 'section.insert', section: 'features' }]);
    ok(store, [{ op: 'node.remove', id: 'features-1' }]);
    expect(store.acceptChangeset(p.changeset.id, { by: human }).ok).toBe(true);
    expect(store.view.node('features-1')).toBeUndefined();
    expect(store.view.node('features-2')).toBeDefined();
  });

  it('agents can’t approve, least of all their own proposals', () => {
    const store = makeStore({ review: { agent: true } });
    const p = store.propose({ actor: agent, ops: [{ op: 'section.insert', section: 'hero' }] });
    if (!p.ok) throw new Error('propose');
    const res = store.acceptChangeset(p.changeset.id, { by: agent });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.code === 'review_required')).toBe(true);
  });
});

describe('sync performance', () => {
  it('adding to a definition with many instances stays fast', () => {
    const store = withSymbol();
    for (let i = 0; i < 300; i++) ok(store, [{ op: 'symbol.insert', symbol: 'promo-hero' }], sys);
    const started = performance.now();
    ok(store, [
      {
        op: 'node.insert',
        parent: 'symbol-promo-hero/content',
        node: { type: 'text', props: { text: 'x' } },
      },
    ]);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('stored documents', () => {
  it('normalizeDoc rejects page paths that ops would never allow', () => {
    const store = makeStore();
    const doc = structuredClone(store.doc);
    expect(normalizeDoc(doc)).toBeDefined();
    doc.pages.home!.path = '/x" onfocus="alert(1)';
    expect(normalizeDoc(doc)).toBeUndefined();
  });
});
