import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { type Actor, createPolicy, createStore, type Issue, type Store } from '@bowerbirdjs/core';
import { createSyncServer, memoryChannelPair, type Peer, SyncedStore } from '@bowerbirdjs/sync';
import { describe, expect, it } from 'vitest';

const sam: Actor = { kind: 'user', id: 'sam', name: 'Sam' };
const ana: Actor = { kind: 'user', id: 'ana', name: 'Ana' };
const bot: Actor = { kind: 'agent', id: 'bot', name: 'Bot' };

/** Lets queued messages (microtasks) flow until things settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(policy?: Parameters<typeof createPolicy>[0]) {
  const registry = createDefaultRegistry();
  const server: Store = createStore({
    registry,
    doc: createStarterDoc(),
    ...(policy ? { policy: createPolicy(policy) } : {}),
  });
  server.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'hero' },
    ],
  });
  const sync = createSyncServer(server);
  const client = (actor: Actor) => {
    const store = new SyncedStore({
      registry,
      ...(policy ? { policy: createPolicy(policy) } : {}),
    });
    const errors: Issue[] = [];
    const { client: c, server: s } = memoryChannelPair();
    sync.connect(s);
    store.connect(c, { actor, onError: (e) => errors.push(...e) });
    return { store, errors };
  };
  return { server, sync, client };
}

const text = (store: Store, id: string) => store.view.node(id)?.props.text;

describe('sync', () => {
  it('clients get the server document and see each other’s changes', async () => {
    const { server, client } = setup();
    const a = client(sam);
    const b = client(ana);
    await settle();
    expect(text(a.store, 'hero-1/heading')).toBe(text(server, 'hero-1/heading'));

    // Optimistic: the change shows locally at once, then reaches the server and the other client.
    a.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'From Sam' } }],
    });
    expect(text(a.store, 'hero-1/heading')).toBe('From Sam');
    expect(text(b.store, 'hero-1/heading')).not.toBe('From Sam');
    await settle();
    expect(text(server, 'hero-1/heading')).toBe('From Sam');
    expect(text(b.store, 'hero-1/heading')).toBe('From Sam');
    expect(server.history.at(-1)?.actor.id).toBe('sam');
    expect(b.store.history.at(-1)?.actor.id).toBe('sam');
  });

  it('concurrent changes converge in server order, keeping local pending work on top', async () => {
    const { server, client } = setup();
    const a = client(sam);
    const b = client(ana);
    await settle();
    a.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'A' } }],
    });
    b.store.apply({
      actor: ana,
      ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'B' } }],
    });
    b.store.apply({ actor: ana, ops: [{ op: 'section.insert', section: 'cta' }] });
    await settle();
    for (const s of [server, a.store, b.store]) {
      expect(text(s, 'hero-1/heading')).toBe('A');
      expect(text(s, 'hero-1/subheading')).toBe('B');
      expect(s.view.node('cta-1')).toBeDefined();
    }
    expect(a.store.doc.revision).toBe(server.doc.revision);
    expect(JSON.stringify(a.store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
    expect(JSON.stringify(b.store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
  });

  it('a change the server refuses is rolled back locally and reported', async () => {
    const { server, client } = setup({ levels: { user: 'content' } });
    const a = client(sam);
    await settle();
    // The client's own copy of the policy is looser than the server's.
    a.store.setPolicy(createPolicy());
    a.store.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'cta' }] });
    expect(a.store.view.node('cta-1')).toBeDefined();
    await settle();
    expect(a.store.view.node('cta-1')).toBeUndefined();
    expect(server.view.node('cta-1')).toBeUndefined();
    expect(a.errors[0]?.code).toBe('policy');
  });

  it('undo runs on the server, per actor', async () => {
    const { server, client } = setup();
    const a = client(sam);
    const b = client(ana);
    await settle();
    a.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Sam' } }],
    });
    await settle();
    b.store.apply({
      actor: ana,
      ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'Ana' } }],
    });
    await settle();
    a.store.undo({ actorId: 'sam' });
    await settle();
    for (const s of [server, a.store, b.store]) {
      expect(text(s, 'hero-1/heading')).not.toBe('Sam');
      expect(text(s, 'hero-1/subheading')).toBe('Ana');
    }
  });

  it('agents on the server propose; a connected person reviews and accepts', async () => {
    const { server, client } = setup({ review: { agent: true } });
    const a = client(sam);
    await settle();
    const proposed = server.propose({
      actor: bot,
      ops: [{ op: 'section.insert', section: 'cta' }],
    });
    expect(proposed.ok).toBe(true);
    await settle();
    expect(a.store.changesets.map((c) => c.id)).toEqual(['cs-1']);
    a.store.acceptChangeset('cs-1', { by: sam });
    await settle();
    expect(server.view.node('cta-1')).toBeDefined();
    expect(a.store.view.node('cta-1')).toBeDefined();
    expect(a.store.changesets[0]?.status).toEqual(['accepted']);
    expect(server.history.at(-1)).toMatchObject({
      actor: { id: 'bot' },
      approvedBy: { id: 'sam' },
    });
  });

  it('shares presence, including agents working directly on the server', async () => {
    const { server, client } = setup();
    const a = client(sam);
    const b = client(ana);
    const seen: Peer[][] = [];
    b.store.onPeers((peers) => seen.push(peers));
    await settle();
    a.store.setPresence({ page: 'home', selection: 'hero-1/heading' });
    await settle();
    const samPeer = b.store.peers.find((p) => p.actor.id === 'sam');
    expect(samPeer).toMatchObject({ selection: 'hero-1/heading', page: 'home' });
    expect(samPeer?.color).toMatch(/^#/);
    expect(b.store.peers.some((p) => p.actor.id === 'ana')).toBe(false);

    server.apply({ actor: bot, label: 'Add CTA', ops: [{ op: 'section.insert', section: 'cta' }] });
    await settle();
    expect(b.store.peers.find((p) => p.actor.id === 'bot')).toMatchObject({
      selection: 'cta-1',
      activity: 'Add CTA',
    });
    expect(seen.length).toBeGreaterThan(1);
  });

  it('refuses clients that claim to be the system', async () => {
    const { client } = setup();
    const c = client({ kind: 'system', id: 'root' });
    await settle();
    expect(c.store.connected).toBe(false);
    expect(c.errors[0]?.message).toMatch(/Not allowed/);
  });
});
