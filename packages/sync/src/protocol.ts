import type {
  Actor,
  Change,
  Changeset,
  HistoryEntry,
  Issue,
  SiteDoc,
  TransactionInput,
} from '@bowerbirdjs/core';

/** What a person or agent is doing right now, shown to everyone else. */
export interface PresenceState {
  page?: string | null;
  /** Selected node id. */
  selection?: string | null;
  /** Node being edited inline. */
  editing?: string | null;
  /** Short description of current activity, e.g. an agent's change label. */
  activity?: string | null;
}

export interface Peer extends PresenceState {
  clientId: string;
  actor: Actor;
  /** CSS colour for this peer's cursors and labels. */
  color: string;
  /** Last update (ms since epoch). */
  at: number;
}

/** A history entry as sent over the wire. */
export type WireEntry = HistoryEntry;

export type ClientMessage =
  | { type: 'hello'; actor: Actor }
  | { type: 'tx'; id: string; input: Omit<TransactionInput, 'actor' | 'baseRevision' | 'dryRun'> }
  | { type: 'undo' | 'redo' }
  | { type: 'undo-by'; actorId: string }
  | {
      type: 'propose';
      id: string;
      input: Omit<TransactionInput, 'actor' | 'baseRevision' | 'dryRun'>;
    }
  | { type: 'accept' | 'reject'; changeset: string; ops?: number[] }
  | { type: 'presence'; state: PresenceState };

export type ServerMessage =
  | {
      type: 'welcome';
      clientId: string;
      doc: SiteDoc;
      history: WireEntry[];
      changesets: readonly Changeset[];
      peers: Peer[];
    }
  | {
      type: 'commit';
      revision: number;
      changes: Change[];
      counters: Record<string, number>;
      entry: WireEntry;
      /** Set when the commit is the result of a client's `tx`. */
      source?: { clientId: string; id: string };
    }
  | { type: 'reset'; doc: SiteDoc; history: WireEntry[]; changesets: readonly Changeset[] }
  | { type: 'rejected'; id?: string; errors: Issue[] }
  | { type: 'changesets'; changesets: readonly Changeset[] }
  | { type: 'peers'; peers: Peer[] };

/** One end of a connection. Messages are plain objects; transports serialise them as needed. */
export interface Channel<In, Out> {
  send(message: Out): void;
  /** Registers the message handler. */
  receive(handler: (message: In) => void): void;
  /** Registers a handler for when the other side goes away. */
  closed?(handler: () => void): void;
  close?(): void;
}
