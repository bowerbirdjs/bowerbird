import { applyOp, idTaken, isValidPagePath, type OpContext, orderNextTo } from './apply.js';
import { createEmptyDoc, DocIndex, descendants } from './doc.js';
import { type Change, Draft } from './draft.js';
import { type Issue, listPreview } from './errors.js';
import { flattenL10n, unflattenL10n } from './l10n.js';
import { type Op, parseOps } from './ops.js';
import { createPolicy, type Policy } from './policy.js';
import {
  humanEditConflicts,
  humanTokenConflicts,
  stampChanges,
  stampTokens,
  themeEntries,
  tokenLeaves,
} from './provenance.js';
import type { Registry } from './registry.js';
import { syncInstances, unlinkDangling } from './symbols.js';
import type { Actor, BNode, Locales, NodeId, PageId, SiteDoc, TokenTree } from './types.js';
import { clone, deepEqual, ensure, isPlainObject, pruneEmpty } from './util.js';

export const LOCAL_USER: Actor = { kind: 'user', id: 'local' };

export interface TransactionInput {
  /** Operations; validated against `OpSchema`, so raw agent input can be passed directly. */
  ops: unknown[];
  actor?: Actor;
  label?: string;
  /** Reject the transaction if the document has moved past this revision. */
  baseRevision?: number;
  /** Validate and compute the result without committing. */
  dryRun?: boolean;
  /**
   * Allow an agent to change fields a person edited last, when the policy asks for confirmation
   * (`protectHumanEdits: 'confirm'`). Set it only when the person asked for that change.
   */
  overwrite?: boolean;
  /**
   * Return the ops with the ids they created written in (`result.pinned`), so replaying them on
   * another copy of the document (e.g. a sync server) creates the same ids.
   */
  pinIds?: boolean;
  /**
   * When an op names an id to create that is already taken, use a fresh one instead of failing.
   * Later ops in the transaction are rewritten to match; `result.renamed` lists what changed.
   * For replaying pinned ops on a document that has moved on (sync).
   */
  renameTaken?: boolean;
}

export interface ChangeSummary {
  created: NodeId[];
  updated: NodeId[];
  removed: NodeId[];
  pages: PageId[];
  symbols: string[];
  tokens: boolean;
  /** The site's languages changed. */
  locales: boolean;
}

export type ApplyResult =
  | {
      ok: true;
      /** Null when nothing was committed (dry run or no change). */
      txId: string | null;
      revision: number;
      summary: ChangeSummary;
      dryRun: boolean;
      warnings: Issue[];
      /** With `pinIds`: the ops as applied, with the ids they created written in. */
      pinned?: Op[];
      /** With `renameTaken`: ids that were taken, and the ids used instead. */
      renamed?: Record<string, string>;
    }
  | {
      ok: false;
      revision: number;
      errors: Issue[];
      /** Index of the op that failed; later ops were not checked. Nothing was applied. */
      failedOp?: number;
    };

export interface HistoryEntry {
  txId: string;
  revision: number;
  actor: Actor;
  label?: string;
  kind: 'edit' | 'undo' | 'redo';
  /** For undo/redo entries: the entry they revert. */
  target?: string;
  /** For accepted changesets: who accepted them (`actor` is who proposed them). */
  approvedBy?: Actor;
  changeset?: string;
  changes: Change[];
  time: number;
  undone?: boolean;
  redone?: boolean;
}

export interface CommitEvent {
  entry: HistoryEntry;
  doc: SiteDoc;
  summary: ChangeSummary;
  /**
   * Set when a synced store swaps its optimistic copy of a change for the server's version:
   * listeners already saw this change once. Hosts that save or log changes can skip these.
   */
  echo?: boolean;
}

/**
 * Proposed changes waiting for review. Ops are kept as proposed (with the ids they created pinned,
 * so later ops that refer to them still work) and can be accepted or rejected one by one.
 */
export interface Changeset {
  id: string;
  actor: Actor;
  label?: string;
  ops: Op[];
  /** Per op. */
  status: ('open' | 'accepted' | 'rejected')[];
  /** Per op: earlier ops it depends on (they create nodes, pages or symbols it refers to). */
  needs: number[][];
  baseRevision: number;
  created: number;
  /** What the whole changeset changes, computed when it was proposed. */
  summary: ChangeSummary;
  warnings: Issue[];
}

export type ProposeResult =
  | { ok: true; changeset: Changeset; warnings: Issue[] }
  | { ok: false; revision: number; errors: Issue[]; failedOp?: number };

export interface StoreOptions {
  registry: Registry;
  doc?: SiteDoc;
  policy?: Policy;
  /** Maximum number of history entries kept (default 500). */
  historyLimit?: number;
  /** Changesets to restore (e.g. saved alongside the document). */
  changesets?: Changeset[];
}

export function summarize(changes: Change[]): ChangeSummary {
  const s: ChangeSummary = {
    created: [],
    updated: [],
    removed: [],
    pages: [],
    symbols: [],
    tokens: false,
    locales: false,
  };
  for (const c of changes) {
    if (c.kind === 'node') {
      if (!c.before) s.created.push(c.id);
      else if (!c.after) s.removed.push(c.id);
      else s.updated.push(c.id);
    } else if (c.kind === 'page') s.pages.push(c.id);
    else if (c.kind === 'symbol') s.symbols.push(c.id);
    else if (c.kind === 'locales') s.locales = true;
    else s.tokens = true;
  }
  return s;
}

/** Op fields that hold ids of nodes, pages or symbols (not text, names or section types). */
const ID_FIELDS = ['id', 'parent', 'before', 'after', 'page', 'symbol'] as const;

/** Ids an op refers to (its id fields only). */
function idRefs(op: Op): Set<string> {
  const out = new Set<string>();
  const o = op as Record<string, unknown>;
  for (const f of ID_FIELDS) if (typeof o[f] === 'string') out.add(o[f] as string);
  return out;
}

/** Writes the ids an op created into the op, so it creates the same ids when applied later. */
function pinIds(op: Op, created: { nodes: string[]; pages: string[]; symbols: string[] }): Op {
  const pinned = clone(op);
  switch (pinned.op) {
    case 'section.insert':
    case 'symbol.insert':
      if (!pinned.id && created.nodes[0]) pinned.id = created.nodes[0];
      break;
    case 'node.insert': {
      const inputs: { id?: string; children?: unknown[] }[] = [];
      const walk = (n: { id?: string; children?: unknown[] }) => {
        inputs.push(n);
        for (const c of n.children ?? []) walk(c as typeof n);
      };
      walk(pinned.node);
      if (inputs.length === created.nodes.length) {
        inputs.forEach((n, i) => {
          n.id ??= created.nodes[i];
        });
      }
      break;
    }
    case 'page.create':
      if (!pinned.id && created.pages[0]) pinned.id = created.pages[0];
      break;
    case 'symbol.create':
      if (!pinned.symbol && created.symbols[0]) pinned.symbol = created.symbols[0];
      break;
  }
  return pinned;
}

/** Three-way merge of one value: revert `after` → `before` unless `current` changed since. */
function revertValue(
  current: unknown,
  before: unknown,
  after: unknown,
): { value: unknown; conflict: boolean } {
  if (deepEqual(before, after) || deepEqual(current, before))
    return { value: current, conflict: false };
  if (deepEqual(current, after)) return { value: before, conflict: false };
  return { value: current, conflict: true };
}

function revertMap(
  current: Record<string, unknown> | undefined,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  label: string,
  conflicts: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(current ?? {}) };
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    const r = revertValue(current?.[k], before?.[k], after?.[k]);
    if (r.conflict) conflicts.push(`${label}.${k}`);
    if (r.value === undefined) delete out[k];
    else out[k] = r.value;
  }
  return out;
}

function flattenStyles(styles: BNode['styles']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [bp, states] of Object.entries(styles ?? {})) {
    for (const [state, decls] of Object.entries(states)) {
      for (const [p, v] of Object.entries(decls)) out[`${bp}|${state}|${p}`] = v;
    }
  }
  return out;
}

function unflattenStyles(flat: Record<string, unknown>): BNode['styles'] {
  const styles: NonNullable<BNode['styles']> = {};
  for (const [key, v] of Object.entries(flat)) {
    const [bp, state, prop] = key.split('|') as [string, string, string];
    ensure(
      ensure(styles, bp, () => ({})),
      state,
      () => ({}),
    )[prop] = String(v);
  }
  return pruneEmpty(styles);
}

/** Reverts a node update field by field, keeping later edits by others. */
function revertNode(current: BNode, before: BNode, after: BNode, conflicts: string[]): BNode {
  const next: Record<string, unknown> = { ...current };
  const pos = revertValue(
    { parent: current.parent, order: current.order },
    { parent: before.parent, order: before.order },
    { parent: after.parent, order: after.order },
  );
  if (pos.conflict) conflicts.push('position');
  Object.assign(next, pos.value);
  for (const field of ['type', 'section', 'part', 'key', 'name', 'symbol', 'link'] as const) {
    const r = revertValue(current[field], before[field], after[field]);
    if (r.conflict) conflicts.push(field);
    if (r.value === undefined) delete next[field];
    else next[field] = r.value;
  }
  next.props = revertMap(current.props, before.props, after.props, 'props', conflicts);
  const l10n = unflattenL10n(
    revertMap(
      flattenL10n(current.l10n),
      flattenL10n(before.l10n),
      flattenL10n(after.l10n),
      'l10n',
      conflicts,
    ),
  );
  if (l10n) next.l10n = l10n;
  else delete next.l10n;
  // Provenance goes back with the values it describes; stamp conflicts aren't worth reporting.
  const edited = revertMap(current.edited, before.edited, after.edited, 'edited', []);
  if (Object.keys(edited).length) next.edited = edited as BNode['edited'];
  else delete next.edited;
  const vars = revertMap(current.vars, before.vars, after.vars, 'vars', conflicts);
  if (Object.keys(vars).length) next.vars = vars;
  else delete next.vars;
  const styles = unflattenStyles(
    revertMap(
      flattenStyles(current.styles),
      flattenStyles(before.styles),
      flattenStyles(after.styles),
      'styles',
      conflicts,
    ),
  );
  if (styles) next.styles = styles;
  else delete next.styles;
  return next as unknown as BNode;
}

/** Applies merged leaves onto the current tree, keeping group metadata such as `$type`. */
function rebuildTokens(current: TokenTree, leaves: Record<string, unknown>): TokenTree {
  const tree = structuredClone(current);
  const existing = tokenLeaves(tree);
  const remove = (path: string) => {
    const segs = path.split('.');
    const parents: Record<string, unknown>[] = [tree];
    for (const seg of segs.slice(0, -1)) {
      const next = parents.at(-1)![seg];
      if (!isPlainObject(next)) return;
      parents.push(next);
    }
    delete parents.at(-1)![segs.at(-1)!];
  };
  for (const path of Object.keys(existing)) if (!Object.hasOwn(leaves, path)) remove(path);
  for (const [path, leaf] of Object.entries(leaves)) {
    const segs = path.split('.');
    let group: Record<string, unknown> = tree;
    for (const seg of segs.slice(0, -1)) {
      if (!isPlainObject(group[seg])) group[seg] = {};
      group = group[seg] as Record<string, unknown>;
    }
    group[segs.at(-1)!] = leaf;
  }
  return tree;
}

function rebuildThemes(entries: Record<string, unknown>): SiteDoc['themes'] {
  const out: SiteDoc['themes'] = {};
  for (const [key, value] of Object.entries(entries)) {
    const [theme, path] = key.split('\u0000') as [string, string];
    ensure(out, theme, () => ({}))[path] = String(value);
  }
  return out;
}

/**
 * Reverts a change to the site's languages as a set, so later language changes survive: languages
 * the entry removed come back (with their translations, restored per node), languages it added go
 * (unless there is content in them now), and the default reverts unless it changed again since.
 */
function revertLocales(
  draft: Draft,
  before: Locales | undefined,
  after: Locales | undefined,
  warnings: Issue[],
): void {
  const current = draft.locales();
  const was = new Set(before?.others ?? []);
  const now = new Set(after?.others ?? []);
  const others = new Set(current?.others ?? []);
  for (const l of was) if (!now.has(l)) others.add(l);
  for (const l of now) {
    if (was.has(l) || !others.has(l)) continue;
    const used =
      draft.nodeIds().some((id) => draft.node(id)?.l10n?.[l]) ||
      draft.pages().some((p) => p.l10n?.[l]);
    if (used) {
      warnings.push({
        code: 'conflict',
        message: `Kept language "${l}": it has translations now.`,
      });
    } else others.delete(l);
  }
  let fallback = current?.default ?? 'en';
  const beforeDefault = before?.default ?? 'en';
  const afterDefault = after?.default ?? 'en';
  if (beforeDefault !== afterDefault) {
    if (fallback === afterDefault) fallback = beforeDefault;
    else
      warnings.push({
        code: 'conflict',
        message: `The default language was changed later; kept "${fallback}".`,
      });
  }
  others.delete(fallback);
  draft.setLocales(
    others.size || fallback !== 'en'
      ? { default: fallback, others: [...others].sort() }
      : undefined,
  );
}

type RunOptions = {
  /** Set when a person accepts a changeset: review is satisfied and both are policy-checked. */
  approvedBy?: Actor;
  /** Proposing: review isn't required, human-edit conflicts become warnings, ids are recorded. */
  propose?: boolean;
  /**
   * Replaying a changeset: when an id it pinned has been taken since, a fresh one is used and
   * later ops are rewritten to refer to it.
   */
  rebase?: boolean;
};

type RunOutcome =
  | {
      ok: true;
      draft: Draft;
      ctx: OpContext;
      ops: Op[];
      /** With `propose`: what each op created. */
      createdBy: { nodes: string[]; pages: string[]; symbols: string[] }[];
      /** With `rebase`: pinned ids that were taken, and what they became. */
      renamed: Map<string, string>;
    }
  | { ok: false; result: Extract<ApplyResult, { ok: false }> };

type Pinned = {
  op: Op;
  /** Ids the op meant to create, in creation order (undefined where it let the store choose). */
  nodes: (string | undefined)[];
  page?: string;
  symbol?: string;
};

/** Records the ids an op pinned and drops those that are already taken. */
function unpinTaken(op: Op, draft: Draft): Pinned {
  const out = clone(op);
  switch (out.op) {
    case 'section.insert':
    case 'symbol.insert': {
      const id = out.id;
      if (id && idTaken(draft, id)) delete out.id;
      return { op: out, nodes: [id] };
    }
    case 'node.insert': {
      const nodes: (string | undefined)[] = [];
      const walk = (n: { id?: string; children?: unknown[] }) => {
        nodes.push(n.id);
        if (n.id && idTaken(draft, n.id)) delete n.id;
        for (const c of n.children ?? []) walk(c as typeof n);
      };
      walk(out.node);
      return { op: out, nodes };
    }
    case 'page.create': {
      const id = out.id;
      if (id && draft.page(id)) delete out.id;
      return { op: out, nodes: [], ...(id ? { page: id } : {}) };
    }
    case 'symbol.create': {
      const id = out.symbol;
      if (id && draft.symbol(id)) delete out.symbol;
      return { op: out, nodes: [], ...(id ? { symbol: id } : {}) };
    }
    default:
      return { op: out, nodes: [] };
  }
}

/** Maps an id (or an id nested under a renamed one) through `map`. */
export function renameId(id: string, map: Map<string, string>): string {
  const direct = map.get(id);
  if (direct) return direct;
  for (const [from, to] of map) if (id.startsWith(`${from}/`)) return to + id.slice(from.length);
  return id;
}

/** Rewrites the id fields of an op (and ids inside node inputs) using `map`. Text is untouched. */
export function substitute(op: Op, map: Map<string, string>): Op {
  if (!map.size) return op;
  const out = clone(op) as Record<string, unknown>;
  for (const f of ID_FIELDS)
    if (typeof out[f] === 'string') out[f] = renameId(out[f] as string, map);
  if (out.op === 'node.insert') {
    const walk = (n: { id?: string; children?: unknown[] }) => {
      if (n.id) n.id = renameId(n.id, map);
      for (const c of n.children ?? []) walk(c as typeof n);
    };
    walk(out.node as { id?: string });
  }
  return out as Op;
}

/** The record changes between two versions of a document (records compared by value). */
export function diffDocs(before: SiteDoc, after: SiteDoc): Change[] {
  const out: Change[] = [];
  const records = <T>(
    kind: 'node' | 'page' | 'symbol',
    a: Record<string, T> | undefined,
    b: Record<string, T> | undefined,
  ) => {
    for (const id of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const x = a && Object.hasOwn(a, id) ? a[id] : undefined;
      const y = b && Object.hasOwn(b, id) ? b[id] : undefined;
      if (x === y || deepEqual(x, y)) continue;
      out.push({
        kind,
        id,
        ...(x !== undefined ? { before: x } : {}),
        ...(y !== undefined ? { after: y } : {}),
      } as Change);
    }
  };
  records('node', before.nodes, after.nodes);
  records('page', before.pages, after.pages);
  records('symbol', before.symbols, after.symbols);
  if (!deepEqual(before.locales, after.locales)) {
    out.push({
      kind: 'locales',
      id: 'locales',
      ...(before.locales ? { before: before.locales } : {}),
      ...(after.locales ? { after: after.locales } : {}),
    });
  }
  if (!deepEqual(before.tokens, after.tokens))
    out.push({ kind: 'tokens', id: 'tokens', before: before.tokens, after: after.tokens });
  if (!deepEqual(before.themes, after.themes))
    out.push({ kind: 'themes', id: 'themes', before: before.themes, after: after.themes });
  return out;
}

export class Store {
  readonly registry: Registry;
  private currentPolicy: Policy;
  private current: SiteDoc;
  private index: DocIndex | undefined;
  private readonly entries: HistoryEntry[] = [];
  private readonly listeners = new Set<(event: CommitEvent) => void>();
  private readonly loadListeners = new Set<(doc: SiteDoc) => void>();
  private readonly changesetListeners = new Set<(changesets: readonly Changeset[]) => void>();
  private readonly sets: Changeset[];
  private changesetCounter: number;
  private readonly historyLimit: number;

  constructor(options: StoreOptions) {
    this.registry = options.registry;
    this.currentPolicy = options.policy ?? createPolicy();
    this.current = options.doc ?? createEmptyDoc();
    this.historyLimit = options.historyLimit ?? 500;
    this.sets = [...(options.changesets ?? [])];
    this.changesetCounter = Math.max(
      0,
      ...this.sets.map((c) => Number(/^cs-(\d+)$/.exec(c.id)?.[1] ?? 0)),
    );
  }

  get policy(): Policy {
    return this.currentPolicy;
  }

  /** Replaces the policy (e.g. when the person's role changes). Applies to later transactions. */
  setPolicy(policy: Policy): void {
    this.currentPolicy = policy;
  }

  get doc(): SiteDoc {
    return this.current;
  }

  /** Indexed read access to the current document. */
  get view(): DocIndex {
    this.index ??= new DocIndex(this.current);
    return this.index;
  }

  get history(): readonly HistoryEntry[] {
    return this.entries;
  }

  /**
   * Replaces the document and clears history and changesets. Listeners registered with `onLoad`
   * are told.
   */
  load(doc: SiteDoc): void {
    this.current = doc;
    this.index = undefined;
    this.entries.length = 0;
    this.sets.length = 0;
    this.emitChangesets();
    for (const listener of this.loadListeners) {
      try {
        listener(doc);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Replaces the document (and optionally history and changesets) without running ops: for
   * example with a sync server's state. `reset: true` tells listeners it's a new document (like
   * `load`); otherwise commit listeners get `entry`, or a placeholder entry if the document changed.
   */
  replace(
    doc: SiteDoc,
    options: {
      history?: readonly HistoryEntry[];
      changesets?: readonly Changeset[];
      entry?: HistoryEntry;
      reset?: boolean;
      /** Listeners already saw `entry` (see `CommitEvent.echo`). */
      echo?: boolean;
    } = {},
  ): void {
    const previous = this.current;
    const changed = doc !== previous;
    this.current = doc;
    this.index = undefined;
    if (options.history) {
      this.entries.length = 0;
      this.entries.push(...options.history.slice(-this.historyLimit));
    }
    if (options.changesets) {
      this.sets.length = 0;
      this.sets.push(...options.changesets);
      this.changesetCounter = Math.max(
        this.changesetCounter,
        ...this.sets.map((c) => Number(/^cs-(\d+)$/.exec(c.id)?.[1] ?? 0)),
      );
      this.emitChangesets();
    }
    if (options.reset) {
      for (const listener of this.loadListeners) {
        try {
          listener(doc);
        } catch (error) {
          queueMicrotask(() => {
            throw error;
          });
        }
      }
      return;
    }
    if (!changed && !options.entry) return;
    const entry: HistoryEntry = options.entry ?? {
      txId: `sync-${doc.revision}`,
      revision: doc.revision,
      actor: { kind: 'system', id: 'sync' },
      kind: 'edit',
      label: 'Sync',
      changes: diffDocs(previous, doc),
      time: Date.now(),
    };
    const summary = summarize(entry.changes);
    for (const listener of this.listeners) {
      try {
        listener({ entry, doc, summary, ...(options.echo ? { echo: true } : {}) });
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /** Called after `load` replaces the document (commit listeners are not called for loads). */
  onLoad(listener: (doc: SiteDoc) => void): () => void {
    this.loadListeners.add(listener);
    return () => this.loadListeners.delete(listener);
  }

  subscribe(listener: (event: CommitEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies a transaction atomically: all ops succeed, or nothing changes. */
  apply(input: TransactionInput): ApplyResult {
    const run = this.run(input, input.renameTaken ? { rebase: true } : {});
    if (!run.ok) return run.result;
    const actor = input.actor ?? LOCAL_USER;
    if (!input.dryRun) {
      stampChanges(run.draft, actor, this.current.revision + 1);
      stampTokens(run.draft, actor, this.current.revision + 1);
    }
    const result = this.commit(run.draft, actor, {
      kind: 'edit',
      warnings: run.ctx.warnings,
      ...(input.label ? { label: input.label } : {}),
      ...(input.dryRun ? { dryRun: true } : {}),
    });
    if (!result.ok) return result;
    return {
      ...result,
      ...(input.pinIds
        ? {
            pinned: run.ops.map((op, i) =>
              pinIds(op, run.createdBy[i] ?? { nodes: [], pages: [], symbols: [] }),
            ),
          }
        : {}),
      ...(run.renamed.size ? { renamed: Object.fromEntries(run.renamed) } : {}),
    };
  }

  /**
   * Runs a transaction without committing and returns the document it would produce. Used for
   * previews (e.g. showing an agent's changes while it is still writing them).
   */
  simulate(
    input: TransactionInput,
    options: { rebase?: boolean } = {},
  ): { result: ApplyResult; doc?: SiteDoc } {
    const run = this.run(input, { propose: true, ...options });
    if (!run.ok) return { result: run.result };
    const changes = run.draft.changes();
    return {
      result: {
        ok: true,
        txId: null,
        revision: this.current.revision,
        summary: summarize(changes),
        dryRun: true,
        warnings: run.ctx.warnings,
      },
      doc: changes.length ? run.draft.finish(this.current.revision) : this.current,
    };
  }

  private run(input: TransactionInput, options: RunOptions = {}): RunOutcome {
    const actor = input.actor ?? LOCAL_USER;
    const revision = this.current.revision;
    const failed = (errors: Issue[], failedOp?: number): RunOutcome => ({
      ok: false,
      result: { ok: false, revision, errors, ...(failedOp !== undefined ? { failedOp } : {}) },
    });
    if (input.baseRevision !== undefined && input.baseRevision !== revision) {
      return failed([
        {
          code: 'stale_revision',
          message: `The document is at revision ${revision}, but these changes were based on revision ${input.baseRevision}.`,
          hint: 'Re-read the outline (or the affected nodes) and apply again.',
        },
      ]);
    }
    const { ops, issues } = parseOps(input.ops);
    if (issues.length) return failed(issues);
    if (!ops.length) return failed([{ code: 'invalid_op', message: 'No ops given.' }]);
    const policy = this.policy;
    if (
      !options.approvedBy &&
      !options.propose &&
      !input.dryRun &&
      policy.requiresReview?.(actor)
    ) {
      return failed([
        {
          code: 'review_required',
          message: `Changes by ${actor.kind} "${actor.id}" need review before they apply.`,
          hint: 'Propose them instead (store.propose, or the apply tool with propose: true); a person accepts or rejects each change.',
        },
      ]);
    }

    const draft = new Draft(this.current);
    const ctx: OpContext = {
      draft,
      registry: this.registry,
      actor,
      policy,
      opIndex: 0,
      issues: [],
      warnings: [],
    };
    const createdBy: { nodes: string[]; pages: string[]; symbols: string[] }[] = [];
    const renamed = new Map<string, string>();
    const synced = new Set<string>();
    for (let [i, op] of ops.entries()) {
      ctx.opIndex = i;
      let pinned: Pinned | undefined;
      if (options.rebase) {
        if (renamed.size) op = substitute(op, renamed);
        pinned = unpinTaken(op, draft);
        op = pinned.op;
        ops[i] = op;
      }
      const denied =
        policy.check({ actor, op, view: draft, registry: this.registry }) ??
        (options.approvedBy
          ? policy.check({ actor: options.approvedBy, op, view: draft, registry: this.registry })
          : undefined);
      if (denied) {
        ctx.issues.push({ ...denied, opIndex: i });
        return failed(ctx.issues, i);
      }
      const before =
        options.propose || pinned || input.pinIds
          ? {
              nodes: draft.created.length,
              pages: new Set(draft.pages().map((p) => p.id)),
              symbols: new Set(draft.symbols().map((x) => x.id)),
            }
          : undefined;
      applyOp(ctx, op);
      if (ctx.issues.length) return failed(ctx.issues, i);
      // Keep instances in step after every op, so later ops can address the copies.
      for (const id of syncInstances(ctx)) synced.add(id);
      if (ctx.issues.length) return failed(ctx.issues, i);
      if (before) {
        const made = {
          nodes: draft.created.slice(before.nodes).filter((id) => draft.has(id)),
          pages: draft
            .pages()
            .map((p) => p.id)
            .filter((id) => !before.pages.has(id)),
          symbols: draft
            .symbols()
            .map((x) => x.id)
            .filter((id) => !before.symbols.has(id)),
        };
        createdBy.push(made);
        if (pinned) {
          const pairs: [string | undefined, string | undefined][] = [
            ...pinned.nodes.map(
              (id, k) => [id, made.nodes[k]] as [string | undefined, string | undefined],
            ),
            [pinned.page, made.pages[0]],
            [pinned.symbol, made.symbols[0]],
          ];
          if (pinned.symbol && made.symbols[0]) {
            pairs.push([`symbol-${pinned.symbol}`, draft.symbol(made.symbols[0])?.rootId]);
          }
          for (const [from, to] of pairs) if (from && to && from !== to) renamed.set(from, to);
        }
      }
    }

    // Instance changes made by sync weren't named by any op: check them against locks too.
    if (synced.size) {
      const changes = draft.changes().filter((c) => c.kind === 'node' && synced.has(c.id));
      for (const who of [actor, ...(options.approvedBy ? [options.approvedBy] : [])]) {
        const denied = policy.checkChanges?.({
          actor: who,
          changes,
          view: draft,
          registry: this.registry,
        });
        if (denied) {
          return failed([
            {
              ...denied,
              message: `${denied.message} (an instance of a linked component would change)`,
            },
          ]);
        }
      }
    }
    const protectedEdits = this.protect(draft, actor, {
      allow: !!input.overwrite || !!options.approvedBy || !!options.propose,
    });
    if (protectedEdits.blocked) return failed(protectedEdits.issues);
    ctx.warnings.push(...protectedEdits.issues);
    return { ok: true, draft, ctx, ops, createdBy, renamed };
  }

  /**
   * Checks a draft for agent changes to what people edited last (including instance changes
   * from sync and nodes an undo would delete). Returns warnings, or a blocking error with
   * `protectHumanEdits: 'confirm'` unless `allow` (the person asked, or approved it).
   */
  private protect(
    draft: Draft,
    actor: Actor,
    options: { allow: boolean },
  ): { blocked: boolean; issues: Issue[] } {
    const mode =
      this.policy.protectHumanEdits?.(actor) ?? (actor.kind === 'agent' ? 'warn' : 'off');
    if (mode === 'off') return { blocked: false, issues: [] };
    const conflicts = [...humanEditConflicts(draft), ...humanTokenConflicts(draft)];
    if (!conflicts.length) return { blocked: false, issues: [] };
    const shown = conflicts.slice(0, 5);
    const more = conflicts.length - shown.length;
    const issues: Issue[] = shown.map((c) => ({ ...c, code: 'human_edit' }));
    if (more) {
      issues.push({
        code: 'human_edit',
        message: `…and ${more} more people-edited item(s): ${listPreview(conflicts.slice(5).map((c) => c.nodeId ?? c.path ?? ''))}.`,
      });
    }
    const blocked = mode === 'confirm' && !options.allow;
    if (blocked) {
      issues.at(-1)!.hint =
        'People edited these last. Only change them if the person asked: pass overwrite: true, or propose the change for review.';
    }
    return { blocked, issues };
  }

  // -------------------------------------------------------------------------------------------
  // Changesets

  /** Proposed changes, oldest first (including resolved ones). */
  get changesets(): readonly Changeset[] {
    return this.sets;
  }

  changeset(id: string): Changeset | undefined {
    return this.sets.find((c) => c.id === id);
  }

  onChangesets(listener: (changesets: readonly Changeset[]) => void): () => void {
    this.changesetListeners.add(listener);
    return () => this.changesetListeners.delete(listener);
  }

  private emitChangesets(): void {
    for (const l of this.changesetListeners) {
      try {
        l(this.sets);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Validates a transaction and stores it as a changeset for review instead of applying it.
   * Nothing in the document changes until someone accepts it.
   */
  propose(input: TransactionInput): ProposeResult {
    const actor = input.actor ?? LOCAL_USER;
    const run = this.run(input, { propose: true });
    if (!run.ok) return run.result;
    const changes = run.draft.changes();
    if (!changes.length) {
      return {
        ok: false,
        revision: this.current.revision,
        errors: [
          {
            code: 'no_change',
            message: 'These ops change nothing, so there is nothing to propose.',
          },
        ],
      };
    }
    const ops = run.ops.map((op, i) => pinIds(op, run.createdBy[i]!));
    const createdSets = run.createdBy.map((c) => new Set([...c.nodes, ...c.pages, ...c.symbols]));
    const needs = ops.map((op, j) => {
      const refs = idRefs(op);
      const out: number[] = [];
      for (let i = 0; i < j; i++) {
        const made = createdSets[i]!;
        // A reference to a created id, or to something nested under one, is a dependency.
        if ([...refs].some((r) => made.has(r) || [...made].some((m) => r.startsWith(`${m}/`))))
          out.push(i);
      }
      return out;
    });
    const changeset: Changeset = {
      id: `cs-${++this.changesetCounter}`,
      actor,
      ...(input.label ? { label: input.label } : {}),
      ops,
      status: ops.map(() => 'open'),
      needs,
      baseRevision: this.current.revision,
      created: Date.now(),
      summary: summarize(changes),
      warnings: run.ctx.warnings,
    };
    this.sets.push(changeset);
    this.emitChangesets();
    return { ok: true, changeset, warnings: run.ctx.warnings };
  }

  private requireChangeset(id: string): Changeset | Issue {
    const cs = this.changeset(id);
    if (cs) return cs;
    const open = this.sets.filter((c) => c.status.includes('open')).map((c) => c.id);
    return {
      code: 'unknown_changeset',
      message: `No changeset "${id}".`,
      hint: open.length ? `Open changesets: ${open.join(', ')}.` : 'There are no open changesets.',
    };
  }

  /** Preview of a changeset (or some of its ops) applied to the current document. */
  previewChangeset(id: string, ops?: number[]): { result: ApplyResult; doc?: SiteDoc } {
    const cs = this.requireChangeset(id);
    if (!('ops' in cs))
      return { result: { ok: false, revision: this.current.revision, errors: [cs] } };
    const selected = ops ?? cs.status.flatMap((st, i) => (st === 'open' ? [i] : []));
    if (!selected.length)
      return {
        result: {
          ok: true,
          txId: null,
          revision: this.current.revision,
          summary: summarize([]),
          dryRun: true,
          warnings: [],
        },
        doc: this.current,
      };
    return this.simulate(
      { ops: selected.map((i) => cs.ops[i]), actor: cs.actor },
      { rebase: true },
    );
  }

  /**
   * Applies open ops of a changeset (all, or the given indexes) as one transaction attributed to
   * the proposer and approved by `by`. Ops that depend on unaccepted ops must be included.
   */
  acceptChangeset(id: string, options: { by: Actor; ops?: number[] }): ApplyResult {
    const revision = this.current.revision;
    const cs = this.requireChangeset(id);
    if (!('ops' in cs)) return { ok: false, revision, errors: [cs] };
    const selected = [
      ...new Set(options.ops ?? cs.status.flatMap((st, i) => (st === 'open' ? [i] : []))),
    ].sort((a, b) => a - b);
    const errors: Issue[] = [];
    for (const i of selected) {
      if (cs.status[i] === undefined)
        errors.push({ code: 'invalid_op', message: `Changeset ${id} has no op ${i}.` });
      else if (cs.status[i] !== 'open')
        errors.push({
          code: 'invalid_op',
          opIndex: i,
          message: `Op ${i} of ${id} was already ${cs.status[i]}.`,
        });
      for (const need of cs.needs[i] ?? []) {
        if (cs.status[need] === 'accepted' || selected.includes(need)) continue;
        errors.push({
          code: 'invalid_op',
          opIndex: i,
          message: `Op ${i} of ${id} needs op ${need} (${cs.ops[need]?.op}), which is ${cs.status[need] === 'rejected' ? 'rejected' : 'not selected'}.`,
          hint:
            cs.status[need] === 'rejected'
              ? 'Reject this op too.'
              : `Accept op ${need} together with it.`,
        });
      }
    }
    if (!selected.length)
      errors.push({
        code: 'invalid_op',
        message: options.ops ? 'No ops were selected.' : `Changeset ${id} has no open ops.`,
      });
    if (options.by.id === cs.actor.id || this.policy.requiresReview?.(options.by)) {
      errors.push({
        code: 'review_required',
        message: `${options.by.kind} "${options.by.id}" can't approve ${options.by.id === cs.actor.id ? 'its own' : 'these'} changes.`,
        hint: 'A person who isn’t under review has to accept them.',
      });
    }
    if (errors.length) return { ok: false, revision, errors };
    const input: TransactionInput = {
      ops: selected.map((i) => cs.ops[i]),
      actor: cs.actor,
      label: cs.label ?? `Changeset ${id}`,
      overwrite: true,
    };
    const run = this.run(input, { approvedBy: options.by, rebase: true });
    if (!run.ok) {
      // Errors refer to positions in the selection; map them back to the changeset's op indexes.
      return {
        ...run.result,
        errors: run.result.errors.map((e) =>
          e.opIndex !== undefined ? { ...e, opIndex: selected[e.opIndex] ?? e.opIndex } : e,
        ),
        ...(run.result.failedOp !== undefined
          ? { failedOp: selected[run.result.failedOp] ?? run.result.failedOp }
          : {}),
      };
    }
    stampChanges(run.draft, cs.actor, revision + 1);
    stampTokens(run.draft, cs.actor, revision + 1);
    const result = this.commit(run.draft, cs.actor, {
      kind: 'edit',
      warnings: run.ctx.warnings,
      label: input.label!,
      approvedBy: options.by,
      changeset: cs.id,
    });
    if (result.ok) {
      for (const i of selected) cs.status[i] = 'accepted';
      // Later ops refer to ids as proposed; keep them pointing at what was actually created.
      if (run.renamed.size) {
        cs.ops = cs.ops.map((op, i) =>
          cs.status[i] === 'open' ? substitute(op, run.renamed) : op,
        );
      }
      this.emitChangesets();
    }
    return result;
  }

  /** Rejects open ops (all, or the given indexes), and ops that depend on them. */
  rejectChangeset(
    id: string,
    options: { by: Actor; ops?: number[] },
  ): { ok: boolean; errors: Issue[]; rejected: number[] } {
    const cs = this.requireChangeset(id);
    if (!('ops' in cs)) return { ok: false, errors: [cs], rejected: [] };
    const rejected: number[] = [];
    const reject = (i: number) => {
      if (cs.status[i] !== 'open') return;
      cs.status[i] = 'rejected';
      rejected.push(i);
      cs.needs.forEach((needs, j) => {
        if (needs.includes(i)) reject(j);
      });
    };
    for (const i of options.ops ?? cs.status.map((_, i) => i)) reject(i);
    if (rejected.length) this.emitChangesets();
    return { ok: true, errors: [], rejected: rejected.sort((a, b) => a - b) };
  }

  /** Undoes the most recent edit (by `actorId`, if given) that hasn't been undone. */
  undo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    const gate = options.actor && this.reviewGate(options.actor);
    if (gate) return gate;
    const who = options.actorId;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (who && e.actor.id !== who && e.approvedBy?.id !== who) continue;
      if (e.kind === 'undo' || e.undone) continue;
      // Undoing an accepted changeset by its approver's id: the approver is the one undoing.
      const actor = options.actor ?? (who && e.approvedBy?.id === who ? e.approvedBy : e.actor);
      return this.reviewGate(actor) ?? this.revertEntry(e, actor, 'undo');
    }
    return this.nothing(
      who ? `There is nothing to undo for "${who}".` : 'There is nothing to undo.',
    );
  }

  /** Redoes the most recent undo (by `actorId`, if given), unless that actor has edited since. */
  redo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    const gate = options.actor && this.reviewGate(options.actor);
    if (gate) return gate;
    const who = options.actorId;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (who && e.actor.id !== who) continue;
      if (e.kind === 'edit') break;
      if (e.kind === 'undo' && !e.redone) {
        const actor = options.actor ?? e.actor;
        return this.reviewGate(actor) ?? this.revertEntry(e, actor, 'redo');
      }
    }
    return this.nothing(
      who ? `There is nothing to redo for "${who}".` : 'There is nothing to redo.',
    );
  }

  /** Reverts a specific transaction, keeping later edits where they conflict. */
  revert(txId: string, actor: Actor = LOCAL_USER): ApplyResult {
    const entry = this.entries.find((e) => e.txId === txId);
    if (!entry) return this.nothing(`No transaction "${txId}" in history.`);
    if (entry.undone) return this.nothing(`"${txId}" has already been undone.`);
    return this.reviewGate(actor) ?? this.revertEntry(entry, actor, 'undo');
  }

  /** Actors whose changes need review can't undo or redo directly either. */
  private reviewGate(actor: Actor): ApplyResult | undefined {
    if (!this.policy.requiresReview?.(actor)) return undefined;
    return {
      ok: false,
      revision: this.current.revision,
      errors: [
        {
          code: 'review_required',
          message: `Changes by ${actor.kind} "${actor.id}" need review, so it can't undo or redo directly.`,
          hint: 'Propose the change that reverses it instead, or ask a person to undo it.',
        },
      ],
    };
  }

  private nothing(message: string): ApplyResult {
    return {
      ok: false,
      revision: this.current.revision,
      errors: [{ code: 'nothing_to_undo', message }],
    };
  }

  private revertEntry(entry: HistoryEntry, actor: Actor, kind: 'undo' | 'redo'): ApplyResult {
    const draft = new Draft(this.current);
    const warnings: Issue[] = [];
    const touched = new Set(entry.changes.map((c) => c.id));
    const repositioned = new Set<string>();
    // Nodes are reverted in phases so moves inside the entry survive: first restore what the entry
    // removed, then revert updates (including moves), and only then delete what it created.
    const nodeChanges = entry.changes.filter((c) => c.kind === 'node') as Extract<
      Change,
      { kind: 'node' }
    >[];
    for (const change of nodeChanges) {
      if (!change.before || change.after) continue;
      if (draft.node(change.id)) {
        warnings.push({
          code: 'conflict',
          nodeId: change.id,
          message: `"${change.id}" exists again, so it was not restored.`,
        });
      } else {
        draft.setNode(change.before);
        repositioned.add(change.id);
      }
    }
    for (const change of nodeChanges) {
      if (!change.before || !change.after) continue;
      const cur = draft.node(change.id);
      if (!cur) {
        warnings.push({
          code: 'conflict',
          nodeId: change.id,
          message: `"${change.id}" was removed later, so this change to it can't be reverted.`,
        });
        continue;
      }
      const conflicts: string[] = [];
      draft.setNode(revertNode(cur, change.before, change.after, conflicts));
      repositioned.add(change.id);
      if (conflicts.length) {
        warnings.push({
          code: 'conflict',
          nodeId: change.id,
          message: `Kept later edits to "${change.id}": ${conflicts.join(', ')}.`,
        });
      }
    }
    for (const change of [...nodeChanges].reverse()) {
      if (change.before) continue;
      const cur = draft.node(change.id);
      if (!cur) continue;
      if (!deepEqual(cur, change.after)) {
        warnings.push({
          code: 'conflict',
          nodeId: change.id,
          message: `"${change.id}" was edited after it was created; those edits were removed with it.`,
        });
      }
      for (const d of descendants(draft, change.id)) {
        if (!touched.has(d.id)) {
          warnings.push({
            code: 'conflict',
            nodeId: d.id,
            message: `"${d.id}" was added inside "${change.id}" later and was removed with it.`,
          });
        }
        draft.deleteNode(d.id);
      }
      draft.deleteNode(change.id);
    }
    for (const change of [...entry.changes].reverse()) {
      if (change.kind === 'node') continue;
      if (change.kind === 'locales') {
        revertLocales(draft, change.before, change.after, warnings);
      } else if (change.kind === 'symbol') {
        const cur = draft.symbol(change.id);
        const r = revertValue(cur, change.before, change.after);
        if (r.conflict)
          warnings.push({
            code: 'conflict',
            message: `Symbol "${change.id}" was changed later; kept the later version.`,
          });
        else if (r.value) draft.setSymbol(r.value as NonNullable<typeof change.before>);
        else draft.deleteSymbol(change.id);
      } else if (change.kind === 'page') {
        const cur = draft.page(change.id);
        const r = revertValue(cur, change.before, change.after);
        if (r.conflict)
          warnings.push({
            code: 'conflict',
            message: `Page "${change.id}" was changed later; kept the later version.`,
          });
        else if (r.value) draft.setPage(r.value as NonNullable<typeof change.before>);
        else draft.deletePage(change.id);
      } else if (change.kind === 'tokens') {
        const conflicts: string[] = [];
        const merged = revertMap(
          tokenLeaves(draft.tokens()),
          tokenLeaves(change.before),
          tokenLeaves(change.after),
          'tokens',
          conflicts,
        );
        draft.setTokens(rebuildTokens(draft.tokens(), merged));
        if (conflicts.length) {
          warnings.push({
            code: 'conflict',
            message: `Kept later token edits: ${conflicts.join(', ')}.`,
          });
        }
      } else {
        const conflicts: string[] = [];
        const merged = revertMap(
          themeEntries(draft.themes()),
          themeEntries(change.before),
          themeEntries(change.after),
          'themes',
          conflicts,
        );
        draft.setThemes(rebuildThemes(merged));
        if (conflicts.length) {
          warnings.push({
            code: 'conflict',
            message: `Kept later theme edits: ${conflicts.join(', ')}.`,
          });
        }
      }
    }
    // A restored position may share its order key with a node placed there later; move it just after.
    for (const id of repositioned) {
      const n = draft.node(id);
      if (!n?.parent) continue;
      const siblings = draft.children(n.parent);
      if (siblings.some((s) => s.id !== id && s.order === n.order)) {
        draft.setNode({
          ...n,
          order: orderNextTo(
            siblings.filter((s) => s.id !== id),
            n.order,
            'after',
          ),
        });
      }
    }
    // Links to symbols or definition nodes that no longer exist become ordinary nodes, and
    // reverted definition changes reach every instance (including ones added later).
    unlinkDangling(draft);
    const sync: OpContext = {
      draft,
      registry: this.registry,
      actor,
      policy: this.policy,
      opIndex: 0,
      issues: [],
      warnings,
    };
    syncInstances(sync);
    if (sync.issues.length)
      return { ok: false, revision: this.current.revision, errors: sync.issues };
    const integrity: Issue[] = [];
    for (const id of draft.nodeIds()) {
      const n = draft.node(id)!;
      if (n.parent !== null && !draft.has(n.parent)) {
        integrity.push({
          code: 'integrity',
          nodeId: id,
          message: `Reverting would leave "${id}" without its parent "${n.parent}".`,
        });
      }
    }
    for (const page of draft.pages()) {
      if (!draft.has(page.rootId))
        integrity.push({
          code: 'integrity',
          message: `Reverting would leave page "${page.id}" without its root.`,
        });
    }
    if (integrity.length) return { ok: false, revision: this.current.revision, errors: integrity };
    const denied = this.policy.checkChanges?.({
      actor,
      changes: draft.changes(),
      view: draft,
      registry: this.registry,
    });
    if (denied) return { ok: false, revision: this.current.revision, errors: [denied] };
    // Undoing can delete what people added or changed since (e.g. text inside a created section).
    const protectedEdits = this.protect(draft, actor, { allow: false });
    if (protectedEdits.blocked)
      return { ok: false, revision: this.current.revision, errors: protectedEdits.issues };
    warnings.push(...protectedEdits.issues);

    // Mark the entry resolved even when every change conflicted (nothing left to revert), so the
    // next undo moves on to earlier work instead of getting stuck here. Marked before committing,
    // so commit listeners (the editor, sync clients) see the flag.
    if (kind === 'undo') entry.undone = true;
    else entry.redone = true;
    return this.commit(draft, actor, {
      kind,
      target: entry.txId,
      label: `${kind === 'undo' ? 'Undo' : 'Redo'}: ${entry.label ?? entry.txId}`,
      warnings,
    });
  }

  private commit(
    draft: Draft,
    actor: Actor,
    meta: {
      kind: HistoryEntry['kind'];
      label?: string;
      target?: string;
      dryRun?: boolean;
      warnings: Issue[];
      approvedBy?: Actor;
      changeset?: string;
    },
  ): ApplyResult {
    const revision = this.current.revision;
    const changes = draft.changes();
    const summary = summarize(changes);
    if (!changes.length || meta.dryRun) {
      const warnings = changes.length
        ? meta.warnings
        : [...meta.warnings, { code: 'no_change' as const, message: 'Nothing changed.' }];
      return { ok: true, txId: null, revision, summary, dryRun: !!meta.dryRun, warnings };
    }
    const doc = draft.finish(revision + 1);
    const entry: HistoryEntry = {
      txId: `tx-${doc.revision}`,
      revision: doc.revision,
      actor,
      kind: meta.kind,
      changes,
      time: Date.now(),
      ...(meta.label ? { label: meta.label } : {}),
      ...(meta.target ? { target: meta.target } : {}),
      ...(meta.approvedBy ? { approvedBy: meta.approvedBy } : {}),
      ...(meta.changeset ? { changeset: meta.changeset } : {}),
    };
    this.current = doc;
    this.index = undefined;
    this.entries.push(entry);
    if (this.entries.length > this.historyLimit)
      this.entries.splice(0, this.entries.length - this.historyLimit);
    for (const listener of this.listeners) {
      try {
        listener({ entry, doc, summary });
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    return {
      ok: true,
      txId: entry.txId,
      revision: doc.revision,
      summary,
      dryRun: false,
      warnings: meta.warnings,
    };
  }
}

export function createStore(options: StoreOptions): Store {
  return new Store(options);
}

/** Loose structural check for documents loaded from storage. */
export function isSiteDoc(value: unknown): value is SiteDoc {
  return (
    isPlainObject(value) &&
    value.schemaVersion === 1 &&
    typeof value.revision === 'number' &&
    isPlainObject(value.pages) &&
    isPlainObject(value.nodes) &&
    isPlainObject(value.tokens) &&
    isPlainObject(value.themes) &&
    Array.isArray(value.breakpoints) &&
    (value.symbols === undefined || isPlainObject(value.symbols)) &&
    // Paths end up in links and file names; ops validate them, so stored ones must be valid too.
    Object.values(value.pages).every(
      (p) => isPlainObject(p) && typeof p.path === 'string' && isValidPagePath(p.path),
    )
  );
}

/** Fills in fields older documents may lack, then checks the shape. Returns undefined if invalid. */
export function normalizeDoc(value: unknown): SiteDoc | undefined {
  if (isPlainObject(value) && value.themes === undefined) value = { ...value, themes: {} };
  return isSiteDoc(value) ? value : undefined;
}
