import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, descendants } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

const setup = () => {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'features' },
    ],
  });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return store;
};

describe('variant switches on real sections', () => {
  it('keeps content people added inside dropped parts through undo and redo', () => {
    const store = setup();
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'features-1/item-6',
          node: { type: 'text', id: 'note', props: { text: 'Mine' } },
        },
      ],
    });
    const sw = store.apply({
      ops: [{ op: 'section.variant', id: 'features-1', variant: { columns: '2' } }],
    });
    expect(sw.ok).toBe(true);
    expect(store.doc.nodes.note?.parent).toBe('features-1/grid');
    expect(store.doc.nodes['features-1/item-6']).toBeUndefined();
    expect(store.undo().ok).toBe(true);
    expect(store.doc.nodes.note?.parent).toBe('features-1/item-6');
    expect(store.redo().ok).toBe(true);
    expect(store.doc.nodes.note?.props.text).toBe('Mine');
    expect(store.doc.nodes.note?.parent).toBe('features-1/grid');
  });

  it('gives every sibling a unique, template-ordered position', () => {
    const store = setup();
    store.apply({ ops: [{ op: 'section.variant', id: 'features-1', variant: { columns: '2' } }] });
    store.apply({
      ops: [{ op: 'node.insert', parent: 'features-1/grid', node: { type: 'box', id: 'card' } }],
    });
    store.apply({ ops: [{ op: 'section.variant', id: 'features-1', variant: { columns: '3' } }] });
    const ids = store.view.children('features-1/grid').map((c) => c.id);
    const orders = store.view.children('features-1/grid').map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(ids.slice(0, 4)).toEqual([
      'features-1/item-1',
      'features-1/item-2',
      'features-1/item-3',
      'features-1/item-4',
    ]);
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'features-1/grid',
          before: 'features-1/item-5',
          node: { type: 'box', id: 'z' },
        },
      ],
    });
    const after = store.view.children('features-1/grid').map((c) => c.id);
    expect(after.indexOf('z')).toBe(after.indexOf('features-1/item-5') - 1);
    expect(descendants(store.view, 'features-1').length).toBeGreaterThan(10);
  });
});
