import {
  type Actor,
  type ApplyResult,
  type Change,
  type Changeset,
  createStore,
  type HistoryEntry,
  type Issue,
  LOCAL_USER,
  type ProposeResult,
  type SiteDoc,
  Store,
  type StoreOptions,
  summarize,
  type TransactionInput,
} from '@bowerbirdjs/core';
import type { Channel, ClientMessage, Peer, PresenceState, ServerMessage } from './protocol.js';

/** Applies a commit's record changes to a document (the client's copy of the server state). */
export function applyChanges(
  doc: SiteDoc,
  changes: Change[],
  revision: number,
  counters: Record<string, number>,
): SiteDoc {
  const next: SiteDoc = {
    ...doc,
    revision,
    nodes: { ...doc.nodes },
    pages: { ...doc.pages },
    counters: { ...counters },
  };
  let symbols = doc.symbols ? { ...doc.symbols } : undefined;
  for (const c of changes) {
    if (c.kind === 'node') {
      if (c.after) next.nodes[c.id] = c.after;
      else delete next.nodes[c.id];
    } else if (c.kind === 'page') {
      if (c.after) next.pages[c.id] = c.after;
      else delete next.pages[c.id];
    } else if (c.kind === 'symbol') {
      symbols ??= {};
      if (c.after) symbols[c.id] = c.after;
      else delete symbols[c.id];
    } else if (c.kind === 'locales') {
      if (c.after) next.locales = c.after;
      else delete next.locales;
    } else if (c.kind === 'tokens') next.tokens = c.after;
    else next.themes = c.after;
  }
  if (symbols && Object.keys(symbols).length) next.symbols = symbols;
  else delete next.symbols;
  return next;
}

interface Pending {
  id: string;
  input: TransactionInput;
  /** The local history entry for the optimistic change (replaced when the server confirms). */
  entry?: HistoryEntry;
}

export interface SyncClientOptions {
  actor: Actor;
  /** Called with errors the server sent back (refused changes). */
  onError?: (errors: Issue[]) => void;
}

/**
 * A store that stays in sync with a server. Changes apply locally at once (optimistic) and are
 * sent to the server; when the server's version comes back, local changes it hasn't seen yet are
 * replayed on top of it. Undo, redo and changeset actions run on the server.
 */
export class SyncedStore extends Store {
  /** Peers (other people and agents), updated by the server. */
  peers: Peer[] = [];
  /** Set once the server has sent its document. */
  connected = false;
  private channel: Channel<ServerMessage, ClientMessage> | undefined;
  private confirmed: SiteDoc;
  private serverHistory: HistoryEntry[] = [];
  private pending: Pending[] = [];
  private counter = 0;
  private clientId = '';
  private readonly peerListeners = new Set<(peers: Peer[]) => void>();
  private readonly errorListeners = new Set<(errors: Issue[]) => void>();
  private syncActor: Actor = LOCAL_USER;

  constructor(options: StoreOptions) {
    super(options);
    this.confirmed = this.doc;
  }

  /** Connects to a server and replaces the local document with the server's. */
  connect(channel: Channel<ServerMessage, ClientMessage>, options: SyncClientOptions): void {
    this.channel = channel;
    this.syncActor = options.actor;
    if (options.onError) this.errorListeners.add(options.onError);
    channel.receive((message) => this.receive(message));
    channel.closed?.(() => {
      this.connected = false;
      this.channel = undefined;
    });
    channel.send({ type: 'hello', actor: options.actor });
  }

  /** The id the server gave this client (empty until connected). */
  get id(): string {
    return this.clientId;
  }

  onPeers(listener: (peers: Peer[]) => void): () => void {
    this.peerListeners.add(listener);
    return () => this.peerListeners.delete(listener);
  }

  onSyncError(listener: (errors: Issue[]) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Shares what this person is doing (page, selection, editing). */
  setPresence(state: PresenceState): void {
    this.channel?.send({ type: 'presence', state });
  }

  disconnect(): void {
    this.channel?.close?.();
    this.channel = undefined;
    this.connected = false;
  }

  // -------------------------------------------------------------------------------------------
  // Store API, routed through the server when connected

  override apply(input: TransactionInput): ApplyResult {
    if (!this.channel || input.dryRun) return super.apply(input);
    const result = super.apply(input);
    if (!result.ok || !result.txId) return result;
    const id = `${this.clientId}-${++this.counter}`;
    this.pending.push({ id, input, entry: this.history.at(-1)! });
    this.channel.send({
      type: 'tx',
      id,
      input: {
        ops: input.ops,
        ...(input.label ? { label: input.label } : {}),
        ...(input.overwrite ? { overwrite: true } : {}),
      },
    });
    return result;
  }

  override undo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    if (!this.channel) return super.undo(options);
    const actorId = options.actorId ?? this.syncActor.id;
    this.channel.send(
      actorId === this.syncActor.id ? { type: 'undo' } : { type: 'undo-by', actorId },
    );
    return this.sent('Undo sent to the server.');
  }

  override redo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    if (!this.channel) return super.redo(options);
    this.channel.send({ type: 'redo' });
    return this.sent('Redo sent to the server.');
  }

  override propose(input: TransactionInput): ProposeResult {
    if (!this.channel) return super.propose(input);
    // Validate locally first, so the caller gets errors right away.
    const check = this.simulate(input);
    if (!check.result.ok) return check.result;
    this.channel.send({
      type: 'propose',
      id: `${this.clientId}-${++this.counter}`,
      input: { ops: input.ops, ...(input.label ? { label: input.label } : {}) },
    });
    const provisional: Changeset = {
      id: 'pending',
      actor: input.actor ?? this.syncActor,
      ...(input.label ? { label: input.label } : {}),
      ops: [],
      status: [],
      needs: [],
      baseRevision: this.doc.revision,
      created: Date.now(),
      summary: check.result.summary,
      warnings: check.result.warnings,
    };
    return { ok: true, changeset: provisional, warnings: check.result.warnings };
  }

  override acceptChangeset(id: string, options: { by: Actor; ops?: number[] }): ApplyResult {
    if (!this.channel) return super.acceptChangeset(id, options);
    this.channel.send({
      type: 'accept',
      changeset: id,
      ...(options.ops ? { ops: options.ops } : {}),
    });
    return this.sent('Sent to the server.');
  }

  override rejectChangeset(id: string, options: { by: Actor; ops?: number[] }) {
    if (!this.channel) return super.rejectChangeset(id, options);
    this.channel.send({
      type: 'reject',
      changeset: id,
      ...(options.ops ? { ops: options.ops } : {}),
    });
    return { ok: true, errors: [], rejected: options.ops ?? [] };
  }

  private sent(message: string): ApplyResult {
    return {
      ok: true,
      txId: null,
      revision: this.doc.revision,
      summary: summarize([]),
      dryRun: false,
      warnings: [{ code: 'no_change', message }],
    };
  }

  // -------------------------------------------------------------------------------------------
  // Server messages

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.clientId = message.clientId;
        this.connected = true;
        this.confirmed = message.doc;
        this.serverHistory = [...message.history];
        this.pending = [];
        this.replace(message.doc, {
          history: this.serverHistory,
          changesets: message.changesets,
          reset: true,
        });
        this.setPeers(message.peers);
        return;
      case 'reset':
        this.confirmed = message.doc;
        this.serverHistory = [...message.history];
        this.pending = [];
        this.replace(message.doc, {
          history: this.serverHistory,
          changesets: message.changesets,
          reset: true,
        });
        return;
      case 'commit': {
        this.confirmed = applyChanges(
          this.confirmed,
          message.changes,
          message.revision,
          message.counters,
        );
        this.serverHistory.push(message.entry);
        const mine = message.source?.clientId === this.clientId;
        if (mine) this.pending = this.pending.filter((p) => p.id !== message.source!.id);
        this.rebase(message.entry);
        return;
      }
      case 'rejected': {
        if (message.id) {
          this.pending = this.pending.filter((p) => p.id !== message.id);
          this.rebase();
        }
        if (message.errors.length) for (const l of this.errorListeners) l(message.errors);
        return;
      }
      case 'changesets':
        this.replace(this.doc, { changesets: message.changesets });
        return;
      case 'peers':
        this.setPeers(message.peers.filter((p) => p.clientId !== this.clientId));
        return;
    }
  }

  private setPeers(peers: Peer[]): void {
    this.peers = peers;
    for (const l of this.peerListeners) l(peers);
  }

  /**
   * Rebuilds the local document: the server's state plus local changes it hasn't confirmed yet,
   * replayed in order. Local changes that no longer apply are dropped and reported.
   */
  private rebase(entry?: HistoryEntry): void {
    const scratch = createStore({
      registry: this.registry,
      doc: this.confirmed,
      policy: this.policy,
    });
    const dropped: Issue[] = [];
    this.pending = this.pending.filter((p) => {
      const result = scratch.apply(p.input);
      if (!result.ok) {
        dropped.push(...result.errors);
        return false;
      }
      p.entry = scratch.history.at(-1) ?? p.entry;
      return true;
    });
    const history = [
      ...this.serverHistory,
      ...this.pending.flatMap((p) => (p.entry ? [p.entry] : [])),
    ];
    this.replace(scratch.doc, { history, ...(entry ? { entry } : {}) });
    if (dropped.length) for (const l of this.errorListeners) l(dropped);
  }
}

/** A store with the given options that syncs over `channel` as `actor`. */
export function connectStore(
  options: StoreOptions,
  channel: Channel<ServerMessage, ClientMessage>,
  client: SyncClientOptions,
): SyncedStore {
  const store = new SyncedStore(options);
  store.connect(channel, client);
  return store;
}
