import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { type Actor, createPolicy, createStore } from '@bowerbirdjs/core';
import { createSyncServer, memoryChannelPair, SyncedStore } from '@bowerbirdjs/sync';
import { describe, expect, test } from 'vitest';
import { EditorController, type EditorEvent } from '../src/controller.js';

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

function setup(serverPolicy?: Parameters<typeof createPolicy>[0]) {
  const registry = createDefaultRegistry();
  const server = createStore({
    registry,
    doc: createStarterDoc(),
    ...(serverPolicy ? { policy: createPolicy(serverPolicy) } : {}),
  });
  server.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'hero' },
    ],
  });
  const sync = createSyncServer(server, {
    presenceThrottleMs: 0,
    // The host maps people to its own ids.
    authenticate: (claimed) => ({ kind: 'user', id: `user:${claimed.id}` }),
  });
  const editor = (actor: Actor) => {
    const store = new SyncedStore({ registry });
    const pair = memoryChannelPair();
    sync.connect(pair.server);
    store.connect(pair.client, { actor });
    const controller = new EditorController(store, { actor });
    const events: EditorEvent[] = [];
    controller.on((e) => events.push(e));
    return { store, controller, events };
  };
  return { server, editor };
}

describe('editor with a synced store', () => {
  test('server refusals and rollbacks show as error events', async () => {
    const { editor } = setup({ levels: { user: 'content' } });
    const sam = editor({ kind: 'user', id: 'sam' });
    await settle();
    expect(sam.controller.insertSection('cta')).toBeDefined();
    await settle();
    expect(sam.store.view.node('cta-1')).toBeUndefined();
    const errors = sam.events.filter((e) => e.type === 'error');
    expect(errors).toMatchObject([{ label: 'Sync', errors: [{ code: 'policy' }] }]);
  });

  test('the selection follows ids the server renamed', async () => {
    const { server, editor } = setup();
    const sam = editor({ kind: 'user', id: 'sam' });
    const ana = editor({ kind: 'user', id: 'ana' });
    await settle();
    ana.controller.insertSection('cta');
    sam.controller.insertSection('cta');
    expect(sam.controller.selected).toBe('cta-1');
    await settle();
    expect(server.view.node('cta-2')?.section).toBeDefined();
    expect(sam.controller.selected).toBe('cta-2');
    expect(ana.controller.selected).toBe('cta-1');
  });

  test('undo uses the identity the server confirmed', async () => {
    const { server, editor } = setup();
    const sam = editor({ kind: 'user', id: 'sam' });
    await settle();
    expect(sam.controller.identity.id).toBe('user:sam');
    sam.controller.apply([{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Mine' } }]);
    await settle();
    expect(server.history.at(-1)?.actor.id).toBe('user:sam');
    sam.controller.undo();
    await settle();
    expect(server.view.node('hero-1/heading')?.props.text).not.toBe('Mine');
    expect(
      sam.store.history.find((e) => e.actor.id === 'user:sam' && e.kind === 'edit')?.undone,
    ).toBe(true);
  });
});
