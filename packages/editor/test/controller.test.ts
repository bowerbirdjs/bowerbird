import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createPolicy, createStore, type Store } from '@bowerbirdjs/core';
import { beforeEach, describe, expect, test } from 'vitest';
// DOM-free modules only: the Lit element and canvas need a browser (see e2e/).
import { EditorController, type EditorEvent } from '../src/controller.js';
import { performDrop } from '../src/dnd.js';
import { fieldsFor } from '../src/schema-form.js';

const SAM = { kind: 'user' as const, id: 'sam', name: 'Sam' };
const BOT = { kind: 'agent' as const, id: 'bot', name: 'Bot' };

function setup() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({
    actor: { kind: 'system', id: 'test' },
    ops: [{ op: 'page.create', path: '/', title: 'Home' }],
  });
  const controller = new EditorController(store, { actor: SAM });
  const events: EditorEvent[] = [];
  controller.on((e) => events.push(e));
  return { store, controller, events };
}

const sections = (store: Store, c: EditorController) =>
  store.view.children(c.currentPage?.rootId ?? '').map((n) => n.id);

describe('EditorController', () => {
  let store: Store;
  let c: EditorController;
  let events: EditorEvent[];
  beforeEach(() => {
    ({ store, controller: c, events } = setup());
  });

  test('inserts sections after the selected one and selects them', () => {
    c.insertSection('hero');
    c.insertSection('cta');
    expect(c.selected).toBe('cta-1');
    c.select('hero-1/heading');
    c.insertSection('features');
    expect(sections(store, c)).toEqual(['hero-1', 'features-1', 'cta-1']);
    expect(store.history.at(-1)?.actor.id).toBe('sam');
  });

  test('the page root cannot be selected', () => {
    c.select(c.currentPage?.rootId ?? null);
    expect(c.selected).toBeNull();
  });

  test('inserts a node into the selected container or next to the selected node', () => {
    c.insertSection('hero');
    c.select('hero-1/heading');
    const pos = c.defaultNodePosition('text');
    expect(pos).toMatchObject({ after: 'hero-1/heading' });
    const result = c.insertNode({ type: 'text', props: { text: 'Hi', tag: 'p' } });
    expect(result?.ok).toBe(true);
    const created = c.selectedNode;
    expect(created?.parent).toBe(pos?.parent);
    expect(
      store.view
        .children(pos?.parent ?? '')
        .map((n) => n.id)
        .indexOf(created?.id ?? ''),
    ).toBe(store.view.children(pos?.parent ?? '').findIndex((n) => n.id === 'hero-1/heading') + 1);
  });

  test('insertNode without a target reports an error event instead of throwing', () => {
    expect(c.insertNode({ type: 'text', props: { text: 'x' } })).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  test('nudge, duplicate and delete keep a sensible selection', () => {
    c.insertSection('hero');
    c.insertSection('cta');
    c.select('cta-1');
    c.nudge(-1);
    expect(sections(store, c)).toEqual(['cta-1', 'hero-1']);
    c.duplicateSelected();
    expect(sections(store, c)).toEqual(['cta-1', 'cta-2', 'hero-1']);
    expect(c.selected).toBe('cta-2');
    c.select('hero-1/heading');
    const parent = store.view.node('hero-1/heading')?.parent;
    c.removeSelected();
    expect(store.view.node('hero-1/heading')).toBeUndefined();
    expect(c.selected).toBe(parent);
  });

  test('undo only undoes the editor actor’s changes', () => {
    c.insertSection('hero');
    store.apply({
      actor: BOT,
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'From the bot' } }],
    });
    c.setProps('hero-1/subheading', { text: 'From Sam' });
    expect(c.undo().ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('From the bot');
    expect(store.view.node('hero-1/subheading')?.props.text).not.toBe('From Sam');
    expect(c.redo().ok).toBe(true);
    expect(store.view.node('hero-1/subheading')?.props.text).toBe('From Sam');
  });

  test('nothing to undo is silent; refused changes emit error events', () => {
    c.undo();
    expect(events.some((e) => e.type === 'error')).toBe(false);
    store.setPolicy(createPolicy({ levels: { user: 'content' } }));
    const result = c.insertSection('hero');
    expect(result?.ok).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', label: 'Add hero section' });
  });

  test('styles go to the active breakpoint and state', () => {
    c.insertSection('hero');
    c.setBreakpoint('base');
    expect(
      c.setStyle('hero-1/heading', 'color: var(--color-brand-600)', { state: 'hover' }).ok,
    ).toBe(true);
    expect(store.view.node('hero-1/heading')?.styles?.base?.hover?.color).toBe(
      'var(--color-brand-600)',
    );
    expect(c.setStyle('hero-1/heading', '', { state: 'hover', remove: ['color'] }).ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.styles?.base?.hover?.color).toBeUndefined();
  });

  test('preview widths follow the breakpoints', () => {
    c.setBreakpoint('base');
    expect(c.previewWidth()).toBe(390);
    c.setBreakpoint('lg');
    expect(c.previewWidth()).toBe(1280);
    c.setBreakpoint('nope');
    expect(c.breakpoint).toBe('lg');
  });

  test('selection clears when the selected node is removed by someone else', () => {
    c.insertSection('hero');
    c.select('hero-1/heading');
    store.apply({ actor: BOT, ops: [{ op: 'node.remove', id: 'hero-1' }] });
    expect(c.selected).toBeNull();
  });

  test('setStore resets view state and listens to the new store', () => {
    c.insertSection('hero');
    const next = setup().store;
    c.setStore(next);
    expect(c.selected).toBeNull();
    expect(events.at(-1)).toMatchObject({ type: 'store' });
    const before = events.length;
    next.apply({ actor: BOT, ops: [{ op: 'section.insert', section: 'cta', page: c.page }] });
    expect(events.length).toBe(before + 1);
    store.apply({ actor: BOT, ops: [{ op: 'section.insert', section: 'cta', page: c.page }] });
    expect(events.length).toBe(before + 1);
  });
});

describe('performDrop', () => {
  test('section, node and move drops are single transactions', () => {
    const { store, controller: c } = setup();
    const root = c.currentPage?.rootId ?? '';
    performDrop(c, { kind: 'section', name: 'hero' }, { parent: root });
    performDrop(
      c,
      { kind: 'section', name: 'cta', variant: { tone: 'dark' } },
      { parent: root, before: 'hero-1' },
    );
    expect(sections(store, c)).toEqual(['cta-1', 'hero-1']);
    expect(store.view.node('cta-1')?.section?.variant).toMatchObject({ tone: 'dark' });

    const container = store.view.node('hero-1/heading')?.parent ?? '';
    const revision = store.doc.revision;
    performDrop(
      c,
      { kind: 'node', input: { type: 'text', props: { text: 'Dropped' } } },
      { parent: container, before: 'hero-1/heading' },
    );
    expect(store.doc.revision).toBe(revision + 1);
    const texts = store.view.children(container).map((n) => n.props.text);
    expect(texts.indexOf('Dropped')).toBe(
      texts.indexOf(store.view.node('hero-1/heading')?.props.text) - 1,
    );

    performDrop(c, { kind: 'move', id: 'hero-1' }, { parent: root, before: 'cta-1' });
    expect(sections(store, c)).toEqual(['hero-1', 'cta-1']);
    expect(c.selected).toBe('hero-1');
  });
});

describe('fieldsFor', () => {
  test('derives form fields from component schemas', () => {
    const registry = createDefaultRegistry();
    const link = fieldsFor(registry.component('link')!);
    expect(link.find((f) => f.key === 'href')).toMatchObject({ kind: 'url', label: 'Link' });
    const text = fieldsFor(registry.component('text')!);
    expect(text.find((f) => f.key === 'tag')).toMatchObject({ kind: 'select' });
    expect(text.find((f) => f.key === 'tag')?.options).toContain('h1');
  });
});
