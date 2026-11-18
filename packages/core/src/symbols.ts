import {
  allocateCopyId,
  allocateId,
  copySubtree,
  fail,
  guardInstance,
  MAX_DEPTH,
  type OpContext,
  type OpOf,
  positionKey,
  requireNode,
  resolveParent,
  retireId,
  setProps,
} from './apply.js';
import {
  ancestors,
  DocIndex,
  type DocView,
  definitionOf,
  depthOf,
  descendants,
  instanceRootOf,
  isInstanceRoot,
  isScopeOwner,
  subtreeHeight,
} from './doc.js';
import { didYouMean, listPreview } from './errors.js';
import { isValidId, PAGE_ID_PATTERN, slugify } from './ids.js';
import { keyBetween } from './order.js';
import type { BNode, NodeId, SymbolDef } from './types.js';
import { clone, deepEqual } from './util.js';

// ---------------------------------------------------------------------------------------------
// Symbols (linked components)
//
// A symbol's definition is an ordinary node subtree whose root has no parent and is not a page
// root. An instance is a copy of that subtree placed on a page; every instance node carries
// `link: { symbol, node }` pointing at the definition node it mirrors. Edits to the definition are
// copied to instances at the end of each transaction (see `syncInstances`), field by field:
// a field follows the definition while it still matches the definition's previous value, so
// local overrides (an instance's own text, say) are kept. Instance structure is locked; it only
// changes through the definition.

/** Looks up a symbol or reports an actionable error. */
export function requireSymbol(ctx: OpContext, id: string): SymbolDef | undefined {
  const symbol = ctx.draft.symbol(id);
  if (symbol) return symbol;
  const all = ctx.draft.symbols();
  return fail(ctx, {
    code: 'unknown_symbol',
    message: `No symbol "${id}".${didYouMean(
      id,
      all.map((s) => s.id),
    )}`,
    hint: all.length
      ? `Symbols: ${listPreview(all.map((s) => s.id))}.`
      : 'There are no symbols yet; make one with symbol.create.',
  });
}

/** Instance roots of a symbol, in no particular order. */
export function instancesOf(view: DocView, symbolId: string): BNode[] {
  const symbol = view.symbol(symbolId);
  if (!symbol) return [];
  const out: BNode[] = [];
  for (const id of view.nodeIds()) {
    const n = view.node(id);
    if (n?.link?.symbol === symbolId && n.link.node === symbol.rootId) out.push(n);
  }
  return out;
}

/** Fields of an instance node that differ from its definition node (its local overrides). */
export function overridesOf(view: DocView, node: BNode): string[] {
  const def = node.link && view.node(node.link.node);
  if (!def) return [];
  const out: string[] = [];
  const keys = new Set([...Object.keys(def.props), ...Object.keys(node.props)]);
  for (const k of keys) if (!deepEqual(def.props[k], node.props[k])) out.push(`props.${k}`);
  if (!deepEqual(def.styles, node.styles)) out.push('styles');
  if (!deepEqual(def.vars, node.vars)) out.push('vars');
  return out;
}

const strip = (n: BNode): BNode => {
  const copy = { ...n };
  delete copy.symbol;
  delete copy.link;
  delete copy.edited;
  return copy;
};

export function symbolCreate(ctx: OpContext, op: OpOf<'symbol.create'>) {
  const { draft } = ctx;
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null) {
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: `"${node.id}" is a page or symbol root; make a symbol from a section or node on a page.`,
    });
  }
  const def = definitionOf(draft, node.id);
  if (def) {
    return fail(ctx, {
      code: 'invalid_op',
      nodeId: node.id,
      message: `"${node.id}" is part of the definition of symbol "${def.id}".`,
    });
  }
  if (node.link) {
    const root = instanceRootOf(draft, node.id);
    return fail(ctx, {
      code: 'instance',
      nodeId: node.id,
      message: `"${node.id}" is already ${root?.id === node.id ? 'an instance' : 'inside an instance'} of symbol "${node.link.symbol}".`,
      hint: `Run symbol.detach on "${root?.id ?? node.id}" first to make a separate symbol.`,
    });
  }
  const nested = descendants(draft, node.id).find((d) => d.link);
  if (nested) {
    return fail(ctx, {
      code: 'instance',
      nodeId: nested.id,
      message: `"${node.id}" contains an instance of symbol "${nested.link!.symbol}"; symbols can't contain other symbols yet.`,
      hint: `Detach "${instanceRootOf(draft, nested.id)?.id ?? nested.id}" (symbol.detach) first.`,
    });
  }
  let id = op.symbol ?? slugify(op.name, 'symbol');
  if (!PAGE_ID_PATTERN.test(id) || id.length > 60) {
    return fail(ctx, {
      code: 'invalid_id',
      message: `"${id}" is not a valid symbol id.`,
      hint: 'Use lowercase kebab-case, e.g. "site-footer".',
    });
  }
  if (draft.symbol(id)) {
    if (op.symbol) {
      return fail(ctx, {
        code: 'duplicate_id',
        message: `A symbol "${id}" already exists.`,
      });
    }
    const base = id;
    for (let n = 2; draft.symbol(id); n++) id = `${base}-${n}`;
  }
  let rootId = `symbol-${id}`;
  if (draft.has(rootId)) rootId = allocateCopyId(ctx, rootId);
  const idMap = copySubtree(ctx, node, {
    parent: null,
    order: keyBetween(undefined, undefined),
    rootId,
    scopeRoot: true,
    transform: (copy, source) => ({
      ...strip(copy),
      ...(source.id === node.id ? { symbol: id } : {}),
    }),
  });
  draft.setSymbol({
    id,
    name: op.name,
    rootId,
    ...(op.description ? { description: op.description } : {}),
  });
  for (const n of [node, ...descendants(draft, node.id)]) {
    const defId = idMap.get(n.id)!;
    draft.setNode({ ...n, link: { symbol: id, node: defId } });
    remember(ctx, n.id, defId);
  }
}

/** Records the definition node as it is now, as the merge base for a freshly linked instance node. */
function remember(ctx: OpContext, instanceId: NodeId, defId: NodeId): void {
  const def = ctx.draft.node(defId);
  if (!def) return;
  ctx.linkBase ??= new Map();
  ctx.linkBase.set(instanceId, clone(def));
}

export function symbolInsert(ctx: OpContext, op: OpOf<'symbol.insert'>) {
  const { draft, registry } = ctx;
  const symbol = requireSymbol(ctx, op.symbol);
  if (!symbol) return;
  const defRoot = draft.node(symbol.rootId);
  if (!defRoot) {
    return fail(ctx, {
      code: 'integrity',
      message: `Symbol "${symbol.id}" has no definition root "${symbol.rootId}".`,
    });
  }
  const parent = resolveParent(ctx, op.page, op.parent);
  if (!parent) return;
  if (definitionOf(draft, parent.id)) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `"${parent.id}" is part of a symbol definition; symbols can't contain other symbols yet.`,
    });
  }
  if (parent.link) {
    return fail(ctx, {
      code: 'instance',
      nodeId: parent.id,
      message: `"${parent.id}" is part of an instance of symbol "${parent.link.symbol}"; nodes can't be added inside instances.`,
    });
  }
  if (!registry.accepts(parent.type, defRoot.type)) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `"${parent.id}" (${parent.type}) can't contain a ${defRoot.type}.`,
    });
  }
  if (depthOf(draft, parent.id) + 1 + subtreeHeight(draft, defRoot.id) > MAX_DEPTH) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `An instance there would nest nodes more than ${MAX_DEPTH} levels deep.`,
    });
  }
  if (op.id && (draft.has(op.id) || !isValidId(op.id))) {
    return fail(ctx, {
      code: draft.has(op.id) ? 'duplicate_id' : 'invalid_id',
      nodeId: op.id,
      message: draft.has(op.id)
        ? `A node "${op.id}" already exists.`
        : `"${op.id}" is not a valid id.`,
    });
  }
  const order = positionKey(ctx, parent.id, op.before, op.after);
  if (order === undefined) return;
  const rootId = op.id ?? allocateId(ctx, defRoot.section ? defRoot.section.name : symbol.id);
  const idMap = copySubtree(ctx, defRoot, {
    parent: parent.id,
    order,
    rootId,
    scopeRoot: true,
    transform: (copy, source) => ({ ...strip(copy), link: { symbol: symbol.id, node: source.id } }),
  });
  for (const [defId, instanceId] of idMap) remember(ctx, instanceId, defId);
  for (const [path, patch] of Object.entries(op.content ?? {})) {
    const target = draft.node(path === '' ? rootId : `${rootId}/${path}`);
    if (!target) {
      const parts = descendants(draft, rootId)
        .filter((n) => n.id.startsWith(`${rootId}/`))
        .map((n) => n.id.slice(rootId.length + 1));
      fail(ctx, {
        code: 'unknown_part',
        nodeId: rootId,
        path,
        message: `Symbol "${symbol.id}" has no part "${path}".${didYouMean(path, parts)}`,
        hint: `Parts: ${listPreview(parts, 30)}.`,
      });
      continue;
    }
    setProps(ctx, target, patch);
  }
}

function requireInstanceRoot(ctx: OpContext, id: NodeId): BNode | undefined {
  const node = requireNode(ctx, id);
  if (!node) return undefined;
  if (isInstanceRoot(ctx.draft, node)) return node;
  const root = instanceRootOf(ctx.draft, id);
  return fail(ctx, {
    code: 'instance',
    nodeId: id,
    message: `"${id}" is not the root of a symbol instance.`,
    ...(root ? { hint: `It is inside instance "${root.id}".` } : {}),
  });
}

export function symbolDetach(ctx: OpContext, op: OpOf<'symbol.detach'>) {
  const root = requireInstanceRoot(ctx, op.id);
  if (!root) return;
  const symbol = root.link!.symbol;
  for (const n of [root, ...descendants(ctx.draft, root.id)]) {
    if (n.link?.symbol !== symbol) continue;
    const copy = { ...n };
    delete copy.link;
    ctx.draft.setNode(copy);
  }
}

export function symbolReset(ctx: OpContext, op: OpOf<'symbol.reset'>) {
  const { draft } = ctx;
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (!node.link) {
    return fail(ctx, {
      code: 'instance',
      nodeId: node.id,
      message: `"${node.id}" is not part of a symbol instance, so it has no overrides to reset.`,
    });
  }
  for (const n of [node, ...descendants(draft, node.id)]) {
    const def = n.link && draft.node(n.link.node);
    if (!def) continue;
    const next: BNode = { ...n, props: clone(def.props) };
    if (def.styles) next.styles = clone(def.styles);
    else delete next.styles;
    if (def.vars) next.vars = { ...def.vars };
    else delete next.vars;
    draft.setNode(next);
  }
}

export function symbolUpdate(ctx: OpContext, op: OpOf<'symbol.update'>) {
  const symbol = requireSymbol(ctx, op.symbol);
  if (!symbol) return;
  ctx.draft.setSymbol({
    ...symbol,
    ...(op.name ? { name: op.name } : {}),
    ...(op.description !== undefined ? { description: op.description } : {}),
  });
}

export function symbolRemove(ctx: OpContext, op: OpOf<'symbol.remove'>) {
  const { draft } = ctx;
  const symbol = requireSymbol(ctx, op.symbol);
  if (!symbol) return;
  const instances = instancesOf(draft, symbol.id);
  if (instances.length && !op.instances) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Symbol "${symbol.id}" has ${instances.length} instance(s): ${listPreview(instances.map((i) => i.id))}.`,
      hint: 'Pass instances: "detach" to keep them as ordinary nodes, or "remove" to delete them.',
    });
  }
  const remove = (id: NodeId) => {
    for (const d of descendants(draft, id)) {
      retireId(ctx, d.id);
      draft.deleteNode(d.id);
    }
    retireId(ctx, id);
    draft.deleteNode(id);
  };
  for (const inst of instances) {
    if (op.instances === 'remove') {
      if (!guardRemovable(ctx, inst)) return;
      remove(inst.id);
      continue;
    }
    for (const n of [inst, ...descendants(draft, inst.id)]) {
      if (n.link?.symbol !== symbol.id) continue;
      const copy = { ...n };
      delete copy.link;
      draft.setNode(copy);
    }
  }
  remove(symbol.rootId);
  draft.deleteSymbol(symbol.id);
}

function guardRemovable(ctx: OpContext, node: BNode): boolean {
  return node.parent !== null && guardInstance(ctx, node, 'remove it');
}

// ---------------------------------------------------------------------------------------------
// Definition → instance sync

/** Follows the definition: a value moves along only if it still equals the old definition value. */
const follow = <T>(current: T, before: T, after: T): T =>
  deepEqual(current, before) ? after : current;

function followMap(
  current: Record<string, unknown> | undefined,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(current ?? {}) };
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    const v = follow(current?.[k], before?.[k], after?.[k]);
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

type Styles = NonNullable<BNode['styles']>;

function followStyles(current?: Styles, before?: Styles, after?: Styles): Styles | undefined {
  const flat = (s?: Styles) => {
    const out: Record<string, string> = {};
    for (const [bp, states] of Object.entries(s ?? {}))
      for (const [state, decls] of Object.entries(states))
        for (const [p, v] of Object.entries(decls)) out[`${bp}\u0000${state}\u0000${p}`] = v;
    return out;
  };
  const merged = followMap(flat(current), flat(before), flat(after));
  const out: Styles = {};
  for (const [key, v] of Object.entries(merged)) {
    const [bp, state, p] = key.split('\u0000') as [string, string, string];
    out[bp] ??= {};
    out[bp][state] ??= {};
    out[bp][state][p] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Applies a definition node's field changes to one instance node. */
function followNode(inst: BNode, before: BNode, after: BNode): BNode {
  const next: BNode = { ...inst };
  for (const field of ['type', 'section', 'part', 'key', 'name'] as const) {
    const v = follow(inst[field], before[field], after[field]);
    if (v === undefined) delete next[field];
    else (next as unknown as Record<string, unknown>)[field] = v;
  }
  next.props = followMap(inst.props, before.props, after.props) as BNode['props'];
  const vars = followMap(inst.vars, before.vars, after.vars) as Record<string, string>;
  if (Object.keys(vars).length) next.vars = vars;
  else delete next.vars;
  const styles = followStyles(inst.styles, before.styles, after.styles);
  if (styles) next.styles = styles;
  else delete next.styles;
  return next;
}

/** Nearest scope owner at or above `id` (inclusive), within the same tree. */
function scopeOwner(view: DocView, id: NodeId): BNode | undefined {
  for (const n of [view.node(id), ...ancestors(view, id)]) if (n && isScopeOwner(view, n)) return n;
  return undefined;
}

/**
 * Copies definition changes made in this transaction to every instance: created definition nodes
 * are added to each instance, removed ones are removed, moved ones are moved, and changed fields
 * follow unless the instance overrides them. Runs once per transaction, after all ops.
 */
export function syncInstances(ctx: OpContext): void {
  const { draft } = ctx;
  const changes = draft.changes().filter((c) => c.kind === 'node');
  let baseView: DocIndex | undefined;
  const inDefinition = (c: (typeof changes)[number]) =>
    c.after
      ? !!definitionOf(draft, c.id)
      : !!c.before && !!definitionOf((baseView ??= new DocIndex(draft.base)), c.id);
  const defChanges = changes.filter(inDefinition);
  if (!defChanges.length) return;

  // Definition node id → instance nodes linked to it.
  const linked = new Map<NodeId, BNode[]>();
  for (const id of draft.nodeIds()) {
    const n = draft.node(id)!;
    if (!n.link) continue;
    const list = linked.get(n.link.node);
    if (list) list.push(n);
    else linked.set(n.link.node, [n]);
  }
  const instanceRootFor = (n: BNode) => instanceRootOf(draft, n.id);
  /** The node in the same instance as `member` that mirrors definition node `defId`. */
  const counterpart = (member: BNode, defId: NodeId): BNode | undefined => {
    const root = instanceRootFor(member);
    return (linked.get(defId) ?? []).find(
      (c) => draft.has(c.id) && instanceRootFor(draft.node(c.id)!)?.id === root?.id,
    );
  };

  // 1. Created definition nodes, parents first.
  const created = defChanges
    .filter((c) => c.after && !c.before)
    .map((c) => draft.node(c.id)!)
    .sort((a, b) => depthOf(draft, a.id) - depthOf(draft, b.id));
  for (const d of created) {
    if (d.parent === null) continue;
    for (const instParent of [...(linked.get(d.parent) ?? [])]) {
      if (!draft.has(instParent.id)) continue;
      if (draft.children(instParent.id).some((c) => c.link?.node === d.id)) continue;
      let id: string | undefined;
      if (d.section) id = allocateId(ctx, d.section.name);
      else {
        const srcOwner = scopeOwner(draft, d.parent);
        const dstOwner = srcOwner && counterpart(instParent, srcOwner.id);
        if (srcOwner && dstOwner) {
          const prefix = `${srcOwner.id}/`;
          const rel = d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id.split('/').at(-1);
          id = `${dstOwner.id}/${rel}`;
        }
        if (!id || draft.has(id)) id = allocateCopyId(ctx, id ?? d.id);
      }
      const copy: BNode = {
        ...strip(clone(d)),
        id,
        parent: instParent.id,
        link: { symbol: instParent.link!.symbol, node: d.id },
      };
      draft.setNode(copy);
      const list = linked.get(d.id);
      if (list) list.push(copy);
      else linked.set(d.id, [copy]);
    }
  }

  // 2. Changed definition nodes: fields follow, positions mirror. The merge base is the
  // definition as the instance last saw it: the start of the transaction, or the moment the
  // instance was linked if that happened in this transaction.
  for (const c of defChanges) {
    if (!c.after) continue;
    const after = draft.node(c.id)!;
    for (const inst of linked.get(c.id) ?? []) {
      const current = draft.node(inst.id);
      if (!current) continue;
      const before = ctx.linkBase?.get(inst.id) ?? c.before;
      if (!before) continue;
      let next = followNode(current, before, after);
      if (
        after.parent !== null &&
        (before.parent !== after.parent || before.order !== after.order)
      ) {
        const parent = counterpart(current, after.parent);
        if (parent) next = { ...next, parent: parent.id, order: after.order };
      }
      if (!deepEqual(next, current)) draft.setNode(next);
    }
  }

  // 3. Removed definition nodes.
  const removedFrom: string[] = [];
  for (const c of defChanges) {
    if (c.after || !c.before) continue;
    for (const inst of linked.get(c.id) ?? []) {
      if (!draft.has(inst.id)) continue;
      for (const d of descendants(draft, inst.id)) {
        retireId(ctx, d.id);
        draft.deleteNode(d.id);
      }
      retireId(ctx, inst.id);
      draft.deleteNode(inst.id);
      removedFrom.push(inst.id);
    }
  }
  if (removedFrom.length) {
    ctx.warnings.push({
      code: 'conflict',
      message: `Removed from instances too: ${listPreview(removedFrom)}.`,
    });
  }
}
