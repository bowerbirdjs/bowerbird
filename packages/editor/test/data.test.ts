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

const list = defineComponent({
  name: 'venue-list',
  kind: 'primitive',
  description: 'Venues.',
  props: z.object({}),
  children: false,
  render: (_node, ctx): ElementSpec => ({
    tag: 'ul',
    children: ((ctx.data('venues') as { id: string; name: string }[] | undefined) ?? []).map(
      (v, i) => ({
        tag: 'li',
        item: { path: `venues.${i}`, unique: ['id'] },
        edit: { path: `venues.${i}.name`, label: 'Name', value: v.name, required: true },
        text: v.name,
      }),
    ),
  }),
});

function setup() {
  const registry = createDefaultRegistry({ components: [list] }).registerData(venues);
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
});
