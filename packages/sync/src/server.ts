import type { Actor, Store } from '@bowerbirdjs/core';
import type { Channel, ClientMessage, Peer, PresenceState, ServerMessage } from './protocol.js';

const COLORS = [
  '#e11d48',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

export interface SyncServerOptions {
  /**
   * Decides who a connecting client is. Default: trust the actor the client sends, but never let
   * it claim to be the system. Hosts should authenticate (e.g. from a session cookie).
   */
  authenticate?: (claimed: Actor) => Actor | undefined;
  /** How long an agent working on the server (e.g. over MCP) shows as present. Default 20 s. */
  agentPresenceMs?: number;
}

export interface SyncServer {
  /** Serves one client over a channel until it closes. */
  connect(channel: Channel<ClientMessage, ServerMessage>): void;
  /** Connected peers, including agents working directly on the server store. */
  peers(): Peer[];
  close(): void;
}

interface Client {
  id: string;
  channel: Channel<ClientMessage, ServerMessage>;
  actor?: Actor;
  peer?: Peer;
}

/**
 * The authoritative side of sync: every change is applied to the server's store (so policy,
 * validation and history live in one place) and broadcast to all clients as record changes.
 * Agents can work on the same store directly (e.g. through the MCP server); they show up in
 * presence from their commits.
 */
export function createSyncServer(store: Store, options: SyncServerOptions = {}): SyncServer {
  const clients = new Map<string, Client>();
  const agents = new Map<string, Peer>();
  let counter = 0;
  let source: { clientId: string; id: string } | undefined;
  const authenticate =
    options.authenticate ??
    ((claimed: Actor): Actor | undefined => {
      const c = claimed as Partial<Actor> | null;
      if (!c || (c.kind !== 'user' && c.kind !== 'agent') || typeof c.id !== 'string' || !c.id)
        return undefined;
      return {
        kind: c.kind,
        id: c.id.slice(0, 100),
        ...(typeof c.name === 'string' ? { name: c.name.slice(0, 100) } : {}),
      };
    });
  const agentMs = options.agentPresenceMs ?? 20_000;

  const colorFor = (key: string) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length]!;
  };
  const peers = (): Peer[] => {
    const now = Date.now();
    for (const [id, p] of agents) if (now - p.at > agentMs) agents.delete(id);
    return [...[...clients.values()].flatMap((c) => (c.peer ? [c.peer] : [])), ...agents.values()];
  };
  const broadcast = (message: ServerMessage, except?: string) => {
    for (const c of clients.values()) if (c.actor && c.id !== except) c.channel.send(message);
  };
  const broadcastPeers = () => broadcast({ type: 'peers', peers: peers() });

  const offCommit = store.subscribe(({ entry, doc }) => {
    broadcast({
      type: 'commit',
      revision: doc.revision,
      changes: entry.changes,
      counters: { ...(doc.counters ?? {}) },
      entry,
      ...(source ? { source } : {}),
    });
    // Agents working on the store directly (not through a client) appear as peers for a while.
    const connected = [...clients.values()].some((c) => c.actor?.id === entry.actor.id);
    if (entry.actor.kind === 'agent' && !connected) {
      const touched = entry.changes.flatMap((ch) =>
        ch.kind === 'node' && ch.after ? [ch.id] : [],
      );
      const top = touched.find((id) => !touched.some((o) => o !== id && id.startsWith(`${o}/`)));
      agents.set(entry.actor.id, {
        clientId: `agent:${entry.actor.id}`,
        actor: entry.actor,
        color: colorFor(entry.actor.id),
        selection: top ?? null,
        activity: entry.label ?? null,
        at: Date.now(),
      });
      broadcastPeers();
    }
  });
  const offChangesets = store.onChangesets((changesets) =>
    broadcast({ type: 'changesets', changesets }),
  );
  const offLoad = store.onLoad((doc) =>
    broadcast({ type: 'reset', doc, history: [...store.history], changesets: store.changesets }),
  );

  /** Only these fields of a client's transaction are used; the actor always comes from the server. */
  const input = (raw: unknown) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      ops: Array.isArray(i.ops) ? i.ops : [],
      ...(typeof i.label === 'string' ? { label: i.label.slice(0, 200) } : {}),
      ...(i.overwrite === true ? { overwrite: true } : {}),
    };
  };

  function handle(client: Client, message: ClientMessage) {
    if (message.type === 'hello') {
      const actor = authenticate(message.actor);
      if (!actor) {
        client.channel.send({
          type: 'rejected',
          errors: [{ code: 'policy', message: 'Not allowed to connect.' }],
        });
        client.channel.close?.();
        return;
      }
      client.actor = actor;
      client.peer = { clientId: client.id, actor, color: colorFor(actor.id), at: Date.now() };
      client.channel.send({
        type: 'welcome',
        clientId: client.id,
        doc: store.doc,
        history: [...store.history],
        changesets: store.changesets,
        peers: peers(),
      });
      broadcastPeers();
      return;
    }
    const actor = client.actor;
    if (!actor) return;
    switch (message.type) {
      case 'tx': {
        source = { clientId: client.id, id: message.id };
        try {
          const result = store.apply({ ...input(message.input), actor });
          if (!result.ok)
            client.channel.send({ type: 'rejected', id: message.id, errors: result.errors });
          else if (!result.txId) {
            // Nothing changed on the server; the client drops the pending change.
            client.channel.send({ type: 'rejected', id: message.id, errors: [] });
          }
        } finally {
          source = undefined;
        }
        return;
      }
      case 'undo':
      case 'redo':
      case 'undo-by': {
        const result =
          message.type === 'redo'
            ? store.redo({ actorId: actor.id, actor })
            : store.undo({
                actorId: message.type === 'undo-by' ? String(message.actorId) : actor.id,
                actor,
              });
        if (!result.ok && result.errors[0]?.code !== 'nothing_to_undo')
          client.channel.send({ type: 'rejected', errors: result.errors });
        return;
      }
      case 'propose': {
        const result = store.propose({ ...input(message.input), actor });
        if (!result.ok)
          client.channel.send({ type: 'rejected', id: message.id, errors: result.errors });
        return;
      }
      case 'accept': {
        const ops = Array.isArray(message.ops) ? message.ops.filter(Number.isInteger) : undefined;
        const result = store.acceptChangeset(String(message.changeset), {
          by: actor,
          ...(ops ? { ops } : {}),
        });
        if (!result.ok) client.channel.send({ type: 'rejected', errors: result.errors });
        return;
      }
      case 'reject': {
        const ops = Array.isArray(message.ops) ? message.ops.filter(Number.isInteger) : undefined;
        const result = store.rejectChangeset(String(message.changeset), {
          by: actor,
          ...(ops ? { ops } : {}),
        });
        if (!result.ok) client.channel.send({ type: 'rejected', errors: result.errors });
        return;
      }
      case 'presence': {
        const state: PresenceState = message.state ?? {};
        client.peer = {
          ...client.peer!,
          page: typeof state.page === 'string' ? state.page.slice(0, 200) : null,
          selection: typeof state.selection === 'string' ? state.selection.slice(0, 200) : null,
          editing: typeof state.editing === 'string' ? state.editing.slice(0, 200) : null,
          activity: typeof state.activity === 'string' ? state.activity.slice(0, 200) : null,
          at: Date.now(),
        };
        broadcastPeers();
        return;
      }
    }
  }

  return {
    connect(channel) {
      const client: Client = { id: `c${++counter}`, channel };
      clients.set(client.id, client);
      channel.receive((message) => {
        try {
          handle(client, message);
        } catch (error) {
          channel.send({
            type: 'rejected',
            errors: [{ code: 'invalid_op', message: `Sync failed: ${String(error)}` }],
          });
        }
      });
      channel.closed?.(() => {
        clients.delete(client.id);
        broadcastPeers();
      });
    },
    peers,
    close() {
      offCommit();
      offChangesets();
      offLoad();
      for (const c of clients.values()) c.channel.close?.();
      clients.clear();
    },
  };
}
