// Regressions from the second QA pass: ids created by copies, moves and refusals during sync.
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { type Actor, createPolicy, createStore, type Issue, type Store } from '@bowerbirdjs/core';
import {
  createSyncServer,
  memoryChannelPair,
  type SocketLike,
  SyncedStore,
  socketChannel,
} from '@bowerbirdjs/sync';
import { describe, expect, it } from 'vitest';

const sam: Actor = { kind: 'user', id: 'sam', name: 'Sam' };
const ana: Actor = { kind: 'user', id: 'ana', name: 'Ana' };
const bot: Actor = { kind: 'agent', id: 'bot', name: 'Bot' };

const settle = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const text = (store: Store, id: string) => store.view.node(id)?.props.text;

function setup(policy?: Parameters<typeof createPolicy>[0]) {
  const registry = createDefaultRegistry();
  const p = policy ? createPolicy(policy) : undefined;
  const server: Store = createStore({
    registry,
    doc: createStarterDoc(),
    ...(p ? { policy: p } : {}),
  });
  server.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'hero' },
      { op: 'section.insert', section: 'features' },
      { op: 'node.insert', parent: 'hero-1/content', node: { type: 'box' } },
    ],
  });
  const sync = createSyncServer(server, { presenceThrottleMs: 0 });
  const client = (actor: Actor) => {
    const store = new SyncedStore({ registry, ...(p ? { policy: p } : {}) });
    const errors: Issue[] = [];
    let close = () => {};
    const link = () => {
      const pair = memoryChannelPair();
      sync.connect(pair.server);
      store.connect(pair.client, { actor, onError: (e) => errors.push(...e) });
      close = () => pair.client.close?.();
    };
    link();
    return { store, errors, link, drop: () => close() };
  };
  return { server, client };
}

describe('ids during sync', () => {
  it('a duplicate made before the server confirmed it is renamed, and edits follow it', async () => {
    const { server, client } = setup();
    const s = client(sam);
    const a = client(ana);
    await settle();
    a.store.apply({ actor: ana, ops: [{ op: 'section.insert', section: 'hero' }] });
    s.store.apply({ actor: sam, ops: [{ op: 'node.duplicate', id: 'hero-1' }] });
    s.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'hero-2/heading', props: { text: 'Sam copy' } }],
    });
    await settle();
    expect(text(server, 'hero-3/heading')).toBe('Sam copy');
    expect(text(server, 'hero-2/heading')).not.toBe('Sam copy');
    expect(JSON.stringify(s.store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
    expect(s.errors).toEqual([]);
  });

  it('an insert into a box someone moved into another section meanwhile still lands', async () => {
    const { server, client } = setup();
    const s = client(sam);
    const a = client(ana);
    await settle();
    a.store.apply({
      actor: ana,
      ops: [{ op: 'node.move', id: 'hero-1/box-1', parent: 'features-1/header' }],
    });
    s.store.apply({
      actor: sam,
      ops: [
        {
          op: 'node.insert',
          parent: 'hero-1/box-1',
          node: { type: 'text', props: { text: 'Sam’s note' } },
        },
      ],
    });
    await settle();
    const note = server.view.children('hero-1/box-1').find((n) => n.props.text === 'Sam’s note');
    expect(note?.id).toBe('features-1/text-1');
    expect(s.errors).toEqual([]);
    expect(JSON.stringify(s.store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
  });

  it('edits on a page made offline are dropped, not moved, when that page is refused', async () => {
    const { server, client } = setup();
    const s = client(sam);
    await settle();
    s.drop();
    s.store.apply({
      actor: sam,
      ops: [{ op: 'page.create', id: 'about', path: '/about', title: 'About' }],
    });
    s.store.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'cta', page: 'about' }] });
    s.store.apply({ actor: sam, ops: [{ op: 'page.update', id: 'about', title: 'About us' }] });
    // Meanwhile an agent makes its own /about on the server.
    server.apply({
      actor: bot,
      ops: [{ op: 'page.create', id: 'about', path: '/about', title: 'Team' }],
    });
    s.link();
    await settle();
    expect(server.doc.pages.about?.title).toBe('Team');
    expect(server.view.children(server.doc.pages.about!.rootId)).toEqual([]);
    expect(s.errors.some((e) => /already uses the path/.test(e.message))).toBe(true);
    expect(s.errors.some((e) => /was refused/.test(e.message))).toBe(true);
    expect(JSON.stringify(s.store.doc.pages)).toBe(JSON.stringify(server.doc.pages));
  });

  it('an agent syncing with the server can undo with overwrite when the person asked', async () => {
    const { server, client } = setup({ protectHumanEdits: 'confirm' });
    const b = client(bot);
    const s = client(sam);
    await settle();
    b.store.apply({ actor: bot, ops: [{ op: 'section.insert', section: 'cta' }] });
    await settle();
    s.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'cta-1/heading', props: { text: 'Sam’s words' } }],
    });
    await settle();
    b.store.undo({ actorId: bot.id });
    await settle();
    expect(server.view.node('cta-1')).toBeDefined();
    expect(b.errors[0]?.code).toBe('human_edit');
    b.store.undo({ actorId: bot.id, overwrite: true });
    await settle();
    expect(server.view.node('cta-1')).toBeUndefined();
  });
});

describe('ids in proposals', () => {
  it('a proposed duplicate gets a fresh id when its id was taken before accepting', () => {
    const { server } = setup({ review: { agent: true } });
    const p = server.propose({
      actor: bot,
      ops: [
        { op: 'node.duplicate', id: 'hero-1' },
        { op: 'props.set', id: 'hero-2/heading', props: { text: 'Agent copy' } },
      ],
    });
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    expect(p.changeset.ops[0]).toMatchObject({ copy: 'hero-2' });
    expect(p.changeset.needs[1]).toEqual([0]);
    server.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'hero' }] });
    expect(server.acceptChangeset(p.changeset.id, { by: sam }).ok).toBe(true);
    expect(text(server, 'hero-3/heading')).toBe('Agent copy');
    expect(text(server, 'hero-2/heading')).not.toBe('Agent copy');
  });

  it('a proposed keyed box keeps its children together when its id is taken', () => {
    const { server } = setup({ review: { agent: true } });
    const p = server.propose({
      actor: bot,
      ops: [
        {
          op: 'node.insert',
          parent: 'features-1/grid',
          node: { type: 'box', key: 'extra', children: [{ type: 'text', props: { text: 'X' } }] },
        },
      ],
    });
    if (!p.ok) throw new Error(JSON.stringify(p.errors));
    const pinned = JSON.stringify(p.changeset.ops[0]);
    expect(pinned).toContain('"features-1/box-1/text-1"');
    server.apply({
      actor: sam,
      ops: [{ op: 'node.insert', parent: 'features-1/grid', node: { type: 'box', key: 'mine' } }],
    });
    const res = server.acceptChangeset(p.changeset.id, { by: sam });
    expect(res.ok).toBe(true);
    expect(text(server, 'features-1/box-2/text-1')).toBe('X');
  });
});

describe('socketChannel', () => {
  it('waits for a socket that is still connecting before sending', () => {
    const sent: string[] = [];
    const listeners: Record<string, (() => void)[]> = {};
    const socket = {
      readyState: 0,
      send: (data: string) => {
        if (socket.readyState !== 1) throw new Error('Sent before connected');
        sent.push(data);
      },
      close: () => {},
      addEventListener: (type: string, l: () => void) => {
        (listeners[type] ??= []).push(l);
      },
    };
    const channel = socketChannel<unknown, { type: string }>(socket as unknown as SocketLike);
    channel.send({ type: 'hello' });
    expect(sent).toEqual([]);
    socket.readyState = 1;
    for (const l of listeners.open ?? []) l();
    channel.send({ type: 'tx' });
    expect(sent).toEqual(['{"type":"hello"}', '{"type":"tx"}']);
  });
});
