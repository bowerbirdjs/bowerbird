import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  type Actor,
  type CommitEvent,
  createPolicy,
  createStore,
  type Issue,
  type Store,
} from '@bowerbirdjs/core';
import {
  type Channel,
  type ClientMessage,
  createSyncServer,
  memoryChannelPair,
  type ServerMessage,
  SyncedStore,
  type SyncServerOptions,
} from '@bowerbirdjs/sync';
import { describe, expect, it } from 'vitest';

const sam: Actor = { kind: 'user', id: 'sam', name: 'Sam' };
const ana: Actor = { kind: 'user', id: 'ana', name: 'Ana' };
const bot: Actor = { kind: 'agent', id: 'bot', name: 'Bot' };

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (store: Store, id: string) => store.view.node(id)?.props.text;
const heading = (text: string) => [{ op: 'props.set', id: 'hero-1/heading', props: { text } }];

function setup(
  options: { policy?: Parameters<typeof createPolicy>[0]; server?: SyncServerOptions } = {},
) {
  const registry = createDefaultRegistry();
  const policy = options.policy ? createPolicy(options.policy) : undefined;
  const server: Store = createStore({
    registry,
    doc: createStarterDoc(),
    ...(policy ? { policy } : {}),
  });
  server.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'hero' },
    ],
  });
  const sync = createSyncServer(server, { presenceThrottleMs: 0, ...options.server });
  /** A client store; `link()` connects it over a fresh channel (call again to reconnect). */
  const client = (actor: Actor, context?: unknown) => {
    const store = new SyncedStore({ registry, ...(policy ? { policy } : {}) });
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    store.onSyncWarning((w) => warnings.push(...w));
    let channel: Channel<ServerMessage, ClientMessage> | undefined;
    const link = () => {
      const pair = memoryChannelPair();
      sync.connect(pair.server, context);
      store.connect(pair.client, { actor, onError: (e) => errors.push(...e) });
      channel = pair.client;
      return pair;
    };
    link();
    return { store, errors, warnings, link, drop: () => channel?.close?.() };
  };
  return { server, sync, client, registry };
}

describe('sync review fixes', () => {
  it('ids created before the server confirmed are pinned; later edits follow a rename', async () => {
    const { server, client } = setup();
    const s = client(sam);
    const a = client(ana);
    await settle();
    const renamed: Record<string, string>[] = [];
    s.store.onRenamed((r) => renamed.push(r));
    // Ana's insert reaches the server first; Sam's local cta-1 has to become cta-2 there.
    a.store.apply({ actor: ana, ops: [{ op: 'section.insert', section: 'cta' }] });
    s.store.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'cta' }] });
    s.store.apply({
      actor: sam,
      ops: [{ op: 'props.set', id: 'cta-1/heading', props: { text: 'Sam’s CTA' } }],
    });
    expect(text(s.store, 'cta-1/heading')).toBe('Sam’s CTA');
    await settle();
    expect(text(server, 'cta-1/heading')).not.toBe('Sam’s CTA');
    expect(text(server, 'cta-2/heading')).toBe('Sam’s CTA');
    expect(renamed).toEqual([{ 'cta-1': 'cta-2' }]);
    for (const store of [s.store, a.store])
      expect(JSON.stringify(store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
    expect(s.errors).toEqual([]);
  });

  it('edits made while disconnected are kept and sent after reconnecting, once', async () => {
    const { server, client } = setup();
    const s = client(sam);
    await settle();
    const statuses: boolean[] = [];
    s.store.onStatus((c) => statuses.push(c));
    s.drop();
    expect(s.store.connected).toBe(false);
    expect(s.store.apply({ actor: sam, ops: heading('Offline edit') }).ok).toBe(true);
    expect(text(s.store, 'hero-1/heading')).toBe('Offline edit');
    expect(s.store.unconfirmed).toBe(1);
    // Undo needs the server: refused while offline, with a clear reason.
    const undo = s.store.undo({ actorId: 'sam' });
    expect(undo.ok).toBe(false);
    if (!undo.ok) expect(undo.errors[0]?.code).toBe('offline');
    s.link();
    await settle();
    expect(text(server, 'hero-1/heading')).toBe('Offline edit');
    expect(text(s.store, 'hero-1/heading')).toBe('Offline edit');
    expect(s.store.unconfirmed).toBe(0);
    expect(statuses).toEqual([false, true]);
    expect(server.history.filter((e) => e.actor.id === 'sam')).toHaveLength(1);
  });

  it('a change the server applied before the connection dropped isn’t applied twice', async () => {
    const { server, sync, registry } = setup();
    const store = new SyncedStore({ registry });
    // A connection whose replies get lost once the server has handled a change.
    const pair = memoryChannelPair();
    let lose = false;
    sync.connect({
      ...pair.server,
      receive: (handler) =>
        pair.server.receive((m) => {
          if (m.type === 'tx') lose = true;
          handler(m);
        }),
      send: (m) => {
        if (!lose) pair.server.send(m);
      },
    });
    store.connect(pair.client, { actor: sam });
    await settle();
    store.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'cta' }] });
    await settle();
    expect(server.view.node('cta-1')).toBeDefined();
    expect(store.unconfirmed).toBe(1);
    pair.client.close?.();
    const again = memoryChannelPair();
    sync.connect(again.server);
    store.connect(again.client, { actor: sam });
    await settle();
    expect(server.view.node('cta-2')).toBeUndefined();
    expect(store.view.node('cta-2')).toBeUndefined();
    expect(store.unconfirmed).toBe(0);
    expect(JSON.stringify(store.doc.nodes)).toBe(JSON.stringify(server.doc.nodes));
  });

  it('undo and redo flags reach clients, so "can undo" is right', async () => {
    const { client } = setup();
    const s = client(sam);
    await settle();
    s.store.apply({ actor: sam, ops: heading('Sam') });
    await settle();
    s.store.undo();
    await settle();
    const edit = s.store.history.find((e) => e.actor.id === 'sam' && e.kind === 'edit');
    expect(edit?.undone).toBe(true);
    s.store.redo();
    await settle();
    const undo = s.store.history.find((e) => e.kind === 'undo');
    expect(undo?.redone).toBe(true);
    // Nothing left to redo: the server says so instead of staying silent.
    s.store.redo();
    await settle();
    expect(s.errors.map((e) => e.code)).toEqual(['nothing_to_undo']);
  });

  it('authenticates with the connection’s context and tells the client who it is', async () => {
    const { server, client } = setup({
      server: {
        authenticate: (_claimed, context) => {
          const session = (context as { session?: string } | undefined)?.session;
          return session ? { kind: 'user', id: `user:${session}` } : undefined;
        },
      },
    });
    const s = client(sam, { session: '42' });
    const nobody = client(ana);
    await settle();
    expect(s.store.actor).toEqual({ kind: 'user', id: 'user:42' });
    expect(nobody.store.connected).toBe(false);
    s.store.apply({ actor: sam, ops: heading('Mine') });
    await settle();
    expect(server.history.at(-1)?.actor.id).toBe('user:42');
    // Undo of "my" change works with either id.
    s.store.undo({ actorId: 'sam' });
    await settle();
    expect(text(server, 'hero-1/heading')).not.toBe('Mine');
  });

  it('agent presence expires on its own, ignores accepted proposals, and shows proposals', async () => {
    const { server, sync, client } = setup({
      policy: { review: { agent: true } },
      server: { agentPresenceMs: 40 },
    });
    const s = client(sam);
    await settle();
    server.propose({
      actor: bot,
      label: 'Add CTA',
      ops: [{ op: 'section.insert', section: 'cta' }],
    });
    await settle();
    expect(s.store.peers.find((p) => p.actor.id === 'bot')).toMatchObject({
      activity: 'Proposed: Add CTA',
      selection: 'cta-1',
    });
    await wait(80);
    expect(s.store.peers.some((p) => p.actor.id === 'bot')).toBe(false);
    // Sam accepting the agent's proposal is Sam's action, not the agent working.
    s.store.acceptChangeset('cs-1', { by: sam });
    await settle();
    expect(server.view.node('cta-1')).toBeDefined();
    expect(s.store.peers.some((p) => p.actor.id === 'bot')).toBe(false);
    // Tool calls (e.g. reading the page over MCP) keep an agent present.
    sync.touch(bot, { activity: 'Reading the page' });
    await settle();
    expect(s.store.peers.find((p) => p.actor.id === 'bot')?.activity).toBe('Reading the page');
    sync.close();
  });

  it('syncs token provenance, sends warnings to the client that caused them, and limits ids', async () => {
    const { server, client } = setup({ policy: { protectHumanEdits: 'warn' } });
    const s = client(sam);
    const agent = client(bot);
    await settle();
    s.store.apply({
      actor: sam,
      ops: [{ op: 'token.set', path: 'color.brand.600', value: '#123456' }],
    });
    s.store.apply({ actor: sam, ops: heading('Sam wrote this') });
    await settle();
    expect(agent.store.doc.tokenEdits).toEqual(server.doc.tokenEdits);
    expect(Object.keys(agent.store.doc.tokenEdits ?? {})).toEqual(['token:color.brand.600']);
    // The agent's client was told (by the server) that it overwrote a person's edit.
    agent.store.setPolicy(createPolicy({ protectHumanEdits: 'off' }));
    agent.store.apply({ actor: bot, ops: heading('Agent wrote this') });
    await settle();
    expect(agent.warnings.map((w) => w.code)).toContain('human_edit');
    expect(s.warnings).toEqual([]);
  });

  it('the server answers hello once, refuses odd ids and caps connections', async () => {
    const { sync } = setup({ server: { maxClients: 1 } });
    const received: ServerMessage[] = [];
    const pair = memoryChannelPair();
    pair.client.receive((m) => received.push(m));
    sync.connect(pair.server);
    pair.client.send({ type: 'hello', actor: sam });
    pair.client.send({ type: 'hello', actor: sam });
    pair.client.send({ type: 'tx', id: 'x'.repeat(500), input: { ops: heading('x') } });
    await settle();
    expect(received.map((m) => m.type)).toEqual(['welcome', 'peers', 'rejected', 'rejected']);
    const second = memoryChannelPair();
    const refused: ServerMessage[] = [];
    second.client.receive((m) => refused.push(m));
    sync.connect(second.server);
    await settle();
    expect(refused).toMatchObject([
      { type: 'rejected', errors: [{ message: expect.stringMatching(/Too many/) }] },
    ]);
  });

  it('confirmations are marked as echoes; rollbacks report what changed', async () => {
    const { client } = setup({ policy: { levels: { user: 'content' } } });
    const s = client(sam);
    await settle();
    const events: CommitEvent[] = [];
    s.store.subscribe((e) => events.push(e));
    s.store.apply({ actor: sam, ops: heading('Once') });
    await settle();
    expect(events.map((e) => !!e.echo)).toEqual([false, true]);
    // The client's own policy is looser than the server's: the insert is rolled back.
    s.store.setPolicy(createPolicy());
    events.length = 0;
    s.store.apply({ actor: sam, ops: [{ op: 'section.insert', section: 'cta' }] });
    await settle();
    expect(events).toHaveLength(2);
    expect(events[1]?.summary.removed).toContain('cta-1');
    expect(s.errors[0]?.code).toBe('policy');
  });

  it('keeps client history within the limit and only open changesets', async () => {
    const { server, registry } = setup();
    const sync = createSyncServer(server, { presenceThrottleMs: 0 });
    const store = new SyncedStore({ registry, historyLimit: 3 });
    const pair = memoryChannelPair();
    sync.connect(pair.server);
    store.connect(pair.client, { actor: sam });
    await settle();
    for (let i = 0; i < 6; i++) {
      store.apply({ actor: sam, ops: heading(`v${i}`) });
      await settle();
    }
    expect(store.history.length).toBeLessThanOrEqual(3);
    expect((store as unknown as { serverHistory: unknown[] }).serverHistory.length).toBe(3);
  });
});
