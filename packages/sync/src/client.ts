import {
  type Actor,
  type ApplyResult,
  type Change,
  type Changeset,
  createStore,
  type HistoryEntry,
  type Issue,
  type Op,
  opIdUse,
  type ProposeResult,
  renameOpIds,
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
  /** Token provenance from the commit: `null` clears it, `undefined` keeps it. */
  tokenEdits?: SiteDoc['tokenEdits'] | null,
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
  if (tokenEdits === null) delete next.tokenEdits;
  else if (tokenEdits) next.tokenEdits = tokenEdits;
  return next;
}

interface Pending {
  id: string;
  /** As applied locally, with the ids it created pinned (so the server creates the same ones). */
  input: TransactionInput;
  /** The local history entry for the optimistic change (replaced when the server confirms). */
  entry?: HistoryEntry;
  /** It creates nodes, pages or symbols: later changes wait until the server confirms it. */
  creates: boolean;
  /** Sent on the current connection. */
  sent: boolean;
}

export interface SyncClientOptions {
  /** Who this client says it is; the server may decide otherwise (see `SyncedStore.actor`). */
  actor: Actor;
  /** Called with errors the server sent back (refused changes). */
  onError?: (errors: Issue[]) => void;
}

/**
 * A store that stays in sync with a server. Changes apply locally at once (optimistic) and are
 * sent to the server; when the server's version comes back, local changes it hasn't confirmed yet
 * are replayed on top of it. Changes made while disconnected are kept and sent after
 * reconnecting. Undo, redo and changeset actions run on the server (and need a connection).
 *
 * Commit listeners hear each local change twice: when it is made, and with `echo: true` when the
 * server's version replaces it.
 */
export class SyncedStore extends Store {
  /** Peers (other people and agents), updated by the server. */
  peers: Peer[] = [];
  /** True while connected (the server has sent its document). */
  connected = false;
  private channel: Channel<ServerMessage, ClientMessage> | undefined;
  /** The channel messages are read from (the latest one; it stays set after it closes). */
  private listening: Channel<ServerMessage, ClientMessage> | undefined;
  /** Set between `connect` and `disconnect`: changes are queued for the server. */
  private syncing = false;
  private welcomed = false;
  private confirmed: SiteDoc;
  private serverHistory: HistoryEntry[] = [];
  private pending: Pending[] = [];
  private counter = 0;
  /** Prefix for change ids: unique per store, so ids stay unique across reconnects. */
  private readonly session = Math.random().toString(36).slice(2, 10);
  private clientId = '';
  private claimed: Actor | undefined;
  private serverActor: Actor | undefined;
  private presence: PresenceState | undefined;
  private readonly limit: number;
  private readonly peerListeners = new Set<(peers: Peer[]) => void>();
  private readonly errorListeners = new Set<(errors: Issue[]) => void>();
  private readonly warningListeners = new Set<(warnings: Issue[]) => void>();
  private readonly statusListeners = new Set<(connected: boolean) => void>();
  private readonly renameListeners = new Set<(renamed: Record<string, string>) => void>();

  constructor(options: StoreOptions) {
    super(options);
    this.confirmed = this.doc;
    this.limit = options.historyLimit ?? 500;
  }

  /**
   * Connects to a server. The first connection replaces the local document with the server's;
   * after a reconnect (a new channel, or one that reconnects by itself), unconfirmed local changes
   * are sent again.
   */
  connect(channel: Channel<ServerMessage, ClientMessage>, options: SyncClientOptions): void {
    if (this.channel && this.channel !== channel) this.channel.close?.();
    this.channel = channel;
    this.listening = channel;
    this.syncing = true;
    this.connected = false;
    this.claimed = options.actor;
    if (options.onError) this.errorListeners.add(options.onError);
    // Messages sent just before a channel closed (e.g. why the server refused) still count.
    channel.receive((message) => {
      if (this.listening === channel) this.receive(message);
    });
    channel.closed?.(() => {
      if (this.channel !== channel) return;
      const was = this.connected;
      this.connected = false;
      // Channels that reconnect by themselves say so with `opened`; others are done.
      if (!channel.opened) this.channel = undefined;
      if (was) this.emitStatus();
    });
    const hello = () => {
      if (this.channel !== channel) return;
      channel.send({
        type: 'hello',
        actor: options.actor,
        ...(this.pending.length ? { pending: this.pending.map((p) => p.id) } : {}),
      });
    };
    if (channel.opened) channel.opened(hello);
    else hello();
  }

  /** The id the server gave this client (empty until connected). */
  get id(): string {
    return this.clientId;
  }

  /** Who the server says this client is (set once connected). Edits are attributed to it. */
  get actor(): Actor | undefined {
    return this.serverActor;
  }

  /** Local changes the server hasn't confirmed yet. */
  get unconfirmed(): number {
    return this.pending.length;
  }

  onPeers(listener: (peers: Peer[]) => void): () => void {
    this.peerListeners.add(listener);
    return () => this.peerListeners.delete(listener);
  }

  /** Errors from the server: refused changes, undo/accept failures, changes that no longer apply. */
  onSyncError(listener: (errors: Issue[]) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Warnings the server reported for this client's changes (e.g. overwriting a person's edit). */
  onSyncWarning(listener: (warnings: Issue[]) => void): () => void {
    this.warningListeners.add(listener);
    return () => this.warningListeners.delete(listener);
  }

  /** Connection changes (connected, or disconnected and waiting to reconnect). */
  onStatus(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Ids a local change created that were taken on the server by the time it arrived, and the ids
   * used instead (later local changes are rewritten to match). Editors move selections with it.
   */
  onRenamed(listener: (renamed: Record<string, string>) => void): () => void {
    this.renameListeners.add(listener);
    return () => this.renameListeners.delete(listener);
  }

  /** Shares what this person is doing (page, selection, editing). Re-sent after reconnecting. */
  setPresence(state: PresenceState): void {
    this.presence = state;
    if (this.connected) this.channel?.send({ type: 'presence', state });
  }

  /** Stops syncing. Later changes are local only. */
  disconnect(): void {
    const channel = this.channel;
    this.channel = undefined;
    this.syncing = false;
    const was = this.connected;
    this.connected = false;
    channel?.close?.();
    if (was) this.emitStatus();
  }

  // -------------------------------------------------------------------------------------------
  // Store API, routed through the server while syncing

  override apply(input: TransactionInput): ApplyResult {
    if (!this.syncing || input.dryRun) return super.apply(input);
    const result = super.apply({ ...input, pinIds: true });
    if (!result.ok || !result.txId) return result;
    const { pinned, ...rest } = result;
    const ops = pinned ?? (input.ops as Op[]);
    this.pending.push({
      id: `${this.session}-${++this.counter}`,
      input: { ...input, ops },
      entry: this.history.at(-1)!,
      creates:
        result.summary.created.length > 0 ||
        ops.some((op) => op.op === 'page.create' || op.op === 'symbol.create'),
      sent: false,
    });
    this.flush();
    return rest;
  }

  override undo(
    options: { actorId?: string; actor?: Actor; overwrite?: boolean } = {},
  ): ApplyResult {
    if (!this.syncing) return super.undo(options);
    if (!this.connected) return this.offline();
    const actorId = options.actorId;
    const own = !actorId || actorId === this.claimed?.id || actorId === this.serverActor?.id;
    const overwrite = options.overwrite ? { overwrite: true } : {};
    this.channel!.send(
      own
        ? { type: 'undo', id: this.nextId(), ...overwrite }
        : { type: 'undo-by', actorId, id: this.nextId(), ...overwrite },
    );
    return this.sent('Undo sent to the server.');
  }

  override redo(
    options: { actorId?: string; actor?: Actor; overwrite?: boolean } = {},
  ): ApplyResult {
    if (!this.syncing) return super.redo(options);
    if (!this.connected) return this.offline();
    this.channel!.send({
      type: 'redo',
      id: this.nextId(),
      ...(options.overwrite ? { overwrite: true } : {}),
    });
    return this.sent('Redo sent to the server.');
  }

  override propose(input: TransactionInput): ProposeResult {
    if (!this.syncing) return super.propose(input);
    if (!this.connected) return this.offline();
    // Validate locally first, so the caller gets errors right away.
    const check = this.simulate(input);
    if (!check.result.ok) return check.result;
    this.channel!.send({
      type: 'propose',
      id: this.nextId(),
      input: { ops: input.ops, ...(input.label ? { label: input.label } : {}) },
    });
    const provisional: Changeset = {
      id: 'pending',
      actor: input.actor ?? this.serverActor ?? this.claimed!,
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
    if (!this.syncing) return super.acceptChangeset(id, options);
    if (!this.connected) return this.offline();
    this.channel!.send({
      type: 'accept',
      changeset: id,
      id: this.nextId(),
      ...(options.ops ? { ops: options.ops } : {}),
    });
    return this.sent('Sent to the server.');
  }

  override rejectChangeset(id: string, options: { by: Actor; ops?: number[] }) {
    if (!this.syncing) return super.rejectChangeset(id, options);
    if (!this.connected) return { ...this.offline(), rejected: [] as number[] };
    this.channel!.send({
      type: 'reject',
      changeset: id,
      id: this.nextId(),
      ...(options.ops ? { ops: options.ops } : {}),
    });
    return { ok: true, errors: [], rejected: options.ops ?? [] };
  }

  private nextId(): string {
    return `${this.session}-${++this.counter}`;
  }

  /**
   * Sends unsent changes in order. A change that creates ids holds back the ones after it until
   * the server confirms it: the server may have had to use other ids, and later changes are
   * rewritten to match before they go out.
   */
  private flush(): void {
    if (!this.connected) return;
    for (const p of this.pending) {
      if (!p.sent) {
        this.sendChange(p);
        p.sent = true;
      }
      if (p.creates) return;
    }
  }

  private sendChange(p: Pending): void {
    this.channel?.send({
      type: 'tx',
      id: p.id,
      input: {
        ops: p.input.ops,
        ...(p.input.label ? { label: p.input.label } : {}),
        ...(p.input.overwrite ? { overwrite: true } : {}),
      },
    });
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

  private offline(): Extract<ApplyResult, { ok: false }> {
    return {
      ok: false,
      revision: this.doc.revision,
      errors: [
        {
          code: 'offline',
          message: 'Not connected to the server, so this can’t run now.',
          hint: 'Try again once the connection is back. Edits made meanwhile are kept and sent then.',
        },
      ],
    };
  }

  private emitErrors(errors: Issue[]): void {
    for (const l of this.errorListeners) l(errors);
  }

  private emitStatus(): void {
    for (const l of this.statusListeners) l(this.connected);
  }

  // -------------------------------------------------------------------------------------------
  // Server messages

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        const first = !this.welcomed;
        this.welcomed = true;
        this.clientId = message.clientId;
        this.serverActor = message.actor;
        this.connected = true;
        this.confirmed = message.doc;
        this.serverHistory = message.history.slice(-this.limit);
        // Changes the server handled before the connection dropped are already in its document.
        const settled = new Map((message.settled ?? []).map((s) => [s.id, s.errors]));
        // What refused changes would have created doesn't exist: changes built on it are dropped.
        const gone = new Set(
          this.pending
            .filter((p) => settled.get(p.id)?.length)
            .flatMap((p) => createdIds(p.input.ops as Op[])),
        );
        this.pending = this.pending.filter((p) => !settled.has(p.id));
        for (const p of this.pending) p.sent = false;
        if (first) {
          this.replace(message.doc, {
            history: this.serverHistory,
            changesets: message.changesets,
            reset: true,
          });
          // Changes made before the server's document arrived are replayed on it.
          if (this.pending.length) this.rebase(undefined, false, gone);
        } else {
          this.replace(this.doc, { changesets: message.changesets });
          this.rebase(undefined, false, gone);
        }
        this.flush();
        if (this.presence) this.channel?.send({ type: 'presence', state: this.presence });
        this.setPeers(message.peers.filter((p) => p.clientId !== this.clientId));
        const errors = [...settled.values()].flat();
        if (errors.length) this.emitErrors(errors);
        this.emitStatus();
        return;
      }
      case 'reset':
        // A different document: local changes don't apply to it.
        this.confirmed = message.doc;
        this.serverHistory = message.history.slice(-this.limit);
        this.pending = [];
        this.replace(message.doc, {
          history: this.serverHistory,
          changesets: message.changesets,
          reset: true,
        });
        return;
      case 'commit': {
        const { entry } = message;
        this.confirmed = applyChanges(
          this.confirmed,
          entry.changes,
          message.revision,
          message.counters,
          message.tokenEdits,
        );
        this.serverHistory.push(entry);
        if (this.serverHistory.length > this.limit)
          this.serverHistory.splice(0, this.serverHistory.length - this.limit);
        // The server marks what an undo or redo reverted; mirror it on our copy of that entry.
        if (entry.kind !== 'edit' && entry.target) {
          const target = this.serverHistory.find((e) => e.txId === entry.target);
          if (target && entry.kind === 'undo') target.undone = true;
          else if (target) target.redone = true;
        }
        const source = message.source;
        let echo = false;
        if (source) {
          const index = this.pending.findIndex((p) => p.id === source.id);
          if (index >= 0) {
            this.pending.splice(index, 1);
            echo = true;
          }
          if (source.renamed) {
            const map = new Map(Object.entries(source.renamed));
            for (const p of this.pending)
              p.input = {
                ...p.input,
                ops: (p.input.ops as Op[]).map((op) => renameOpIds(op, map)),
              };
          }
        }
        this.rebase(entry, echo);
        this.flush();
        if (source?.renamed) for (const l of this.renameListeners) l(source.renamed);
        if (source?.warnings?.length) for (const l of this.warningListeners) l(source.warnings);
        return;
      }
      case 'rejected': {
        const index = message.id ? this.pending.findIndex((p) => p.id === message.id) : -1;
        if (index >= 0) {
          const [refused] = this.pending.splice(index, 1);
          this.rebase(undefined, false, new Set(createdIds(refused!.input.ops as Op[])));
          this.flush();
        }
        if (message.errors.length) this.emitErrors(message.errors);
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
  private rebase(entry?: HistoryEntry, echo = false, gone = new Set<string>()): void {
    const scratch = createStore({
      registry: this.registry,
      doc: this.confirmed,
      policy: this.policy,
    });
    const dropped: Issue[] = [];
    // Ids taken meanwhile get fresh local ones until the server says which it used.
    const local = new Map<string, string>();
    this.pending = this.pending.filter((p) => {
      const ops = local.size
        ? (p.input.ops as Op[]).map((op) => renameOpIds(op, local))
        : (p.input.ops as Op[]);
      // A change that builds on something a refused change would have created (a page made
      // offline whose path was taken meanwhile) would land on whatever has that id now: drop it.
      const missing = ops
        .flatMap((op) => opIdUse(op).refers)
        .find((id) => [...gone].some((g) => id === g || id.startsWith(`${g}/`)));
      if (missing) {
        dropped.push({
          code: 'conflict',
          message: `A change of yours was dropped: it used "${missing}", which an earlier change of yours would have created, but that change was refused.`,
        });
        for (const id of createdIds(ops)) gone.add(id);
        return false;
      }
      const result = scratch.apply({ ...p.input, ops, renameTaken: true });
      if (!result.ok) {
        dropped.push(...result.errors);
        for (const id of createdIds(ops)) gone.add(id);
        return false;
      }
      for (const [from, to] of Object.entries(result.renamed ?? {})) local.set(from, to);
      p.entry = result.txId ? scratch.history.at(-1) : undefined;
      return true;
    });
    const history = [
      ...this.serverHistory,
      ...this.pending.flatMap((p) => (p.entry ? [p.entry] : [])),
    ];
    this.replace(scratch.doc, {
      history,
      ...(entry ? { entry } : {}),
      ...(echo ? { echo: true } : {}),
    });
    if (dropped.length) this.emitErrors(dropped);
  }
}

/** Ids a change's ops create (pinned ids). */
function createdIds(ops: Op[]): string[] {
  return ops.flatMap((op) => opIdUse(op).creates);
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
