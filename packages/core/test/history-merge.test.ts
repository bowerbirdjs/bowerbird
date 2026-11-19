import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createStore, type Store } from '../src/index.js';

const ANA = { kind: 'user' as const, id: 'ana', name: 'Ana' };
const SAM = { kind: 'user' as const, id: 'sam', name: 'Sam' };

function site(): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  store.apply({ ops: [{ op: 'section.insert', page: 'home', section: 'hero' }] });
  return store;
}

const type = (store: Store, text: string, actor = ANA, key = 'hero-1/heading:text') =>
  store.apply({
    actor,
    label: 'Edit heading',
    ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text } }],
    merge: { key },
  });

const heading = (store: Store) => store.doc.nodes['hero-1/heading']!.props.text;

afterEach(() => vi.useRealTimers());

describe('merged transactions', () => {
  test('a burst of typing with one key is one undo step', () => {
    const store = site();
    const before = heading(store);
    const steps = store.history.length;
    for (const text of ['H', 'He', 'Hel', 'Hello']) expect(type(store, text).ok).toBe(true);
    expect(store.history.length).toBe(steps + 1);
    expect(store.history.at(-1)!.label).toBe('Edit heading');
    expect(heading(store)).toBe('Hello');
    expect(store.undo({ actor: ANA }).ok).toBe(true);
    expect(heading(store)).toBe(before);
    expect(store.redo({ actor: ANA }).ok).toBe(true);
    expect(heading(store)).toBe('Hello');
  });

  test('another key, another person or an undo in between starts a new step', () => {
    const store = site();
    const steps = store.history.length;
    type(store, 'A');
    type(store, 'B', ANA, 'other-field');
    type(store, 'C', SAM, 'other-field');
    expect(store.history.length).toBe(steps + 3);
    store.undo({ actor: SAM });
    type(store, 'D', SAM, 'other-field');
    expect(store.history.filter((e) => e.kind === 'edit').length).toBe(steps + 4);
  });

  test('a pause longer than the window starts a new step', () => {
    vi.useFakeTimers();
    const store = site();
    const steps = store.history.length;
    type(store, 'A');
    vi.advanceTimersByTime(1000);
    type(store, 'AB');
    vi.advanceTimersByTime(1600);
    type(store, 'ABC');
    expect(store.history.length).toBe(steps + 2);
    store.undo({ actor: ANA });
    expect(heading(store)).toBe('AB');
  });

  test('records of every transaction in the burst are kept, each from its first state', () => {
    const store = site();
    const before = store.doc.nodes['hero-1/subheading']?.props.text;
    type(store, 'One');
    store.apply({
      actor: ANA,
      ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'Two' } }],
      merge: { key: 'hero-1/heading:text' },
    });
    expect(
      store.history
        .at(-1)!
        .changes.map((c) => c.id)
        .sort(),
    ).toEqual(['hero-1/heading', 'hero-1/subheading']);
    store.undo({ actor: ANA });
    expect(store.doc.nodes['hero-1/subheading']?.props.text).toBe(before);
  });
});
