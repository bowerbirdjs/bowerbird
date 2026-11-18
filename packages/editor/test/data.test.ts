import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, defineComponent, defineData, type ElementSpec } from '@bowerbirdjs/core';
import { renderPage } from '@bowerbirdjs/html';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { EditorController, splitDataPath } from '../src/controller.js';

const venues = defineData({
  key: 'venues',
  title: 'Venues',
  description: 'Venues.',
  schema: z.array(
    z.object({ id: z.string(), name: z.string().min(1), note: z.string().optional() }),
  ),
});
const travel = defineData({
  key: 'travel',
  title: 'Travel',
  description: 'Travel.',
  schema: z.object({ text: z.string().optional(), links: z.array(z.string()).default([]) }),
});

const list = defineComponent({
  name: 'venue-list',
  kind: 'primitive',
  description: 'Venues.',
  props: z.object({}),
  children: false,
  render: (_node, ctx): ElementSpec => ({
    tag: 'ul',
    children: [
      ...((ctx.data('venues') as { id: string; name: string }[] | undefined) ?? []).map(
        (v, i): ElementSpec => ({
          tag: 'li',
          item: { path: `venues.${i}`, unique: ['id'] },
          edit: { path: `venues.${i}.name`, label: 'Name', value: v.name, required: true },
          text: v.name,
        }),
      ),
      {
        tag: 'li',
        add: { path: 'venues', value: { id: 'new', name: 'New' }, edit: 'name' },
        text: '+ Add',
      },
    ],
  }),
});

function setup() {
  const registry = createDefaultRegistry({ components: [list] })
    .registerData(venues)
    .registerData(travel);
  const store = createStore({ registry, doc: createStarterDoc() });
  store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'node.insert', parent: 'root-home', node: { type: 'venue-list', id: 'list' } },
      {
        op: 'data.set',
        key: 'venues',
        value: [
          { id: 'hall', name: 'Hall', note: 'Upstairs' },
          { id: 'garden', name: 'Garden' },
        ],
      },
    ],
  });
  return { store, c: new EditorController(store) };
}

describe('site data on the canvas', () => {
  test('edit and item marks are there in the editor only', () => {
    const { store } = setup();
    const editor = renderPage(store.doc, store.registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain('data-bb-data="venues.0.name"');
    expect(editor).toContain('data-bb-edit="[{&quot;path&quot;:&quot;venues.0.name&quot;');
    expect(editor).toContain(
      'data-bb-item="{&quot;path&quot;:&quot;venues.1&quot;,&quot;unique&quot;:[&quot;id&quot;]}"',
    );
    const published = renderPage(store.doc, store.registry, 'home').html;
    expect(published).not.toMatch(/data-bb-(data|edit|item)/);
  });

  test('setData writes one field; empty removes an optional one, a required one says why', () => {
    const { store, c } = setup();
    expect(c.setData('venues.1.name', 'Rose garden')?.ok).toBe(true);
    expect(c.setData('venues.0.note', '')?.ok).toBe(true);
    expect(store.view.data('venues')).toEqual([
      { id: 'hall', name: 'Hall' },
      { id: 'garden', name: 'Rose garden' },
    ]);
    const refused = c.setData('venues.0.name', '', { required: true });
    expect(refused?.ok).toBe(false);
    expect(splitDataPath('gifts.links.0.url')).toEqual(['gifts', 'links', 0, 'url']);
  });

  test('list items move, copy (with fresh unique keys) and go, one undo step each', () => {
    const { store, c } = setup();
    expect(c.dataItem('venues.0', 'down')).toBe('venues.1');
    expect((store.view.data('venues') as { id: string }[]).map((v) => v.id)).toEqual([
      'garden',
      'hall',
    ]);
    expect(c.dataItem('venues.1', 'down')).toBe('venues.1');
    expect(c.dataItem('venues.1', 'duplicate', ['id'])).toBe('venues.2');
    expect((store.view.data('venues') as { id: string }[]).map((v) => v.id)).toEqual([
      'garden',
      'hall',
      'hall-2',
    ]);
    expect(c.dataItem('venues.2', 'duplicate', ['id'])).toBe('venues.3');
    expect((store.view.data('venues') as { id: string }[]).at(-1)?.id).toBe('hall-3');
    expect(c.dataItem('venues.0', 'remove')).toBeUndefined();
    expect((store.view.data('venues') as unknown[]).length).toBe(3);
    store.undo();
    expect((store.view.data('venues') as unknown[]).length).toBe(4);
  });

  test('hosts can turn data editing off', () => {
    const { store, c } = setup();
    c.setUI({ features: { data: false } });
    expect(c.setData('venues.0.name', 'x')).toBeUndefined();
    expect(c.dataItem('venues.0', 'remove')).toBeUndefined();
    expect((store.view.data('venues') as unknown[]).length).toBe(2);
  });

  test('adding: the first item of an empty or missing list, a missing value, editor-only marks', () => {
    const { store, c } = setup();
    const editor = renderPage(store.doc, store.registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain('data-bb-add="{&quot;path&quot;:&quot;venues&quot;');
    expect(editor).toContain('role="button" tabindex="0"');
    expect(renderPage(store.doc, store.registry, 'home').html).not.toContain('data-bb-add');
    // Appends to a list, and returns where the new item is.
    expect(c.addData('venues', { id: 'barn', name: 'Barn' })).toBe('venues.2');
    // A list that doesn't exist yet starts with the item (inside a missing group, too).
    expect(c.addData('travel.links', 'https://example.com/a')).toBeUndefined();
    store.apply({ ops: [{ op: 'data.set', key: 'venues', value: null }] });
    expect(c.addData('venues', { id: 'hall', name: 'Hall' })).toBe('venues.0');
    expect(store.view.data('venues')).toEqual([{ id: 'hall', name: 'Hall' }]);
    // A missing value is filled in; an existing one isn't replaced.
    expect(c.addData('travel.text', 'By train')).toBe('travel.text');
    expect(store.view.data('travel')).toEqual({ text: 'By train', links: [] });
    expect(c.addData('travel.text', 'By bus')).toBeUndefined();
    // Bad data is refused like any other change.
    expect(c.addData('venues', { id: 'x' })).toBeUndefined();
    // The canvas hides add buttons that wouldn't do anything.
    expect(c.canAdd('venues', { id: 'y', name: 'Y' })).toBe(true);
    expect(c.canAdd('travel.text', 'By bus')).toBe(false);
    c.setUI({ features: { 'data.items': false } });
    expect(c.canAdd('venues', { id: 'y', name: 'Y' })).toBe(false);
    expect(c.addData('venues', { id: 'y', name: 'Y' })).toBeUndefined();
  });
});
