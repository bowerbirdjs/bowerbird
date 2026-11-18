import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createPolicy, createStore } from '@bowerbirdjs/core';
import { describe, expect, test } from 'vitest';
// DOM-free modules only: the Lit element and canvas need a browser (see e2e/).
import { EditorController } from '../src/controller.js';

const SAM = { kind: 'user' as const, id: 'sam', name: 'Sam' };
const BOT = { kind: 'agent' as const, id: 'bot', name: 'Bot' };

function setup() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({
    actor: { kind: 'system', id: 'test' },
    ops: [{ op: 'page.create', path: '/', title: 'Home' }],
  });
  return { store, c: new EditorController(store, { actor: SAM }) };
}

describe('undo and redo availability', () => {
  test('a changeset the person accepted can be undone (button state matches Ctrl+Z)', () => {
    const { store, c } = setup();
    store.setPolicy(createPolicy({ review: { agent: true } }));
    const proposed = store.propose({
      actor: BOT,
      ops: [{ op: 'section.insert', section: 'hero', page: c.page }],
    });
    expect(proposed.ok).toBe(true);
    expect(c.canUndo()).toBe(false);
    if (!proposed.ok) return;
    expect(c.acceptChangeset(proposed.changeset.id).ok).toBe(true);
    expect(c.canUndo()).toBe(true);
    expect(c.undo()?.ok).toBe(true);
    expect(store.view.node('hero-1')).toBeUndefined();
    expect(c.canUndo()).toBe(false);
    expect(c.canRedo()).toBe(true);
    expect(c.redo()?.ok).toBe(true);
    expect(store.view.node('hero-1')).toBeDefined();
  });

  test('other people’s changes are not offered as this person’s undo', () => {
    const { store, c } = setup();
    store.apply({ actor: BOT, ops: [{ op: 'section.insert', section: 'hero', page: c.page }] });
    expect(c.canUndo()).toBe(false);
    c.insertSection('cta');
    expect(c.canUndo()).toBe(true);
    c.undo();
    expect(c.canUndo()).toBe(false);
    expect(c.canRedo()).toBe(true);
    c.insertSection('cta');
    expect(c.canRedo()).toBe(false);
  });
});

describe('page settings in another language', () => {
  test('title and description are written as translations; the path stays shared', () => {
    const { store, c } = setup();
    store.apply({ ops: [{ op: 'locale.set', add: ['de'] }] });
    c.setLocale('de');
    expect(c.updatePage(c.page, { title: 'Startseite', description: 'Willkommen' }).ok).toBe(true);
    const page = store.doc.pages[c.page]!;
    expect(page.title).toBe('Home');
    expect(page.l10n?.de).toEqual({ title: 'Startseite', description: 'Willkommen' });
    expect(c.updatePage(c.page, { path: '/start' }).ok).toBe(true);
    expect(store.doc.pages[c.page]!.path).toBe('/start');
    // Clearing the field drops the translation (the default shows again).
    c.updatePage(c.page, { title: '' });
    expect(store.doc.pages[c.page]!.l10n?.de).toEqual({ description: 'Willkommen' });
    c.setLocale(null);
    c.updatePage(c.page, { title: 'Welcome' });
    expect(store.doc.pages[c.page]!.title).toBe('Welcome');
  });
});

describe('style declarations', () => {
  test('clearing a value removes the declaration instead of failing', () => {
    const { store, c } = setup();
    c.insertSection('hero');
    expect(c.setDeclaration('hero-1/heading', 'color', 'var(--color-accent)').ok).toBe(true);
    const bp = c.breakpoint;
    expect(store.view.node('hero-1/heading')?.styles?.[bp]?.default?.color).toBe(
      'var(--color-accent)',
    );
    const result = c.setDeclaration('hero-1/heading', 'color', '  ');
    expect(result.ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.styles).toBeUndefined();
  });
});
