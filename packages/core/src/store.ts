import { applyOp, type OpContext, orderNextTo } from './apply.js';
import { createEmptyDoc, DocIndex, descendants } from './doc.js';
import { type Change, Draft } from './draft.js';
import type { Issue } from './errors.js';
import { parseOps } from './ops.js';
import { createPolicy, type Policy } from './policy.js';
import type { Registry } from './registry.js';
import type { Actor, BNode, NodeId, PageId, SiteDoc, TokenTree } from './types.js';
import { deepEqual, ensure, isPlainObject, pruneEmpty } from './util.js';

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
}

export interface ChangeSummary {
  created: NodeId[];
  updated: NodeId[];
  removed: NodeId[];
  pages: PageId[];
  tokens: boolean;
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
  changes: Change[];
  time: number;
  undone?: boolean;
  redone?: boolean;
}

export interface CommitEvent {
  entry: HistoryEntry;
  doc: SiteDoc;
  summary: ChangeSummary;
}

export interface StoreOptions {
  registry: Registry;
  doc?: SiteDoc;
  policy?: Policy;
  /** Maximum number of history entries kept (default 500). */
  historyLimit?: number;
}

export function summarize(changes: Change[]): ChangeSummary {
  const s: ChangeSummary = { created: [], updated: [], removed: [], pages: [], tokens: false };
  for (const c of changes) {
    if (c.kind === 'node') {
      if (!c.before) s.created.push(c.id);
      else if (!c.after) s.removed.push(c.id);
      else s.updated.push(c.id);
    } else if (c.kind === 'page') s.pages.push(c.id);
    else s.tokens = true;
  }
  return s;
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
  for (const field of ['type', 'section', 'part', 'key', 'name'] as const) {
    const r = revertValue(current[field], before[field], after[field]);
    if (r.conflict) conflicts.push(field);
    if (r.value === undefined) delete next[field];
    else next[field] = r.value;
  }
  next.props = revertMap(current.props, before.props, after.props, 'props', conflicts);
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

/** Token leaves keyed by dot path (values are the leaf objects or shorthand values). */
function tokenLeaves(tree: TokenTree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: Record<string, unknown>, path: string[]) => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      const p = [...path, key];
      if (isPlainObject(child) && !('$value' in child)) walk(child, p);
      else out[p.join('.')] = child;
    }
  };
  walk(tree, []);
  return out;
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

function themeEntries(themes: SiteDoc['themes']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [theme, values] of Object.entries(themes)) {
    for (const [path, value] of Object.entries(values)) out[`${theme}\u0000${path}`] = value;
  }
  return out;
}

function rebuildThemes(entries: Record<string, unknown>): SiteDoc['themes'] {
  const out: SiteDoc['themes'] = {};
  for (const [key, value] of Object.entries(entries)) {
    const [theme, path] = key.split('\u0000') as [string, string];
    ensure(out, theme, () => ({}))[path] = String(value);
  }
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
  private readonly historyLimit: number;

  constructor(options: StoreOptions) {
    this.registry = options.registry;
    this.currentPolicy = options.policy ?? createPolicy();
    this.current = options.doc ?? createEmptyDoc();
    this.historyLimit = options.historyLimit ?? 500;
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

  /** Replaces the document and clears history. Listeners registered with `onLoad` are told. */
  load(doc: SiteDoc): void {
    this.current = doc;
    this.index = undefined;
    this.entries.length = 0;
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
    const actor = input.actor ?? LOCAL_USER;
    const revision = this.current.revision;
    if (input.baseRevision !== undefined && input.baseRevision !== revision) {
      return {
        ok: false,
        revision,
        errors: [
          {
            code: 'stale_revision',
            message: `The document is at revision ${revision}, but these changes were based on revision ${input.baseRevision}.`,
            hint: 'Re-read the outline (or the affected nodes) and apply again.',
          },
        ],
      };
    }
    const { ops, issues } = parseOps(input.ops);
    if (issues.length) return { ok: false, revision, errors: issues };
    if (!ops.length)
      return { ok: false, revision, errors: [{ code: 'invalid_op', message: 'No ops given.' }] };

    const draft = new Draft(this.current);
    const ctx: OpContext = {
      draft,
      registry: this.registry,
      actor,
      policy: this.policy,
      opIndex: 0,
      issues: [],
      warnings: [],
    };
    for (const [i, op] of ops.entries()) {
      ctx.opIndex = i;
      const denied = this.policy.check({ actor, op, view: draft, registry: this.registry });
      if (denied) ctx.issues.push({ ...denied, opIndex: i });
      else applyOp(ctx, op);
      if (ctx.issues.length) return { ok: false, revision, errors: ctx.issues, failedOp: i };
    }
    return this.commit(draft, actor, {
      kind: 'edit',
      warnings: ctx.warnings,
      ...(input.label ? { label: input.label } : {}),
      ...(input.dryRun ? { dryRun: true } : {}),
    });
  }

  /** Undoes the most recent edit (by `actorId`, if given) that hasn't been undone. */
  undo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    const who = options.actorId;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (who && e.actor.id !== who) continue;
      if (e.kind === 'undo' || e.undone) continue;
      return this.revertEntry(e, options.actor ?? e.actor, 'undo');
    }
    return this.nothing(
      who ? `There is nothing to undo for "${who}".` : 'There is nothing to undo.',
    );
  }

  /** Redoes the most recent undo (by `actorId`, if given), unless that actor has edited since. */
  redo(options: { actorId?: string; actor?: Actor } = {}): ApplyResult {
    const who = options.actorId;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i]!;
      if (who && e.actor.id !== who) continue;
      if (e.kind === 'edit') break;
      if (e.kind === 'undo' && !e.redone)
        return this.revertEntry(e, options.actor ?? e.actor, 'redo');
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
    return this.revertEntry(entry, actor, 'undo');
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
      if (change.kind === 'page') {
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

    const result = this.commit(draft, actor, {
      kind,
      target: entry.txId,
      label: `${kind === 'undo' ? 'Undo' : 'Redo'}: ${entry.label ?? entry.txId}`,
      warnings,
    });
    // Mark the entry resolved even when every change conflicted (nothing left to revert), so the
    // next undo moves on to earlier work instead of getting stuck here.
    if (result.ok) {
      if (kind === 'undo') entry.undone = true;
      else entry.redone = true;
    }
    return result;
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
    Array.isArray(value.breakpoints)
  );
}

/** Fills in fields older documents may lack, then checks the shape. Returns undefined if invalid. */
export function normalizeDoc(value: unknown): SiteDoc | undefined {
  if (isPlainObject(value) && value.themes === undefined) value = { ...value, themes: {} };
  return isSiteDoc(value) ? value : undefined;
}
