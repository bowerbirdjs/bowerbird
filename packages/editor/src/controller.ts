import {
  type Actor,
  type ApplyResult,
  type BNode,
  type Changeset,
  type CommitEvent,
  definitionOf,
  type Issue,
  LOCAL_USER,
  type NodeInput,
  type Page,
  pageOf,
  renameId,
  type SiteDoc,
  type Store,
  type SymbolDef,
  sectionRootOf,
} from '@bowerbirdjs/core';
import { type EditorFeature, EditorFeatures, type EditorUI } from './features.js';

export type EditorEvent =
  | { type: 'selection'; id: string | null }
  | { type: 'hover'; id: string | null }
  | { type: 'view' }
  | { type: 'commit'; event: CommitEvent }
  | { type: 'store' }
  | { type: 'changesets'; changesets: readonly Changeset[] }
  | { type: 'peers'; peers: readonly PeerPresence[] }
  | { type: 'error'; errors: Issue[]; label?: string }
  /** The person clicked something shown from site data (`path` is `<group>.<path>`). */
  | { type: 'data'; path: string; node: string | null };

/** Someone else in the document (a person or an agent), e.g. from `@bowerbirdjs/sync`. */
export interface PeerPresence {
  clientId: string;
  actor: Actor;
  color: string;
  page?: string | null;
  selection?: string | null;
  editing?: string | null;
  activity?: string | null;
}

/** A store that shares presence (duck-typed, so the editor doesn't depend on a sync package). */
interface PresenceStore {
  onPeers(listener: (peers: PeerPresence[]) => void): () => void;
  setPresence(state: {
    page?: string | null;
    selection?: string | null;
    editing?: string | null;
  }): void;
  peers?: PeerPresence[];
}

const sharesPresence = (store: unknown): store is PresenceStore =>
  typeof (store as PresenceStore).onPeers === 'function' &&
  typeof (store as PresenceStore).setPresence === 'function';

/** What the person can do with the selected node (see `EditorController.selectionActions`). */
export interface SelectionActions {
  delete: boolean;
  duplicate: boolean;
  up: boolean;
  down: boolean;
}

/** A store that syncs with a server (duck-typed, like presence). */
interface SyncingStore {
  /** Who the server says this editor is, once connected. */
  readonly actor?: Actor;
  onSyncError?(listener: (errors: Issue[]) => void): () => void;
  onRenamed?(listener: (renamed: Record<string, string>) => void): () => void;
}

/**
 * Changes shown on the canvas without being applied: an agent's ops while they stream in, or a
 * proposed changeset under review. The canvas renders `doc` read-only and highlights changes.
 */
export interface GhostPreview {
  doc: SiteDoc;
  created: string[];
  updated: string[];
  removed: string[];
  label: string;
  /** Set when previewing a changeset. */
  changeset?: string;
  /** Re-runs the preview against the current document (after other people's edits). */
  refresh(): GhostPreview | null;
}

export interface Position {
  parent?: string;
  before?: string;
  after?: string;
}

/** Preview widths (px) for the default breakpoints; other breakpoints use their min width. */
const PREVIEW_WIDTH: Record<string, number> = { base: 390, md: 820, lg: 1280 };

/**
 * Framework-free editor state and actions: which page, node, breakpoint and zoom are active, and
 * conveniences that turn UI gestures into store transactions. The web component and the canvas
 * both talk to the store only through this controller.
 */
export class EditorController {
  store: Store;
  actor: Actor;
  page: string;
  selected: string | null = null;
  hovered: string | null = null;
  breakpoint: string;
  /** Canvas scale; `fit` scales the preview width down to the available space. */
  zoom: number | 'fit' = 'fit';
  theme: string | null = null;
  /** Hides overlays and disables editing gestures. */
  preview = false;
  /** When set, the canvas shows this symbol's definition instead of a page. */
  symbolView: string | null = null;
  /** Unapplied changes shown on the canvas (read-only while shown). */
  ghost: GhostPreview | null = null;
  /** Language being edited; `null` is the default language (the props themselves). */
  locale: string | null = null;
  /** Other people and agents in the document (when the store shares presence). */
  peers: readonly PeerPresence[] = [];
  /** What the editor offers (see `EditorUI`). Change it with `setUI`. */
  ui: EditorUI = {};
  private resolved:
    | { ui: EditorUI; policy: Store['policy']; actor: Actor; features: EditorFeatures }
    | undefined;
  private readonly listeners = new Set<(event: EditorEvent) => void>();
  private unsubscribe: () => void;

  constructor(store: Store, options: { actor?: Actor; page?: string; ui?: EditorUI } = {}) {
    this.store = store;
    this.actor = options.actor ?? LOCAL_USER;
    if (options.ui) this.ui = options.ui;
    this.page = options.page && store.doc.pages[options.page] ? options.page : this.firstPage();
    this.breakpoint = store.doc.breakpoints.at(-1)?.id ?? 'base';
    this.unsubscribe = this.listen(store);
  }

  private listen(store: Store): () => void {
    const offCommit = store.subscribe((event) => this.onCommit(event));
    const offLoad = store.onLoad(() => this.reset());
    const offChangesets = store.onChangesets((changesets) =>
      this.emit({ type: 'changesets', changesets }),
    );
    // A new policy (e.g. another role) can change what the editor offers.
    const offPolicy = store.onPolicy(() => this.emit({ type: 'view' }));
    let offPeers = () => {};
    if (sharesPresence(store)) {
      this.peers = store.peers ?? [];
      offPeers = store.onPeers((peers) => {
        this.peers = peers;
        this.emit({ type: 'peers', peers });
      });
    }
    const syncing = store as Store & SyncingStore;
    // Refusals and rollbacks from the server would otherwise go unnoticed.
    const offSyncErrors =
      syncing.onSyncError?.((errors) => {
        const shown = errors.filter((e) => e.code !== 'nothing_to_undo');
        if (shown.length) this.emit({ type: 'error', errors: shown, label: 'Sync' });
      }) ?? (() => {});
    // The server used other ids for something this editor created: follow them.
    const offRenamed =
      syncing.onRenamed?.((renamed) => {
        const map = new Map(Object.entries(renamed));
        if (this.hovered) this.hovered = renameId(this.hovered, map);
        if (this.selected) {
          const next = renameId(this.selected, map);
          if (next !== this.selected && this.store.doc.nodes[next]) this.select(next);
        }
      }) ?? (() => {});
    return () => {
      offCommit();
      offLoad();
      offChangesets();
      offPeers();
      offSyncErrors();
      offRenamed();
      offPolicy();
    };
  }

  on(listener: (event: EditorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  /**
   * What the editor offers now: `ui` resolved against the store policy's level for the actor.
   * Gestures (insert, move, duplicate, delete, components, undo) do nothing when theirs is off.
   */
  get features(): EditorFeatures {
    const policy = this.store.policy;
    const r = this.resolved;
    if (r && r.ui === this.ui && r.policy === policy && r.actor === this.actor) return r.features;
    const features = new EditorFeatures(this.ui, policy.level?.(this.actor));
    this.resolved = { ui: this.ui, policy, actor: this.actor, features };
    return features;
  }

  /** Changes what the editor offers. */
  setUI(ui: EditorUI): void {
    this.ui = ui;
    this.emit({ type: 'view' });
  }

  /** Tells the host which piece of site data the person clicked on the page. */
  openData(path: string, node: string | null): void {
    this.emit({ type: 'data', path, node });
  }

  private actionCache:
    | { revision: number; id: string; policy: Store['policy']; actions: SelectionActions }
    | undefined;

  /**
   * What the person can do with the selected node right now: the feature is on and the store's
   * policy allows it (checked with dry runs, so a policy that keeps parts of a section in place
   * hides their delete and move buttons instead of refusing them afterwards).
   */
  selectionActions(): SelectionActions {
    const node = this.selectedNode;
    const none = { delete: false, duplicate: false, up: false, down: false };
    if (!node?.parent || this.readOnly) return none;
    const cache = this.actionCache;
    const revision = this.store.doc.revision;
    if (
      cache &&
      cache.id === node.id &&
      cache.revision === revision &&
      cache.policy === this.store.policy
    )
      return cache.actions;
    const dry = (op: Record<string, unknown>) =>
      this.store.apply({ ops: [op], actor: this.actor, dryRun: true }).ok;
    const siblings = this.store.view.children(node.parent);
    const i = siblings.findIndex((s) => s.id === node.id);
    const prev = siblings[i - 1];
    const next = siblings[i + 1];
    const actions = {
      delete: this.can('delete') && dry({ op: 'node.remove', id: node.id }),
      duplicate: this.can('duplicate') && dry({ op: 'node.duplicate', id: node.id }),
      up: this.can('move') && !!prev && dry({ op: 'node.move', id: node.id, before: prev.id }),
      down: this.can('move') && !!next && dry({ op: 'node.move', id: node.id, after: next.id }),
    };
    this.actionCache = { revision, id: node.id, policy: this.store.policy, actions };
    return actions;
  }

  /** Shorthand for `features.on(feature)`. */
  can(feature: EditorFeature): boolean {
    return this.features.on(feature);
  }

  /**
   * Who this editor's changes are attributed to: the identity a sync server confirmed, if any,
   * else `actor`. Use it to find "your" changes in history.
   */
  get identity(): Actor {
    return (this.store as Store & SyncingStore).actor ?? this.actor;
  }

  private emit(event: EditorEvent): void {
    for (const l of this.listeners) l(event);
    // Share where this person is, when the store syncs with others.
    if ((event.type === 'selection' || event.type === 'view') && sharesPresence(this.store)) {
      const state = { page: this.symbolView ? null : this.page, selection: this.selected };
      const key = JSON.stringify(state);
      if (key !== this.lastPresence) {
        this.lastPresence = key;
        this.store.setPresence(state);
      }
    }
  }

  private lastPresence = '';

  /** Tells others which node this person is editing inline (or `null`). */
  setEditing(id: string | null): void {
    if (sharesPresence(this.store))
      this.store.setPresence({ page: this.page, selection: this.selected, editing: id });
  }

  private firstPage(): string {
    const pages = Object.values(this.store.doc.pages);
    return (pages.find((p) => p.path === '/') ?? pages[0])?.id ?? 'home';
  }

  private onCommit(event: CommitEvent): void {
    const pageGone = !this.store.doc.pages[this.page];
    if (pageGone) this.page = this.firstPage();
    if (this.symbolView && !this.store.doc.symbols?.[this.symbolView]) this.symbolView = null;
    if (this.locale && !this.store.doc.locales?.others.includes(this.locale)) this.locale = null;
    if (this.ghost) this.ghost = this.ghost.refresh();
    const lostSelection = !!this.selected && !this.store.doc.nodes[this.selected];
    if (lostSelection) this.selected = null;
    if (this.hovered && !this.store.doc.nodes[this.hovered]) this.hovered = null;
    this.emit({ type: 'commit', event });
    if (pageGone) this.emit({ type: 'view' });
    if (lostSelection) this.emit({ type: 'selection', id: null });
  }

  setStore(store: Store): void {
    this.unsubscribe();
    this.store = store;
    this.unsubscribe = this.listen(store);
    this.reset();
  }

  /** After a store swap or `store.load()`: keep what still applies, drop the rest. */
  private reset(): void {
    const store = this.store;
    this.page = store.doc.pages[this.page] ? this.page : this.firstPage();
    this.symbolView = null;
    this.ghost = null;
    // A language the new document doesn't have would make every text edit fail.
    if (this.locale && !store.doc.locales?.others.includes(this.locale)) this.locale = null;
    const hadSelection = this.selected !== null;
    this.selected = null;
    this.hovered = null;
    if (!store.doc.breakpoints.some((b) => b.id === this.breakpoint)) {
      this.breakpoint = store.doc.breakpoints.at(-1)?.id ?? 'base';
    }
    this.emit({ type: 'store' });
    if (hadSelection) this.emit({ type: 'selection', id: null });
  }

  /** Reports problems to the host (as `error` events), e.g. from the canvas. */
  report(errors: Issue[], label?: string): void {
    this.emit({ type: 'error', errors, ...(label ? { label } : {}) });
  }

  // -------------------------------------------------------------------------------------------
  // Queries

  get doc() {
    return this.store.doc;
  }

  get currentPage(): Page | undefined {
    return this.store.doc.pages[this.page];
  }

  /** The document the canvas shows: the ghost preview if one is active. */
  get viewDoc(): SiteDoc {
    return this.ghost?.doc ?? this.store.doc;
  }

  get currentSymbol(): SymbolDef | undefined {
    return this.symbolView ? this.store.doc.symbols?.[this.symbolView] : undefined;
  }

  /** Root of what the canvas shows: the page root, or a symbol definition's root. */
  get currentRootId(): string | undefined {
    return this.currentSymbol?.rootId ?? this.currentPage?.rootId;
  }

  /** Editing gestures are off in preview mode and while a ghost preview is shown. */
  get readOnly(): boolean {
    return this.preview || !!this.ghost;
  }

  node(id: string | null | undefined): BNode | undefined {
    return id ? this.store.doc.nodes[id] : undefined;
  }

  get selectedNode(): BNode | undefined {
    return this.node(this.selected);
  }

  /** Page roots (not selectable). Symbol definition roots are selectable in the definition view. */
  isRoot(id: string): boolean {
    const n = this.store.doc.nodes[id];
    return n?.parent === null && !n.symbol;
  }

  sectionOf(id: string): BNode | undefined {
    return sectionRootOf(this.store.view, id);
  }

  /**
   * Width the canvas renders at for the active breakpoint: a typical device width, kept within
   * the breakpoint's range so exactly its styles apply.
   */
  previewWidth(): number {
    const bps = this.store.doc.breakpoints;
    const i = bps.findIndex((b) => b.id === this.breakpoint);
    const bp = bps[i];
    if (!bp) return 1280;
    const next = bps[i + 1];
    const max = next ? next.minWidth - 1 : Number.POSITIVE_INFINITY;
    const preferred =
      PREVIEW_WIDTH[bp.id] ??
      (next ? Math.round((bp.minWidth + next.minWidth) / 2) : Math.max(bp.minWidth, 1280));
    return Math.max(bp.minWidth, Math.min(preferred, max));
  }

  // -------------------------------------------------------------------------------------------
  // View state

  /** Selects a node (switching to its page if needed). Roots and unknown ids select nothing. */
  select(id: string | null): void {
    const next = id && this.store.doc.nodes[id] && !this.isRoot(id) ? id : null;
    if (next) {
      const symbol = definitionOf(this.store.view, next);
      if (symbol) {
        if (symbol.id !== this.symbolView) this.editSymbol(symbol.id);
      } else {
        const page = pageOf(this.store.view, next);
        if (!page) return;
        if (page.id !== this.page || this.symbolView) this.setPage(page.id);
      }
    }
    if (next === this.selected) return;
    this.selected = next;
    this.emit({ type: 'selection', id: next });
  }

  hover(id: string | null): void {
    const next = id && this.store.doc.nodes[id] && !this.isRoot(id) ? id : null;
    if (next === this.hovered) return;
    this.hovered = next;
    this.emit({ type: 'hover', id: next });
  }

  setPage(id: string): void {
    if (!this.store.doc.pages[id] || (id === this.page && !this.symbolView)) return;
    this.page = id;
    this.symbolView = null;
    this.selected = null;
    this.emit({ type: 'view' });
    this.emit({ type: 'selection', id: null });
  }

  /** Shows a symbol's definition on the canvas; edits there update every instance. */
  editSymbol(id: string): void {
    if (!this.store.doc.symbols?.[id] || id === this.symbolView || !this.can('components')) return;
    this.symbolView = id;
    this.selected = null;
    this.emit({ type: 'view' });
    this.emit({ type: 'selection', id: null });
  }

  /**
   * Shows ops on the canvas without applying them (e.g. an agent's change while it streams in).
   * Invalid ops keep the last valid preview; `null` clears it. Returns the simulation result.
   */
  showPreview(
    ops: unknown[] | null,
    options: { actor?: Actor; label?: string } = {},
  ): ApplyResult | undefined {
    if (!ops?.length) {
      this.clearPreview();
      return undefined;
    }
    const actor = options.actor ?? this.actor;
    const label = options.label ?? `${actor.name ?? actor.id} is editing…`;
    let last: ApplyResult | undefined;
    const make = (): GhostPreview | null => {
      const { result, doc } = this.store.simulate({ ops, actor });
      last = result;
      if (!result.ok || !doc) return null;
      return { doc, ...result.summary, label, refresh: make };
    };
    const ghost = make();
    if (ghost) {
      this.ghost = ghost;
      this.emit({ type: 'view' });
    }
    return last;
  }

  /** Shows a changeset (or some of its ops) applied, without accepting it. */
  previewChangeset(id: string, ops?: number[]): ApplyResult {
    let last: ApplyResult | undefined;
    const make = (): GhostPreview | null => {
      const cs = this.store.changeset(id);
      const { result, doc } = this.store.previewChangeset(id, ops);
      last = result;
      if (!result.ok || !doc || !cs) return null;
      return {
        doc,
        ...result.summary,
        label: `Preview of ${cs.label ?? cs.id} by ${cs.actor.name ?? cs.actor.id}`,
        changeset: id,
        refresh: () => (this.store.changeset(id)?.status.includes('open') ? make() : null),
      };
    };
    const ghost = make();
    const result = last!;
    if (!result.ok) this.emit({ type: 'error', errors: result.errors, label: 'Preview' });
    if (ghost) {
      this.ghost = ghost;
      this.emit({ type: 'view' });
    }
    return result;
  }

  clearPreview(): void {
    if (!this.ghost) return;
    this.ghost = null;
    this.emit({ type: 'view' });
  }

  setBreakpoint(id: string): void {
    if (!this.store.doc.breakpoints.some((b) => b.id === id)) return;
    this.breakpoint = id;
    this.emit({ type: 'view' });
  }

  setZoom(zoom: number | 'fit'): void {
    this.zoom = zoom;
    this.emit({ type: 'view' });
  }

  setTheme(theme: string | null): void {
    this.theme = theme;
    this.emit({ type: 'view' });
  }

  setPreview(preview: boolean): void {
    this.preview = preview;
    if (preview) this.hover(null);
    this.emit({ type: 'view' });
  }

  // -------------------------------------------------------------------------------------------
  // Actions

  /** Applies ops as the editor's actor. Failures are emitted as `error` events and returned. */
  apply(ops: unknown[], label?: string): ApplyResult {
    const result = this.store.apply({ ops, actor: this.actor, ...(label ? { label } : {}) });
    if (!result.ok)
      this.emit({ type: 'error', errors: result.errors, ...(label ? { label } : {}) });
    return result;
  }

  acceptChangeset(id: string, ops?: number[]): ApplyResult {
    this.clearPreview();
    const result = this.store.acceptChangeset(id, { by: this.actor, ...(ops ? { ops } : {}) });
    if (!result.ok) this.emit({ type: 'error', errors: result.errors, label: 'Accept changes' });
    return result;
  }

  rejectChangeset(id: string, ops?: number[]): void {
    this.clearPreview();
    const result = this.store.rejectChangeset(id, { by: this.actor, ...(ops ? { ops } : {}) });
    if (!result.ok) this.emit({ type: 'error', errors: result.errors, label: 'Reject changes' });
  }

  /** Undoes the latest change by another actor (e.g. an agent), as this editor's actor. */
  undoBy(actorId: string): ApplyResult | undefined {
    if (!this.can('undo')) return undefined;
    const result = this.store.undo({ actorId, actor: this.actor });
    if (!result.ok) this.emit({ type: 'error', errors: result.errors, label: 'Undo' });
    return result;
  }

  undo(): ApplyResult | undefined {
    if (!this.can('undo')) return undefined;
    const result = this.store.undo({ actorId: this.identity.id, actor: this.actor });
    if (!result.ok && result.errors[0]?.code !== 'nothing_to_undo')
      this.emit({ type: 'error', errors: result.errors });
    return result;
  }

  redo(): ApplyResult | undefined {
    if (!this.can('undo')) return undefined;
    const result = this.store.redo({ actorId: this.identity.id, actor: this.actor });
    if (!result.ok && result.errors[0]?.code !== 'nothing_to_undo')
      this.emit({ type: 'error', errors: result.errors });
    return result;
  }

  /** Where a new section goes: after the selected section, or at the end of the page. */
  defaultSectionPosition(): Position {
    const section = this.selected ? this.sectionOf(this.selected) : undefined;
    if (section?.parent && this.isRoot(section.parent)) return { after: section.id };
    return {};
  }

  insertSection(
    name: string,
    position: Position = this.defaultSectionPosition(),
    variant?: Record<string, string>,
  ) {
    const page = this.currentPage;
    if (!page || (this.symbolView && !position.parent) || !this.features.section(name))
      return undefined;
    const result = this.apply(
      [
        {
          op: 'section.insert',
          section: name,
          ...(position.parent ? { parent: position.parent } : { page: page.id }),
          ...(position.before ? { before: position.before } : {}),
          ...(position.after ? { after: position.after } : {}),
          ...(variant ? { variant } : {}),
        },
      ],
      `Add ${name} section`,
    );
    if (result.ok) {
      const root = result.summary.created.find((id) => !id.includes('/') && this.node(id)?.section);
      if (root) this.select(root);
    }
    return result;
  }

  /** Inserts a node into the selected container (or after the selected node). */
  insertNode(input: NodeInput, position?: Position) {
    if (!this.can('insert.elements')) return undefined;
    const target = position ?? this.defaultNodePosition(input.type);
    if (!target) {
      this.emit({
        type: 'error',
        errors: [
          {
            code: 'invalid_parent',
            message: 'Select a container (or a node inside one) to insert into.',
          },
        ],
      });
      return undefined;
    }
    const result = this.apply([{ op: 'node.insert', ...target, node: input }], `Add ${input.type}`);
    if (result.ok) {
      const created = result.summary.created;
      const top = created.find((id) => this.node(id)?.parent === target.parent);
      if (top) this.select(top);
    }
    return result;
  }

  defaultNodePosition(type: string): (Position & { parent: string }) | undefined {
    const sel = this.selectedNode;
    const registry = this.store.registry;
    if (sel && registry.accepts(sel.type, type)) return { parent: sel.id };
    if (sel?.parent && registry.accepts(this.node(sel.parent)?.type ?? '', type)) {
      return { parent: sel.parent, after: sel.id };
    }
    return undefined;
  }

  move(id: string, position: Position) {
    if (!this.can('move')) return undefined;
    return this.apply([{ op: 'node.move', id, ...position }], 'Move');
  }

  /** Moves the selected node one place up or down among its siblings. */
  nudge(delta: -1 | 1) {
    const node = this.selectedNode;
    if (!node?.parent) return undefined;
    const siblings = this.store.view.children(node.parent);
    const i = siblings.findIndex((s) => s.id === node.id);
    const target = siblings[i + delta];
    if (!target) return undefined;
    return this.move(node.id, delta < 0 ? { before: target.id } : { after: target.id });
  }

  removeSelected() {
    const node = this.selectedNode;
    if (!node || !this.can('delete')) return undefined;
    const parent = node.parent;
    const result = this.apply([{ op: 'node.remove', id: node.id }], 'Delete');
    if (result.ok && parent && !this.isRoot(parent)) this.select(parent);
    return result;
  }

  duplicateSelected() {
    const node = this.selectedNode;
    if (!node || !this.can('duplicate')) return undefined;
    const result = this.apply([{ op: 'node.duplicate', id: node.id }], 'Duplicate');
    if (result.ok) {
      const copy = result.summary.created.find((id) => this.node(id)?.parent === node.parent);
      if (copy) this.select(copy);
    }
    return result;
  }

  selectParent(): void {
    const parent = this.selectedNode?.parent;
    if (parent && !this.isRoot(parent)) this.select(parent);
  }

  /**
   * Sets props. In another language, content props are written as translations and the rest
   * (tags, sizes…) to the node itself, in one transaction.
   */
  setProps(id: string, props: Record<string, unknown>, label = 'Edit') {
    const node = this.node(id);
    if (!this.locale || !node) return this.apply([{ op: 'props.set', id, props }], label);
    const content = new Set(this.store.registry.component(node.type)?.contentProps ?? []);
    const translated = Object.fromEntries(Object.entries(props).filter(([k]) => content.has(k)));
    const shared = Object.fromEntries(Object.entries(props).filter(([k]) => !content.has(k)));
    return this.apply(
      [
        ...(Object.keys(translated).length
          ? [{ op: 'props.set', id, locale: this.locale, props: translated }]
          : []),
        ...(Object.keys(shared).length ? [{ op: 'props.set', id, props: shared }] : []),
      ],
      label,
    );
  }

  /** Switches the language being viewed and edited (`null` for the default). */
  setLocale(locale: string | null): void {
    const others = this.store.doc.locales?.others ?? [];
    const next = locale && others.includes(locale) ? locale : null;
    if (next === this.locale) return;
    this.locale = next;
    this.emit({ type: 'view' });
  }

  setStyle(
    id: string,
    css: string,
    options: { bp?: string; state?: string; remove?: string[] } = {},
  ) {
    return this.apply(
      [
        {
          op: 'style.set',
          id,
          ...(css ? { css } : {}),
          ...(options.remove?.length ? { remove: options.remove } : {}),
          bp: options.bp ?? this.breakpoint,
          state: options.state ?? 'default',
        },
      ],
      'Style',
    );
  }

  setVars(id: string, vars: Record<string, string | null>) {
    return this.apply([{ op: 'vars.set', id, vars }], 'Style');
  }

  /** Inserts an instance of a symbol where a section would go. */
  insertSymbol(symbol: string, position: Position = this.defaultSectionPosition()) {
    const page = this.currentPage;
    if (!page || this.symbolView || !this.can('insert.components')) return undefined;
    const result = this.apply(
      [
        {
          op: 'symbol.insert',
          symbol,
          ...(position.parent ? { parent: position.parent } : { page: page.id }),
          ...(position.before ? { before: position.before } : {}),
          ...(position.after ? { after: position.after } : {}),
        },
      ],
      `Add ${this.store.doc.symbols?.[symbol]?.name ?? symbol}`,
    );
    if (result.ok) {
      const root = result.summary.created.find(
        (id) => this.node(id)?.parent === (position.parent ?? page.rootId),
      );
      if (root) this.select(root);
    }
    return result;
  }

  createSymbol(id: string, name: string) {
    if (!this.can('components.create')) return undefined;
    return this.apply([{ op: 'symbol.create', id, name }], `Make "${name}" a linked component`);
  }

  detachInstance(id: string) {
    if (!this.can('components')) return undefined;
    return this.apply([{ op: 'symbol.detach', id }], 'Detach instance');
  }

  resetOverrides(id: string) {
    if (!this.can('components.reset')) return undefined;
    return this.apply([{ op: 'symbol.reset', id }], 'Reset overrides');
  }

  setVariant(id: string, variant: Record<string, string>) {
    return this.apply([{ op: 'section.variant', id, variant }], 'Change variant');
  }
}
