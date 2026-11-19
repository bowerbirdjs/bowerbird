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

describe('linked instances, history and review (QA round 2)', () => {
  test('parts of an instance are not restructured or inserted into, by any gesture', () => {
    const { store, c } = setup();
    c.insertSection('hero');
    store.apply({ ops: [{ op: 'symbol.create', id: 'hero-1', name: 'Promo' }] });
    const errors: unknown[] = [];
    c.on((e) => {
      if (e.type === 'error') errors.push(e);
    });
    c.select('hero-1/heading');
    expect(c.canRestructure('hero-1/heading')).toBe(false);
    expect(c.removeSelected()).toBeUndefined();
    expect(c.duplicateSelected()).toBeUndefined();
    expect(c.nudge(1)).toBeUndefined();
    expect(c.canInsertInto('hero-1/content')).toBe(false);
    expect(c.defaultNodePosition('text')).toBeUndefined();
    expect(errors).toEqual([]);
    // The instance root still moves as a whole.
    expect(c.canRestructure('hero-1')).toBe(true);
  });

  test('an entry that was undone and redone reads as active again', () => {
    const { c } = setup();
    c.insertSection('hero');
    const entry = () => c.store.history.find((e) => e.label === 'Add hero section')!;
    c.undo();
    expect(c.isUndone(entry())).toBe(true);
    c.redo();
    expect(c.isUndone(entry())).toBe(false);
    c.undo();
    expect(c.isUndone(entry())).toBe(true);
  });

  test('Accept is only offered when it would work for this person', () => {
    const { store, c } = setup();
    store.setPolicy(createPolicy({ review: { agent: true }, actors: { sam: 'content' } }));
    const p = store.propose({
      actor: BOT,
      ops: [{ op: 'token.set', path: 'color.accent', value: '#123456' }],
    });
    if (!p.ok) throw new Error('propose');
    expect(c.acceptProblem(p.changeset.id, [0])?.message).toMatch(
      /may make content changes, but changing design tokens/,
    );
    // Checking didn't accept anything.
    expect(store.changeset(p.changeset.id)?.status).toEqual(['open']);
    store.setPolicy(createPolicy({ review: { agent: true } }));
    expect(c.acceptProblem(p.changeset.id, [0])).toBeUndefined();
  });
});
