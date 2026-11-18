import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  createPolicy,
  createStore,
  defineComponent,
  defineData,
  diffDocs,
  type ElementSpec,
  type Store,
} from '@bowerbirdjs/core';
import { renderPage } from '@bowerbirdjs/html';
import { createSyncServer, memoryChannelPair, SyncedStore } from '@bowerbirdjs/sync';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const schedule = defineData({
  key: 'schedule',
  title: 'Schedule',
  description: 'The day’s program: time and title per item.',
  schema: z
    .array(z.object({ time: z.string().regex(/^\d\d:\d\d$/), title: z.string().min(1) }))
    .max(20),
});

// A component that shows data: one list item per schedule entry.
const scheduleList = defineComponent({
  name: 'schedule-list',
  kind: 'primitive',
  description: 'The schedule from site data.',
  props: z.object({}),
  children: false,
  render: (_node, ctx) => {
    const items = (ctx.data('schedule') as { time: string; title: string }[] | undefined) ?? [];
    return {
      tag: 'ol',
      children: items.map((item, i) => ({
        tag: 'li',
        attrs: { 'data-bb-data': `schedule.${i}.title` },
        children: [{ tag: 'time', text: item.time }, ` ${item.title}`],
      })),
    };
  },
});

function setup(): Store {
  const registry = createDefaultRegistry({ components: [scheduleList] }).registerData(schedule);
  const store = createStore({ registry, doc: createStarterDoc() });
  const result = store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'node.insert', parent: 'root-home', node: { type: 'schedule-list', id: 'list' } },
    ],
  });
  if (!result.ok) throw new Error(result.errors[0]?.message);
  return store;
}

describe('site data', () => {
  it('sets groups and paths, validates against the schema, and undoes', () => {
    const store = setup();
    const set = (path: (string | number)[] | undefined, value: unknown) =>
      store.apply({ ops: [{ op: 'data.set', key: 'schedule', ...(path ? { path } : {}), value }] });
    expect(set(undefined, [{ time: '14:00', title: 'Ceremony' }]).ok).toBe(true);
    expect(set([1], { time: '16:00', title: 'Cake' }).ok).toBe(true);
    expect(set([0, 'time'], '14:30').ok).toBe(true);
    expect(store.view.data('schedule')).toEqual([
      { time: '14:30', title: 'Ceremony' },
      { time: '16:00', title: 'Cake' },
    ]);
    const bad = set([0, 'time'], '2pm');
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.errors[0]).toMatchObject({ code: 'invalid_props', path: 'schedule.0.time' });
    const past = set([5], { time: '18:00', title: 'Dinner' });
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors[0]?.hint).toMatch(/Use 2 to add/);
    // null removes a list item.
    expect(set([0], null).ok).toBe(true);
    expect(store.view.data('schedule')).toEqual([{ time: '16:00', title: 'Cake' }]);
    store.undo();
    expect((store.view.data('schedule') as unknown[]).length).toBe(2);
    const summary = set([0, 'title'], 'Vows');
    expect(summary.ok && summary.summary.data).toEqual(['schedule']);
  });

  it('refuses unknown groups and unsafe keys', () => {
    const store = setup();
    const unknown = store.apply({ ops: [{ op: 'data.set', key: 'shedule', value: [] }] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.message).toMatch(/Did you mean "schedule"/);
    const proto = store.apply({
      ops: [{ op: 'data.set', key: 'schedule', path: [0, '__proto__'], value: { x: 1 } }],
    });
    expect(proto.ok).toBe(false);
  });

  it('is content-level, so content editors can change it', () => {
    const store = setup();
    store.setPolicy(createPolicy({ levels: { user: 'content' } }));
    const result = store.apply({
      actor: { kind: 'user', id: 'sam' },
      ops: [{ op: 'data.set', key: 'schedule', value: [{ time: '12:00', title: 'Lunch' }] }],
    });
    expect(result.ok).toBe(true);
  });

  it('renders through components, escaped, with editor marks only in the editor', () => {
    const store = setup();
    store.apply({
      ops: [
        {
          op: 'data.set',
          key: 'schedule',
          value: [{ time: '14:00', title: '<script>alert(1)</script> & toast' }],
        },
      ],
    });
    const published = renderPage(store.doc, store.registry, 'home').html;
    expect(published).toContain(
      '<li><time>14:00</time> &lt;script&gt;alert(1)&lt;/script&gt; &amp; toast</li>',
    );
    expect(published).not.toContain('data-bb-data');
    const editor = renderPage(store.doc, store.registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain('data-bb-data="schedule.0.title"');
  });

  it('shows up in diffs (for sync) and survives a round trip', () => {
    const store = setup();
    const before = store.doc;
    store.apply({
      ops: [{ op: 'data.set', key: 'schedule', value: [{ time: '09:00', title: 'Brunch' }] }],
    });
    expect(diffDocs(before, store.doc)).toEqual([
      { kind: 'data', id: 'schedule', after: [{ time: '09:00', title: 'Brunch' }] },
    ]);
    const copy = createStore({
      registry: store.registry,
      doc: JSON.parse(JSON.stringify(store.doc)),
    });
    expect(copy.view.data('schedule')).toEqual([{ time: '09:00', title: 'Brunch' }]);
  });

  it('syncs like any other change, and undoes on the server', async () => {
    const settle = async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    };
    const server = setup();
    const sync = createSyncServer(server, { presenceThrottleMs: 0 });
    const client = (id: string) => {
      const store = new SyncedStore({ registry: server.registry });
      const pair = memoryChannelPair();
      sync.connect(pair.server);
      store.connect(pair.client, { actor: { kind: 'user', id } });
      return store;
    };
    const a = client('sam');
    const b = client('ana');
    await settle();
    a.apply({
      ops: [{ op: 'data.set', key: 'schedule', value: [{ time: '10:00', title: 'Tea' }] }],
    });
    await settle();
    expect(server.view.data('schedule')).toEqual([{ time: '10:00', title: 'Tea' }]);
    expect(b.view.data('schedule')).toEqual([{ time: '10:00', title: 'Tea' }]);
    a.undo();
    await settle();
    expect(b.view.data('schedule')).toBeUndefined();
    expect(b.doc.data).toBeUndefined();
  });
});

describe('generated elements', () => {
  it('pass colours and numbers as custom properties, nothing else', () => {
    const swatches = defineComponent({
      name: 'swatches',
      kind: 'primitive',
      description: 'Colour swatches.',
      props: z.object({}),
      children: false,
      render: (): ElementSpec => ({
        tag: 'ul',
        children: [
          { tag: 'li', vars: { '--swatch': '#a1b2c3', '--size': '2rem' } },
          { tag: 'li', vars: { '--swatch': 'red; background: url(x)', '--Bad': '#fff' } },
          { tag: 'script', text: 'alert(1)' },
          { tag: 'a', attrs: { href: 'javascript:alert(1)', onclick: 'x()' }, text: 'x' },
        ],
      }),
    });
    const registry = createDefaultRegistry({ components: [swatches] });
    const store = createStore({ registry, doc: createStarterDoc() });
    store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'node.insert', parent: 'root-home', node: { type: 'swatches' } },
      ],
    });
    const html = renderPage(store.doc, registry, 'home').html;
    expect(html).toContain('<li style="--swatch: #a1b2c3; --size: 2rem"></li><li></li>');
    expect(html).toContain('<div>alert(1)</div>');
    expect(html).toContain('<a href="#">x</a>');
  });
});
