import type { Actor, ApplyResult, Changeset, Issue, SiteDoc, Store } from '@bowerbirdjs/core';
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

/** How many handled change ids the server remembers, so changes resent after a reconnect apply once. */
const REMEMBERED = 5000;
const MAX_ID = 100;

export interface SyncServerOptions {
  /**
   * Decides who a connecting client is, from the actor it claims and the `context` the host passed
   * to `connect` (e.g. the HTTP request, to read a session cookie). Return `undefined` to refuse.
   * Default: trust the claimed person or agent (never the system). Hosts should authenticate.
   */
  authenticate?: (claimed: Actor, context: unknown) => Actor | undefined;
  /** How long an agent working on the server (e.g. over MCP) shows as present. Default 20 s. */
  agentPresenceMs?: number;
  /** Most clients served at once; more are refused. Default 64. */
  maxClients?: number;
  /** Presence is broadcast at most this often (ms). Default 50; 0 broadcasts every update. */
  presenceThrottleMs?: number;
}

export interface SyncServer {
  /** Serves one client over a channel until it closes. `context` is passed to `authenticate`. */
  connect(channel: Channel<ClientMessage, ServerMessage>, context?: unknown): void;
  /** Connected peers, including agents working directly on the server store. */
  peers(): Peer[];
  /**
   * Shows an agent that works on the store directly (not through a client) as present, e.g. on
   * each MCP tool call. Commits and proposals by such agents do this by themselves.
   */
  touch(actor: Actor, state?: PresenceState): void;
  close(): void;
}

interface Client {
  id: string;
  channel: Channel<ClientMessage, ServerMessage>;
  context: unknown;
  actor?: Actor;
  peer?: Peer;
}

type CommitMessage = Extract<ServerMessage, { type: 'commit' }>;

const defaultAuthenticate = (claimed: Actor): Actor | undefined => {
  const c = claimed as Partial<Actor> | null;
  if (!c || (c.kind !== 'user' && c.kind !== 'agent') || typeof c.id !== 'string' || !c.id)
    return undefined;
  return {
    kind: c.kind,
    id: c.id.slice(0, MAX_ID),
    ...(typeof c.name === 'string' ? { name: c.name.slice(0, MAX_ID) } : {}),
  };
};

const openChangesets = (changesets: readonly Changeset[]) =>
  changesets.filter((c) => c.status.includes('open'));

/** The outermost of the given node ids (the one the others are nested in, if any). */
const outermost = (ids: string[]) =>
  ids.find((id) => !ids.some((o) => o !== id && id.startsWith(`${o}/`)));

/**
 * The authoritative side of sync: every change is applied to the server's store (so policy,
 * validation and history live in one place) and broadcast to all clients as record changes.
 * Agents can work on the same store directly (e.g. through the MCP server); they show up in
 * presence from their commits, proposals and `touch`.
 */
export function createSyncServer(store: Store, options: SyncServerOptions = {}): SyncServer {
  const clients = new Map<string, Client>();
  const agents = new Map<string, { peer: Peer; timer: ReturnType<typeof setTimeout> }>();
  /** Handled change ids (per actor) and the errors they got (empty when applied). */
  const handled = new Map<string, Issue[]>();
  const seenChangesets = new Set(store.changesets.map((c) => c.id));
  let counter = 0;
  /** While a client's message runs: its commits go to it afterwards, with what only it needs. */
  let running: { client: Client; queue: CommitMessage[] } | undefined;
  let lastTokenEdits: SiteDoc['tokenEdits'] = store.doc.tokenEdits;
  const authenticate = options.authenticate ?? defaultAuthenticate;
  const agentMs = options.agentPresenceMs ?? 20_000;
  const maxClients = options.maxClients ?? 64;
  const throttle = options.presenceThrottleMs ?? 50;

  const colorFor = (key: string) => {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length]!;
  };
  const isClient = (actorId: string) => [...clients.values()].some((c) => c.actor?.id === actorId);
  const peers = (): Peer[] => [
    ...[...clients.values()].flatMap((c) => (c.peer ? [c.peer] : [])),
    ...[...agents.values()].map((a) => a.peer),
  ];
  const broadcast = (message: ServerMessage, except?: string) => {
    for (const c of clients.values()) if (c.actor && c.id !== except) c.channel.send(message);
  };

  // Presence: the first update goes out at once, later ones are coalesced.
  let peersTimer: ReturnType<typeof setTimeout> | undefined;
  let peersSent = 0;
  const sendPeers = () => {
    peersSent = Date.now();
    broadcast({ type: 'peers', peers: peers() });
  };
  const schedulePeers = () => {
    if (throttle <= 0) return sendPeers();
    if (peersTimer) return;
    const wait = peersSent + throttle - Date.now();
    if (wait <= 0) return sendPeers();
    peersTimer = setTimeout(() => {
      peersTimer = undefined;
      sendPeers();
    }, wait);
  };

  const touch = (actor: Actor, state: PresenceState = {}) => {
    if (isClient(actor.id)) return;
    const previous = agents.get(actor.id);
    if (previous) clearTimeout(previous.timer);
    const pick = <K extends keyof PresenceState>(key: K) =>
      state[key] !== undefined ? (state[key] ?? null) : (previous?.peer[key] ?? null);
    const peer: Peer = {
      clientId: `agent:${actor.id}`,
      actor,
      color: colorFor(actor.id),
      page: pick('page'),
      selection: pick('selection'),
      editing: null,
      activity: pick('activity'),
      at: Date.now(),
    };
    const timer = setTimeout(() => {
      agents.delete(actor.id);
      schedulePeers();
    }, agentMs);
    (timer as { unref?: () => void }).unref?.();
    agents.set(actor.id, { peer, timer });
    schedulePeers();
  };

  const offCommit = store.subscribe(({ entry, doc }) => {
    const tokenEdits = doc.tokenEdits !== lastTokenEdits ? (doc.tokenEdits ?? null) : undefined;
    lastTokenEdits = doc.tokenEdits;
    const message: CommitMessage = {
      type: 'commit',
      revision: doc.revision,
      counters: { ...(doc.counters ?? {}) },
      entry,
      ...(tokenEdits !== undefined ? { tokenEdits } : {}),
    };
    if (running) running.queue.push(message);
    broadcast(message, running?.client.id);
    // Agents working on the store directly appear as peers for a while. A person accepting an
    // agent's proposal is the person's action, not the agent at work.
    if (entry.actor.kind === 'agent' && !entry.approvedBy && !isClient(entry.actor.id)) {
      const touched = entry.changes.flatMap((ch) =>
        ch.kind === 'node' && ch.after ? [ch.id] : [],
      );
      touch(entry.actor, { selection: outermost(touched) ?? null, activity: entry.label ?? null });
    }
  });
  const offChangesets = store.onChangesets((changesets) => {
    broadcast({ type: 'changesets', changesets: openChangesets(changesets) });
    for (const c of changesets) {
      if (seenChangesets.has(c.id)) continue;
      seenChangesets.add(c.id);
      if (c.actor.kind === 'agent' && c.status.includes('open')) {
        const ids = [...c.summary.created, ...c.summary.updated];
        touch(c.actor, {
          selection: outermost(ids) ?? null,
          activity: `Proposed: ${c.label ?? c.id}`,
        });
      }
    }
  });
  const offLoad = store.onLoad((doc) => {
    lastTokenEdits = doc.tokenEdits;
    // A new document starts its changeset ids over.
    seenChangesets.clear();
    broadcast({
      type: 'reset',
      doc,
      history: [...store.history],
      changesets: openChangesets(store.changesets),
    });
  });

  /** Only these fields of a client's transaction are used; the actor always comes from the server. */
  const input = (raw: unknown) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      ops: Array.isArray(i.ops) ? i.ops : [],
      ...(typeof i.label === 'string' ? { label: i.label.slice(0, 200) } : {}),
      ...(i.overwrite === true ? { overwrite: true } : {}),
    };
  };
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && id.length > 0 && id.length <= MAX_ID;
  const handledKey = (actor: Actor, id: string) => `${actor.id}\u0000${id}`;
  const remember = (key: string, errors: Issue[]) => {
    handled.set(key, errors);
    if (handled.size > REMEMBERED) handled.delete(handled.keys().next().value!);
  };

  /**
   * Runs a client's action. Commits it causes are sent to that client afterwards (in order), the
   * first one with what only it needs: its change id, renamed ids and warnings.
   */
  const runFor = <R extends ApplyResult>(
    client: Client,
    id: string | undefined,
    action: () => R,
  ) => {
    const outer = running;
    running = { client, queue: [] };
    let result: R;
    let queue: CommitMessage[];
    try {
      result = action();
    } finally {
      queue = running.queue;
      running = outer;
    }
    queue.forEach((message, i) => {
      const extra =
        i === 0 && id !== undefined && result.ok
          ? {
              source: {
                clientId: client.id,
                id,
                ...(result.renamed ? { renamed: result.renamed } : {}),
                ...(result.warnings.length ? { warnings: result.warnings } : {}),
              },
            }
          : {};
      client.channel.send({ ...message, ...extra });
    });
    return result;
  };

  const reject = (client: Client, errors: Issue[], id?: string) =>
    client.channel.send({ type: 'rejected', ...(id !== undefined ? { id } : {}), errors });

  function handle(client: Client, message: ClientMessage) {
    if (message.type === 'hello') {
      if (client.actor) {
        reject(client, [{ code: 'invalid_op', message: 'Already connected on this channel.' }]);
        return;
      }
      const actor = authenticate(message.actor, client.context);
      if (!actor || (actor.kind !== 'user' && actor.kind !== 'agent')) {
        reject(client, [{ code: 'policy', message: 'Not allowed to connect.' }]);
        client.channel.close?.();
        return;
      }
      client.actor = actor;
      client.peer = { clientId: client.id, actor, color: colorFor(actor.id), at: Date.now() };
      // A person or agent connecting as a client shows up through that client, not as an agent.
      const asAgent = agents.get(actor.id);
      if (asAgent) {
        clearTimeout(asAgent.timer);
        agents.delete(actor.id);
      }
      const pending = Array.isArray(message.pending) ? message.pending.slice(0, 1000) : [];
      const settled = pending.flatMap((id) => {
        const errors = validId(id) ? handled.get(handledKey(actor, id)) : undefined;
        return errors ? [{ id, errors }] : [];
      });
      client.channel.send({
        type: 'welcome',
        clientId: client.id,
        actor,
        doc: store.doc,
        history: [...store.history],
        changesets: openChangesets(store.changesets),
        peers: peers(),
        ...(settled.length ? { settled } : {}),
      });
      schedulePeers();
      return;
    }
    const actor = client.actor;
    if (!actor) {
      reject(client, [{ code: 'invalid_op', message: 'Say hello first.' }]);
      return;
    }
    const id = 'id' in message && validId(message.id) ? message.id : undefined;
    if ('id' in message && message.id !== undefined && id === undefined) {
      reject(client, [
        { code: 'invalid_op', message: `Ids must be strings of 1–${MAX_ID} characters.` },
      ]);
      return;
    }
    switch (message.type) {
      case 'tx': {
        if (id === undefined) {
          reject(client, [{ code: 'invalid_op', message: 'A change needs an id.' }]);
          return;
        }
        const key = handledKey(actor, id);
        const earlier = handled.get(key);
        if (earlier) {
          // Sent again after a reconnect: it was handled already.
          reject(client, earlier, id);
          return;
        }
        // Ids the client created were pinned; if someone took one meanwhile, a fresh one is used.
        const result = runFor(client, id, () =>
          store.apply({ ...input(message.input), actor, renameTaken: true }),
        );
        remember(key, result.ok ? [] : result.errors);
        if (!result.ok) reject(client, result.errors, id);
        // Nothing changed on the server; the client drops the pending change.
        else if (!result.txId) reject(client, [], id);
        return;
      }
      case 'undo':
      case 'redo':
      case 'undo-by': {
        const result = runFor(client, id, () =>
          message.type === 'redo'
            ? store.redo({ actorId: actor.id, actor })
            : store.undo({
                actorId: message.type === 'undo-by' ? String(message.actorId) : actor.id,
                actor,
              }),
        );
        if (!result.ok) reject(client, result.errors, id);
        return;
      }
      case 'propose': {
        const result = store.propose({ ...input(message.input), actor });
        if (!result.ok) reject(client, result.errors, id);
        return;
      }
      case 'accept': {
        const ops = Array.isArray(message.ops) ? message.ops.filter(Number.isInteger) : undefined;
        const result = runFor(client, id, () =>
          store.acceptChangeset(String(message.changeset), { by: actor, ...(ops ? { ops } : {}) }),
        );
        if (!result.ok) reject(client, result.errors, id);
        return;
      }
      case 'reject': {
        const ops = Array.isArray(message.ops) ? message.ops.filter(Number.isInteger) : undefined;
        const result = store.rejectChangeset(String(message.changeset), {
          by: actor,
          ...(ops ? { ops } : {}),
        });
        if (!result.ok) reject(client, result.errors, id);
        return;
      }
      case 'presence': {
        const state: PresenceState = message.state ?? {};
        const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : null);
        client.peer = {
          ...client.peer!,
          page: text(state.page),
          selection: text(state.selection),
          editing: text(state.editing),
          activity: text(state.activity),
          at: Date.now(),
        };
        schedulePeers();
        return;
      }
    }
  }

  return {
    connect(channel, context) {
      if (clients.size >= maxClients) {
        channel.send({
          type: 'rejected',
          errors: [{ code: 'policy', message: 'Too many connections; try again later.' }],
        });
        channel.close?.();
        return;
      }
      const client: Client = { id: `c${++counter}`, channel, context };
      clients.set(client.id, client);
      channel.receive((message) => {
        if (!clients.has(client.id)) return;
        try {
          handle(client, message);
        } catch (error) {
          reject(client, [{ code: 'invalid_op', message: `Sync failed: ${String(error)}` }]);
        }
      });
      channel.closed?.(() => {
        if (!clients.delete(client.id)) return;
        schedulePeers();
      });
    },
    peers,
    touch,
    close() {
      offCommit();
      offChangesets();
      offLoad();
      clearTimeout(peersTimer);
      for (const a of agents.values()) clearTimeout(a.timer);
      agents.clear();
      for (const c of clients.values()) c.channel.close?.();
      clients.clear();
    },
  };
}
