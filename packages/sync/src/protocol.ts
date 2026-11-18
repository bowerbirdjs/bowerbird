import type {
  Actor,
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

/** A client's transaction, as sent to the server (actor and revision come from the server). */
export type WireInput = Omit<
  TransactionInput,
  'actor' | 'baseRevision' | 'dryRun' | 'pinIds' | 'renameTaken'
>;

/**
 * `id`s are chosen by the client and unique per client session; the server echoes them so the
 * client can match results (and, after a reconnect, knows which changes it already applied).
 */
export type ClientMessage =
  | {
      type: 'hello';
      actor: Actor;
      /** Ids of changes this client sent before and hasn't seen confirmed (after a reconnect). */
      pending?: string[];
    }
  | { type: 'tx'; id: string; input: WireInput }
  | { type: 'undo' | 'redo'; id?: string }
  | { type: 'undo-by'; actorId: string; id?: string }
  | { type: 'propose'; id: string; input: WireInput }
  | { type: 'accept' | 'reject'; changeset: string; ops?: number[]; id?: string }
  | { type: 'presence'; state: PresenceState };

export type ServerMessage =
  | {
      type: 'welcome';
      clientId: string;
      /** Who the server says this client is (it may differ from the actor the client claimed). */
      actor: Actor;
      doc: SiteDoc;
      history: WireEntry[];
      /** Open changesets. */
      changesets: readonly Changeset[];
      peers: Peer[];
      /** Of the `pending` ids in `hello`: those the server already handled, with any errors. */
      settled?: { id: string; errors: Issue[] }[];
    }
  | {
      type: 'commit';
      revision: number;
      counters: Record<string, number>;
      entry: WireEntry;
      /** Provenance of design tokens, when it changed. */
      tokenEdits?: SiteDoc['tokenEdits'] | null;
      /** Only sent to the client whose message caused the commit. */
      source?: {
        clientId: string;
        id: string;
        /** Ids the client's change created that were taken on the server, and what was used. */
        renamed?: Record<string, string>;
        warnings?: Issue[];
      };
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
  /**
   * For channels that reconnect by themselves (e.g. `httpChannel`): registers a handler called
   * each time the connection is (re)established. Channels without it are open at once, and
   * closing them is final.
   */
  opened?(handler: () => void): void;
  /** Registers a handler for when the other side goes away (for now, with `opened`). */
  closed?(handler: () => void): void;
  close?(): void;
}
