import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createPolicy, createStore, type Store } from '@bowerbirdjs/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { EditorController, type EditorEvent } from '../src/controller.js';
import { EDITOR_FEATURES, EditorFeatures } from '../src/features.js';

const SAM = { kind: 'user' as const, id: 'sam', name: 'Sam' };

describe('EditorFeatures', () => {
  test('everything is on by default, and a parent turns its children off', () => {
    const all = new EditorFeatures();
    expect(Object.keys(EDITOR_FEATURES).every((k) => all.on(k as never))).toBe(true);
    const f = new EditorFeatures({ features: { inspector: false, 'toolbar.zoom': false } });
    expect(f.on('inspector.styles')).toBe(false);
    expect(f.on('inspector.content.advanced')).toBe(false);
    expect(f.on('toolbar.zoom')).toBe(false);
    expect(f.on('toolbar')).toBe(true);
  });

  test('presets, overrides and the policy level', () => {
    const content = new EditorFeatures({ preset: 'content' });
    expect(content.on('insert')).toBe(false);
    expect(content.on('inspector.styles')).toBe(false);
    expect(content.on('inspector.content')).toBe(true);
    expect(content.on('text')).toBe(true);
    // A host can turn single things back on.
    expect(new EditorFeatures({ preset: 'content', features: { move: true } }).on('move')).toBe(
      true,
    );
    const layout = new EditorFeatures({ preset: 'layout' });
    expect(layout.on('insert.sections')).toBe(true);
    expect(layout.on('inspector.section')).toBe(true);
    expect(layout.on('inspector.section.settings')).toBe(false);
    expect(layout.on('components.create')).toBe(false);
    // `auto` (the default) follows the level; unknown presets fall back to everything.
    expect(new EditorFeatures({}, 'content').preset).toBe('content');
    expect(new EditorFeatures({ preset: 'auto' }, 'layout').preset).toBe('layout');
    expect(new EditorFeatures({}, 'design').preset).toBe('full');
    expect(new EditorFeatures({ preset: 'full' }, 'content').preset).toBe('full');
    expect(new EditorFeatures({ preset: 'nope' as never }).preset).toBe('full');
  });

  test('allowlists for sections, elements and style properties', () => {
    const f = new EditorFeatures({
      sections: ['hero'],
      elements: ['text', 'image'],
      styleProperties: ['color'],
    });
    expect(f.section('hero')).toBe(true);
    expect(f.section('pricing')).toBe(false);
    expect(f.element('image')).toBe(true);
    expect(f.element('box')).toBe(false);
    expect(f.styleProperty('color')).toBe(true);
    expect(f.styleProperty('padding')).toBe(false);
    // Lists don't turn on what a feature turns off.
    expect(new EditorFeatures({ preset: 'content', sections: ['hero'] }).section('hero')).toBe(
      false,
    );
  });
});

describe('EditorController features', () => {
  let store: Store;
  let c: EditorController;
  let events: EditorEvent[];
  beforeEach(() => {
    store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'section.insert', section: 'hero' },
        { op: 'section.insert', section: 'features' },
      ],
    });
    c = new EditorController(store, { actor: SAM });
    events = [];
    c.on((e) => events.push(e));
  });

  test('turned-off gestures do nothing, whatever triggers them', () => {
    c.setUI({ features: { delete: false, duplicate: false, move: false, insert: false } });
    c.select('hero-1');
    const revision = store.doc.revision;
    expect(c.removeSelected()).toBeUndefined();
    expect(c.duplicateSelected()).toBeUndefined();
    expect(c.nudge(1)).toBeUndefined();
    expect(c.move('hero-1', { after: 'features-1' })).toBeUndefined();
    expect(c.insertSection('cta')).toBeUndefined();
    expect(c.insertNode({ type: 'text', props: { text: 'x' } })).toBeUndefined();
    expect(store.doc.revision).toBe(revision);
    // Content edits still work.
    expect(c.setProps('hero-1/heading', { text: 'Still editable' }).ok).toBe(true);
    // Only listed sections can be inserted.
    c.setUI({ sections: ['cta'] });
    expect(c.insertSection('pricing')).toBeUndefined();
    expect(c.insertSection('cta')?.ok).toBe(true);
  });

  test('follows the store policy by default, and updates when it changes', () => {
    expect(c.features.preset).toBe('full');
    store.setPolicy(createPolicy({ levels: { user: 'content' } }));
    expect(events.at(-1)).toEqual({ type: 'view' });
    expect(c.features.preset).toBe('content');
    expect(c.can('delete')).toBe(false);
    store.setPolicy(createPolicy({ levels: { user: 'layout' } }));
    expect(c.features.preset).toBe('layout');
    expect(c.can('delete')).toBe(true);
    expect(c.can('inspector.styles')).toBe(false);
    // An explicit preset wins over the policy.
    c.setUI({ preset: 'content' });
    expect(c.features.preset).toBe('content');
  });

  test('undo can be turned off', () => {
    c.apply([{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Mine' } }]);
    c.setUI({ features: { undo: false } });
    expect(c.undo()).toBeUndefined();
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Mine');
  });
});

describe('documentation', () => {
  test('the README documents every feature key', async () => {
    const { readFile } = await import('node:fs/promises');
    const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
    const section = readme.slice(readme.indexOf('### Choose what the editor offers'));
    const missing = Object.keys(EDITOR_FEATURES).filter((key) => {
      const child = key.split('.').slice(1).join('.');
      return !section.includes(`\`${key}\``) && !(child && section.includes(`\`.${child}\``));
    });
    expect(missing).toEqual([]);
  });
});
