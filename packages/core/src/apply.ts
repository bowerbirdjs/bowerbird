import {
  ancestors,
  type DocView,
  definitionOf,
  depthOf,
  descendants,
  instanceRootOf,
  isInstanceRoot,
  isLinked,
  isScopeOwner,
  sectionRootOf,
  subtreeHeight,
} from './doc.js';
import { Draft } from './draft.js';
import { didYouMean, type Issue, listPreview } from './errors.js';
import { isValidId, PAGE_ID_PATTERN, slugify } from './ids.js';
import type { Op } from './ops.js';
import { keyBetween } from './order.js';
import type { Policy } from './policy.js';
import {
  type ComponentDef,
  type NodeInput,
  type Registry,
  resolveVariant,
  type SectionDef,
} from './registry.js';
import {
  BUILTIN_VARS,
  checkProperty,
  checkValue,
  cssValueSyntaxError,
  isStyleState,
  parseDeclarations,
  propertyTypo,
  STATE_PSEUDO,
  type StyleCheckContext,
} from './styles.js';
import {
  symbolCreate,
  symbolDetach,
  symbolInsert,
  symbolRemove,
  symbolReset,
  symbolUpdate,
} from './symbols.js';
import {
  aliasesIn,
  aliasToCss,
  flattenTokens,
  getTokenLeaf,
  resolvedTokenValues,
  TOKEN_PATH,
  tokenVar,
} from './tokens.js';
import type {
  Actor,
  BNode,
  NodeId,
  NodeStyles,
  Page,
  Props,
  SectionRef,
  TokenTree,
} from './types.js';
import { clone, deepEqual, ensure, isPlainObject, isSafeKey, own, pruneEmpty } from './util.js';

export interface OpContext {
  draft: Draft;
  registry: Registry;
  actor: Actor;
  policy: Policy;
  opIndex: number;
  issues: Issue[];
  warnings: Issue[];
  /**
   * Instance node id → the definition node as it was when the instance was linked in this
   * transaction. Instance sync merges definition changes from that point on.
   */
  linkBase?: Map<NodeId, BNode>;
  /**
   * Fields the actor set on purpose in this transaction, by node id (`props.text`, `styles`, …):
   * for nodes it creates, these are stamped as the actor's edits, unlike template placeholders.
   */
  explicit?: Map<NodeId, Set<string>>;
}

/** Records fields the actor set on purpose (see `OpContext.explicit`). */
export function markExplicit(ctx: OpContext, id: NodeId, fields: string[]): void {
  if (!fields.length) return;
  ctx.explicit ??= new Map();
  const set = ctx.explicit.get(id) ?? new Set<string>();
  ctx.explicit.set(id, set);
  for (const f of fields) set.add(f);
}

export function fail(ctx: OpContext, issue: Omit<Issue, 'opIndex'>): undefined {
  ctx.issues.push({ ...issue, opIndex: ctx.opIndex });
  return undefined;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Maximum nesting below a page root; keeps rendering and tree walks safe. */
export const MAX_DEPTH = 40;

/** A fresh `<prefix>-<n>` id that has never been used in this document. */
export function allocateId(ctx: OpContext, prefix: string): string {
  let n = ctx.draft.counter(prefix);
  let id: string;
  do {
    n++;
    id = `${prefix}-${n}`;
  } while (ctx.draft.has(id));
  ctx.draft.useCounter(prefix, n);
  return id;
}

/** Id for a copy of `id`: `item-3` → a new `item-<n>`, `heading` → `heading-<n>`. */
export function allocateCopyId(ctx: OpContext, id: string): string {
  const match = /^(.*)-(\d+)$/.exec(id);
  const prefix = match ? match[1]! : id;
  ctx.draft.useCounter(prefix, match ? Number(match[2]) : 1);
  return allocateId(ctx, prefix);
}

/** True if `id` exists or was used before (numbered ids are never handed out twice). */
export function idTaken(draft: Draft, id: string): boolean {
  if (draft.has(id)) return true;
  const match = /^(.*)-(\d+)$/.exec(id);
  // Generated numbers start at 1, so `-0` ids are never handed out (or retired) by the counter.
  return !!match && Number(match[2]) > 0 && draft.counter(match[1]!) >= Number(match[2]);
}

/**
 * Why `id` can't be used for a new node, if it can't: it exists, or it was used before (numbered
 * ids are never reused, so old references can't land on a new node), or nodes inside its id scope
 * still exist (`cta-1/heading` would take the place of a future section's part).
 */
export function newIdProblem(draft: Draft, id: string): string | undefined {
  if (draft.has(id)) return `A node "${id}" already exists.`;
  if (idTaken(draft, id))
    return `"${id}" was used before and ids are never reused, so references to the old node can't reach a new one.`;
  const inside = scopeInUse(draft, id);
  if (inside) return `"${inside}" already uses the id scope "${id}/".`;
  return undefined;
}

/**
 * Whether an explicit id fits where it is created: a scoped id (`cta-1/heading`) must continue
 * the scope it is created in; plain ids (`note`) fit anywhere.
 */
export function fitsScope(id: string, scope: string): boolean {
  return !id.includes('/') || (id.startsWith(scope) && !id.slice(scope.length).includes('/'));
}

/** A node whose id is inside `id`'s scope (`id/…`), if any. */
function scopeInUse(draft: Draft, id: string): string | undefined {
  const prefix = `${id}/`;
  return draft.nodeIds().find((n) => n.startsWith(prefix));
}

/** Marks a removed numbered id as used, so it is never handed out again. */
export function retireId(ctx: OpContext, id: string): void {
  const match = /^(.*)-(\d+)$/.exec(id);
  if (match) ctx.draft.useCounter(match[1]!, Number(match[2]));
}

// ---------------------------------------------------------------------------------------------
// Lookups and validation helpers

const tokenVarCache = new WeakMap<TokenTree, Set<string>>();
export function tokenVarSet(tokens: TokenTree): Set<string> {
  let set = tokenVarCache.get(tokens);
  if (!set) {
    set = new Set(flattenTokens(tokens).tokens.map((t) => t.cssVar));
    tokenVarCache.set(tokens, set);
  }
  return set;
}

const tokenValueCache = new WeakMap<TokenTree, Map<string, string>>();
export function tokenValueMap(tokens: TokenTree): Map<string, string> {
  let map = tokenValueCache.get(tokens);
  if (!map) {
    map = resolvedTokenValues(flattenTokens(tokens).tokens);
    tokenValueCache.set(tokens, map);
  }
  return map;
}

/** Variable names declared by the sections that enclose `startId` (and by `own`, if given). */
export function sectionVarNames(
  view: DocView,
  registry: Registry,
  startId: NodeId | undefined,
  own?: SectionRef,
): string[] {
  const names: string[] = [];
  const add = (ref?: SectionRef) => {
    const vars = ref && registry.section(ref.name)?.vars;
    if (vars) names.push(...Object.keys(vars));
  };
  add(own);
  if (startId) {
    add(view.node(startId)?.section);
    for (const a of ancestors(view, startId)) add(a.section);
  }
  return names;
}

function styleContext(
  ctx: OpContext,
  startId: NodeId | undefined,
  own?: SectionRef,
): StyleCheckContext {
  return {
    vars: new Set([
      ...tokenVarSet(ctx.draft.tokens()),
      ...BUILTIN_VARS,
      ...sectionVarNames(ctx.draft, ctx.registry, startId, own),
    ]),
    allowRaw: ctx.policy.allowRawValues(ctx.actor),
    tokenValues: tokenValueMap(ctx.draft.tokens()),
  };
}

export function requireNode(ctx: OpContext, id: NodeId): BNode | undefined {
  const node = ctx.draft.node(id);
  if (node) return node;
  return fail(ctx, {
    code: 'not_found',
    nodeId: id,
    message: `No node "${id}".${didYouMean(id, ctx.draft.nodeIds().slice(0, 5000))}`,
    hint: 'Call get_outline to see current node ids.',
  });
}

function validateProps(
  ctx: OpContext,
  def: ComponentDef,
  input: Record<string, unknown>,
  nodeId: string,
): Props | undefined {
  const res = def.props.safeParse(input);
  if (res.success) return res.data as Props;
  const known = Object.keys(def.props.shape);
  for (const zi of res.error.issues) {
    if (zi.code === 'unrecognized_keys') {
      for (const key of zi.keys) {
        fail(ctx, {
          code: 'unknown_prop',
          nodeId,
          path: key,
          message: `${def.name} has no prop "${key}".${didYouMean(key, known)}`,
          hint: `Props of ${def.name}: ${known.join(', ') || '(none)'}.`,
        });
      }
      continue;
    }
    const path = zi.path.join('.');
    fail(ctx, {
      code: 'invalid_props',
      nodeId,
      path,
      message: `${def.name}.${path || 'props'}: ${zi.message}`,
      ...(zi.code === 'invalid_value'
        ? { hint: `Allowed: ${zi.values.map(String).join(', ')}.` }
        : {}),
    });
  }
  return undefined;
}

function checkBpState(ctx: OpContext, nodeId: NodeId, bp: string, state: string): boolean {
  const bps = ctx.draft.breakpoints().map((b) => b.id);
  if (!bps.includes(bp)) {
    fail(ctx, {
      code: 'unknown_breakpoint',
      nodeId,
      message: `Unknown breakpoint "${bp}".${didYouMean(bp, bps)}`,
      hint: `Breakpoints (mobile-first): ${ctx.draft
        .breakpoints()
        .map((b) => `${b.id} (≥${b.minWidth}px)`)
        .join(', ')}.`,
    });
    return false;
  }
  if (!isStyleState(state)) {
    fail(ctx, {
      code: 'unknown_state',
      nodeId,
      message: `Unknown state "${state}".${didYouMean(state, Object.keys(STATE_PSEUDO))}`,
      hint: `States: ${Object.keys(STATE_PSEUDO).join(', ')}.`,
    });
    return false;
  }
  return true;
}

function checkDecls(
  ctx: OpContext,
  nodeId: NodeId,
  decls: [string, string][],
  sctx: StyleCheckContext,
) {
  for (const [prop, value] of decls) {
    const typo = propertyTypo(prop);
    if (typo) {
      fail(ctx, { ...typo, nodeId });
      continue;
    }
    for (const i of checkValue(prop, value, sctx)) fail(ctx, { ...i, nodeId });
  }
}

function checkVars(
  ctx: OpContext,
  nodeId: NodeId,
  vars: Record<string, string | null>,
  sctx: StyleCheckContext,
  sectionVars: string[],
) {
  for (const [name, value] of Object.entries(vars)) {
    if (!name.startsWith('--') || !sctx.vars.has(name)) {
      fail(ctx, {
        code: 'invalid_var',
        nodeId,
        path: name,
        message: `"${name}" can't be set here.${didYouMean(name, sctx.vars)}`,
        hint: sectionVars.length
          ? `Section variables here: ${sectionVars.join(', ')}. Token variables (e.g. --color-surface) can also be overridden to re-theme a subtree.`
          : 'Only token variables (e.g. --color-surface) can be overridden here.',
      });
      continue;
    }
    if (value !== null) for (const i of checkValue(name, value, sctx)) fail(ctx, { ...i, nodeId });
  }
}

/** Order key for a new child of `parentId`, honouring before/after. */
export function positionKey(
  ctx: OpContext,
  parentId: NodeId,
  before?: NodeId,
  after?: NodeId,
  movingId?: NodeId,
): string | undefined {
  if (before && after)
    return fail(ctx, { code: 'invalid_op', message: 'Give either "before" or "after", not both.' });
  const sibs = ctx.draft.children(parentId).filter((n) => n.id !== movingId);
  const anchor = before ?? after;
  if (!anchor) return keyBetween(sibs.at(-1)?.order, undefined);
  const target = sibs.find((n) => n.id === anchor);
  if (!target) {
    return fail(ctx, {
      code: 'not_found',
      nodeId: anchor,
      message: `"${anchor}" is not a child of "${parentId}".`,
      hint: `Children of ${parentId}: ${listPreview(sibs.map((s) => s.id)) || '(none)'}.`,
    });
  }
  return orderNextTo(sibs, target.order, before ? 'before' : 'after');
}

/** A key strictly before/after `order` among siblings, skipping siblings that share the key. */
export function orderNextTo(
  siblings: { order: string }[],
  order: string,
  side: 'before' | 'after',
): string {
  // Order keys compare as strings (code-unit order), which is exactly what the default sort does.
  if (side === 'before') {
    const lower = siblings
      .filter((s) => s.order < order)
      .map((s) => s.order)
      .sort();
    return keyBetween(lower.at(-1), order);
  }
  const upper = siblings
    .filter((s) => s.order > order)
    .map((s) => s.order)
    .sort();
  return keyBetween(order, upper[0]);
}

/** Id prefix for new nodes under `parentId`: the nearest section root or keyed item. */
export function scopeFor(view: DocView, parentId: NodeId): string {
  for (const n of [view.node(parentId), ...ancestors(view, parentId)]) {
    if (n && isScopeOwner(view, n)) return `${n.id}/`;
  }
  return '';
}

/**
 * Fails if `node` is inside a symbol instance (but not its root): an instance mirrors its
 * definition, so its structure can only change through the definition.
 */
export function guardInstance(ctx: OpContext, node: BNode, action: string): boolean {
  if (!isLinked(ctx.draft, node) || isInstanceRoot(ctx.draft, node)) return true;
  const link = node.link!;
  const root = instanceRootOf(ctx.draft, node.id);
  const symbol = ctx.draft.symbol(link.symbol);
  fail(ctx, {
    code: 'instance',
    nodeId: node.id,
    message: `"${node.id}" is inside an instance of symbol "${link.symbol}"${root ? ` ("${root.id}")` : ''}, so you can't ${action} here.`,
    hint: `Change the definition (${symbol ? `nodes under "${symbol.rootId}"` : 'the symbol'}) to update every instance, or run symbol.detach on "${root?.id ?? node.id}" first. Text, props and styles can be overridden per instance.`,
  });
  return false;
}

/** Fails if `parent` is inside an instance (structure is locked) when adding children to it. */
function guardParent(ctx: OpContext, parent: BNode): boolean {
  if (!isLinked(ctx.draft, parent)) return true;
  const link = parent.link!;
  const root = instanceRootOf(ctx.draft, parent.id);
  fail(ctx, {
    code: 'instance',
    nodeId: parent.id,
    message: `"${parent.id}" is part of an instance of symbol "${link.symbol}"; nodes can't be added inside instances.`,
    hint: `Add it to the definition (node "${link.node}") to add it to every instance, or run symbol.detach on "${root?.id ?? parent.id}" first.`,
  });
  return false;
}

/**
 * Copies `root` and its subtree to a new place, giving every copy a fresh id. Ids are rebuilt
 * under their nearest copied scope owner (section root, keyed item, symbol root), so
 * `hero-1/heading` copied under `hero-2` becomes `hero-2/heading`. Returns old id → new id.
 */
export function copySubtree(
  ctx: OpContext,
  root: BNode,
  opts: {
    parent: NodeId | null;
    order: string;
    rootId: string;
    /** Treat the copied root as an id scope even if the source root isn't one. */
    scopeRoot?: boolean;
    transform?: (copy: BNode, source: BNode) => BNode;
  },
): Map<NodeId, NodeId> {
  const { draft } = ctx;
  const subtree = [root, ...descendants(draft, root.id)];
  const inSubtree = new Set(subtree.map((n) => n.id));
  const idMap = new Map<NodeId, NodeId>([[root.id, opts.rootId]]);
  const claimed = new Set<string>([opts.rootId]);
  const free = (id: string) => !draft.has(id) && !claimed.has(id);
  const isOwner = (n: BNode) => (n.id === root.id && !!opts.scopeRoot) || isScopeOwner(draft, n);
  for (const n of subtree.slice(1)) {
    let owner: BNode | undefined;
    for (let cur = n.parent ? draft.node(n.parent) : undefined; cur; ) {
      if (isOwner(cur)) {
        owner = cur;
        break;
      }
      cur = cur.parent ? draft.node(cur.parent) : undefined;
    }
    let nid: string | undefined;
    if (!n.section && owner && inSubtree.has(owner.id)) {
      const prefix = `${owner.id}/`;
      const rel = n.id.startsWith(prefix)
        ? n.id.slice(prefix.length)
        : owner.id === root.id && opts.scopeRoot
          ? n.id.split('/').at(-1)
          : undefined;
      if (rel) nid = `${idMap.get(owner.id)}/${rel}`;
    }
    if (!nid || !free(nid))
      nid = n.section ? allocateId(ctx, n.section.name) : allocateCopyId(ctx, nid ?? n.id);
    while (!free(nid)) nid = allocateCopyId(ctx, nid);
    claimed.add(nid);
    idMap.set(n.id, nid);
  }
  for (const n of subtree) {
    const isRoot = n.id === root.id;
    let copy: BNode = {
      ...clone(n),
      id: idMap.get(n.id)!,
      parent: isRoot ? opts.parent : idMap.get(n.parent!)!,
      order: isRoot ? opts.order : n.order,
    };
    if (n.part && n.key !== undefined) {
      const last = copy.id.split('/').pop()!;
      if (last.startsWith(`${n.part}-`)) copy.key = last.slice(n.part.length + 1);
    }
    if (opts.transform) copy = opts.transform(copy, n);
    draft.setNode(copy);
  }
  return idMap;
}

export function resolveParent(
  ctx: OpContext,
  pageId?: string,
  parentId?: NodeId,
): BNode | undefined {
  if (parentId) return requireNode(ctx, parentId);
  const pages = ctx.draft.pages();
  const page = pageId ? ctx.draft.page(pageId) : pages.length === 1 ? pages[0] : undefined;
  if (!page) {
    if (pageId) {
      return fail(ctx, {
        code: 'not_found',
        message: `No page "${pageId}".${didYouMean(
          pageId,
          pages.map((p) => p.id),
        )}`,
        hint: `Pages: ${pages.map((p) => p.id).join(', ') || '(none)'}.`,
      });
    }
    return fail(ctx, {
      code: 'invalid_op',
      message: pages.length
        ? 'The site has several pages; give "page" (or "parent").'
        : 'The site has no pages yet; create one with page.create first.',
      ...(pages.length ? { hint: `Pages: ${pages.map((p) => p.id).join(', ')}.` } : {}),
    });
  }
  return ctx.draft.node(page.rootId);
}

// ---------------------------------------------------------------------------------------------
// Node creation

function createTree(
  ctx: OpContext,
  input: NodeInput,
  parent: BNode,
  order: string,
  scope: string,
  opts: { id?: string; section?: SectionRef; explicit?: boolean } = {},
): BNode | undefined {
  const { draft, registry } = ctx;
  const def = registry.component(input.type);
  if (!def) {
    const isSection = !!registry.section(input.type);
    const insertable = registry.listComponents().filter((c) => c.insertable !== false);
    return fail(ctx, {
      code: 'unknown_type',
      message: `Unknown component type "${input.type}".${
        isSection
          ? ''
          : didYouMean(
              input.type,
              insertable.map((c) => c.name),
            )
      }`,
      hint: isSection
        ? `"${input.type}" is a section; insert it with the section.insert op.`
        : `Types: ${insertable.map((c) => c.name).join(', ')}.`,
    });
  }
  if (def.insertable === false) {
    return fail(ctx, { code: 'unknown_type', message: `"${def.name}" nodes can't be inserted.` });
  }
  if (!registry.accepts(parent.type, def.name)) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `"${parent.id}" (${parent.type}) can't contain a ${def.name}.`,
      hint: 'Insert into a box (or another container) instead.',
    });
  }
  if (input.children?.length && def.children === false) {
    return fail(ctx, { code: 'invalid_parent', message: `A ${def.name} can't have children.` });
  }
  if (depthOf(draft, parent.id) + 1 > MAX_DEPTH) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `Nodes can be nested at most ${MAX_DEPTH} levels deep.`,
    });
  }

  const exists = (id: string) => draft.has(id);
  // `opts.id` comes from the caller (a section root it already checked); `input.id` from the op.
  const explicit = opts.id ?? input.id;
  let id: string;
  if (opts.id) {
    if (exists(opts.id))
      return fail(ctx, {
        code: 'duplicate_id',
        nodeId: opts.id,
        message: `A node "${opts.id}" already exists.`,
      });
    id = opts.id;
  } else if (explicit) {
    if (!isValidId(explicit)) {
      return fail(ctx, {
        code: 'invalid_id',
        message: `"${explicit}" is not a valid id.`,
        hint: 'Ids are lowercase kebab-case segments separated by "/", e.g. "hero-1/heading".',
      });
    }
    // A scoped id (`cta-1/heading`) must continue the scope it is created in, or it would take
    // the place of another section's part.
    if (!fitsScope(explicit, scope)) {
      return fail(ctx, {
        code: 'invalid_id',
        nodeId: explicit,
        message: `"${explicit}" doesn't fit under "${parent.id}": ids of nodes created there look like "${scope}<name>".`,
        hint: 'Leave the id out to get one generated.',
      });
    }
    const problem = newIdProblem(draft, explicit);
    if (problem)
      return fail(ctx, {
        code: 'duplicate_id',
        nodeId: explicit,
        message: problem,
        hint: 'Leave the id out to get a fresh one.',
      });
    id = explicit;
  } else if (input.part) {
    id = scope + slugify(input.key ? `${input.part}-${input.key}` : input.part);
    if (exists(id)) id = allocateCopyId(ctx, id);
  } else {
    id = allocateId(ctx, scope + slugify(input.type));
  }

  const before = ctx.issues.length;
  const props = validateProps(ctx, def, input.props ?? {}, id);
  const sctx = styleContext(ctx, parent.id, opts.section);

  let styles: NodeStyles | undefined = input.styles ? clone(input.styles) : undefined;
  for (const [bp, states] of Object.entries(input.styles ?? {})) {
    for (const [state, decls] of Object.entries(states)) {
      if (!checkBpState(ctx, id, bp, state)) continue;
      const entries = Object.entries(decls);
      for (const [prop, value] of entries) {
        const issue = checkProperty(prop);
        if (issue) fail(ctx, { ...issue, nodeId: id });
        if (typeof value !== 'string') {
          fail(ctx, {
            code: 'invalid_style',
            nodeId: id,
            path: prop,
            message: `Value for "${prop}" must be a string.`,
          });
        }
      }
      checkDecls(
        ctx,
        id,
        entries.filter(([p, v]) => !checkProperty(p) && typeof v === 'string'),
        sctx,
      );
    }
  }
  if (input.css) {
    const parsed = parseDeclarations(input.css);
    for (const i of parsed.issues) fail(ctx, { ...i, nodeId: id });
    checkDecls(ctx, id, parsed.decls, sctx);
    const baseBp = draft.breakpoints()[0]!.id;
    styles ??= {};
    const states = ensure(styles, baseBp, () => ({}));
    states.default = { ...(states.default ?? {}), ...Object.fromEntries(parsed.decls) };
  }
  if (input.vars) {
    checkVars(
      ctx,
      id,
      input.vars,
      sctx,
      sectionVarNames(draft, ctx.registry, parent.id, opts.section),
    );
  }
  if (!props || ctx.issues.length > before) return undefined;

  const node: BNode = { id, type: def.name, parent: parent.id, order, props };
  const pruned = styles ? pruneEmpty(styles) : undefined;
  if (pruned) node.styles = pruned;
  if (input.vars && Object.keys(input.vars).length) node.vars = { ...input.vars };
  if (opts.section) node.section = opts.section;
  else {
    if (input.part) node.part = slugify(input.part);
    if (input.key) node.key = slugify(input.key);
  }
  if (input.name) node.name = input.name;
  draft.setNode(node);
  // What a node.insert spells out is the actor's own (a section template's copy is not).
  if (opts.explicit) {
    markExplicit(ctx, id, [
      ...Object.keys(input.props ?? {}).map((k) => `props.${k}`),
      ...(node.styles ? ['styles'] : []),
      ...(node.vars ? ['vars'] : []),
    ]);
  }

  const childScope = node.section || node.key ? `${id}/` : scope;
  let prev: string | undefined;
  for (const child of input.children ?? []) {
    const childOrder = keyBetween(prev, undefined);
    prev = childOrder;
    if (!createTree(ctx, child, node, childOrder, childScope, { explicit: !!opts.explicit }))
      return undefined;
  }
  return node;
}

export function setProps(ctx: OpContext, node: BNode, patch: Record<string, unknown>) {
  const def = ctx.registry.component(node.type);
  if (!def)
    return fail(ctx, {
      code: 'unknown_type',
      nodeId: node.id,
      message: `Unknown component type "${node.type}".`,
    });
  const merged: Record<string, unknown> = { ...node.props };
  for (const [k, v] of Object.entries(patch)) {
    if (!isSafeKey(k)) {
      return fail(ctx, {
        code: 'unknown_prop',
        nodeId: node.id,
        path: k,
        message: `"${k}" is not a valid prop name.`,
      });
    }
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const props = validateProps(ctx, def, merged, node.id);
  if (!props) return undefined;
  markExplicit(
    ctx,
    node.id,
    Object.keys(patch).map((k) => `props.${k}`),
  );
  const next: BNode = { ...node, props };
  if (node.link && node.l10n) {
    // An instance that now says something else than its definition can't keep the definition's
    // translations of that text: they translate different words. Its own translations stay.
    const source = ctx.draft.node(node.link.node);
    const l10n = clone(node.l10n);
    for (const [locale, values] of Object.entries(l10n)) {
      for (const prop of def.contentProps ?? []) {
        if (!(prop in values) || deepEqual(props[prop], source?.props[prop])) continue;
        if (deepEqual(values[prop], source?.l10n?.[locale]?.[prop])) delete values[prop];
      }
      if (!Object.keys(values).length) delete l10n[locale];
    }
    if (Object.keys(l10n).length) next.l10n = l10n;
    else delete next.l10n;
  }
  ctx.draft.setNode(next);
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Op handlers

export type OpOf<K extends Op['op']> = Extract<Op, { op: K }>;

function sectionInsert(ctx: OpContext, op: OpOf<'section.insert'>) {
  const { draft, registry } = ctx;
  const def = registry.section(op.section);
  if (!def) {
    return fail(ctx, {
      code: 'unknown_section',
      message: `Unknown section "${op.section}".${didYouMean(
        op.section,
        registry.listSections().map((s) => s.name),
      )}`,
      hint: `Sections: ${registry
        .listSections()
        .map((s) => s.name)
        .join(', ')}.`,
    });
  }
  const parent = resolveParent(ctx, op.page, op.parent);
  if (!parent || !guardParent(ctx, parent)) return;
  const { variant, errors } = resolveVariant(def, op.variant);
  for (const message of errors) fail(ctx, { code: 'invalid_variant', message });
  if (errors.length) return;
  if (op.id && (!isValidId(op.id) || op.id.includes('/'))) {
    return fail(ctx, {
      code: 'invalid_id',
      message: `"${op.id}" is not a valid section id.`,
      hint: 'Section ids are one lowercase kebab-case segment, e.g. "hero-2"; leave it out to get one generated.',
    });
  }
  const problem = op.id ? newIdProblem(draft, op.id) : undefined;
  if (problem) {
    return fail(ctx, {
      code: 'duplicate_id',
      nodeId: op.id,
      message: problem,
      hint: 'Leave the id out to get a fresh one.',
    });
  }
  let id = op.id;
  // A generated id never lands on a scope that stray nodes already use (`cta-1/…` without cta-1).
  while (!id || scopeInUse(draft, id)) id = allocateId(ctx, def.name);
  const order = positionKey(ctx, parent.id, op.before, op.after);
  if (order === undefined) return;
  let template: NodeInput;
  try {
    template = def.template({ variant });
  } catch (error) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Section "${def.name}" failed to build: ${String(error)}`,
    });
  }
  const root = createTree(ctx, template, parent, order, '', {
    id,
    section: { name: def.name, version: def.version, variant },
  });
  if (!root) return;
  checkLinkNesting(ctx, root);
  for (const [partPath, patch] of Object.entries(op.content ?? {})) {
    const target = draft.node(`${id}/${partPath}`);
    if (!target) {
      const parts = descendants(draft, id)
        .filter((n) => n.id.startsWith(`${id}/`))
        .map((n) => n.id.slice(id.length + 1));
      fail(ctx, {
        code: 'unknown_part',
        nodeId: id,
        path: partPath,
        message: `Section "${def.name}" has no part "${partPath}".${didYouMean(partPath, parts)}`,
        hint: `Parts: ${listPreview(parts, 30)}.`,
      });
      continue;
    }
    setProps(ctx, target, patch);
  }
}

function nodeInsert(ctx: OpContext, op: OpOf<'node.insert'>) {
  const parent = requireNode(ctx, op.parent);
  if (!parent || !guardParent(ctx, parent)) return;
  const order = positionKey(ctx, parent.id, op.before, op.after);
  if (order === undefined) return;
  const node = createTree(ctx, op.node, parent, order, scopeFor(ctx.draft, parent.id), {
    explicit: true,
  });
  if (node) checkLinkNesting(ctx, node);
}

const INTERACTIVE = new Set(['link', 'button']);

/**
 * Fails if `node` (just placed) puts a link or button somewhere inside a link: browsers split
 * nested interactive content, so the page would no longer match the document.
 */
function checkLinkNesting(ctx: OpContext, node: BNode): void {
  const link = ancestors(ctx.draft, node.id).find((a) => a.type === 'link');
  if (!link) return;
  const inner = [node, ...descendants(ctx.draft, node.id)].find((n) => INTERACTIVE.has(n.type));
  if (!inner) return;
  fail(ctx, {
    code: 'invalid_parent',
    nodeId: inner.id,
    message: `"${inner.id}" (${inner.type}) can't be inside link "${link.id}": links can't contain links or buttons.`,
    hint: `Put it next to "${link.id}" instead.`,
  });
}

function nodeMove(ctx: OpContext, op: OpOf<'node.move'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null)
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: `"${node.id}" is a page or symbol root and can't be moved.`,
    });
  if (!guardInstance(ctx, node, 'move it')) return;
  const parent = op.parent ? requireNode(ctx, op.parent) : ctx.draft.node(node.parent);
  if (!parent) return;
  if (parent.id !== node.parent && !guardParent(ctx, parent)) return;
  if (definitionOf(ctx.draft, parent.id)?.id !== definitionOf(ctx.draft, node.id)?.id) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: node.id,
      message: `Can't move "${node.id}" into or out of a symbol definition.`,
      hint: 'Use symbol.create to make a definition from a node, or node.duplicate to copy nodes.',
    });
  }
  if (parent.id === node.id || ancestors(ctx.draft, parent.id).some((a) => a.id === node.id)) {
    return fail(ctx, {
      code: 'cycle',
      nodeId: node.id,
      message: `Can't move "${node.id}" into itself or its own descendant "${parent.id}".`,
    });
  }
  if (!ctx.registry.accepts(parent.type, node.type)) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `"${parent.id}" (${parent.type}) can't contain a ${node.type}.`,
    });
  }
  if (depthOf(ctx.draft, parent.id) + 1 + subtreeHeight(ctx.draft, node.id) > MAX_DEPTH) {
    return fail(ctx, {
      code: 'invalid_parent',
      nodeId: parent.id,
      message: `Moving "${node.id}" there would nest nodes more than ${MAX_DEPTH} levels deep.`,
    });
  }
  const order = positionKey(ctx, parent.id, op.before, op.after, node.id);
  if (order === undefined) return;
  const moved = { ...node, parent: parent.id, order };
  ctx.draft.setNode(moved);
  checkLinkNesting(ctx, moved);
}

function nodeRemove(ctx: OpContext, op: OpOf<'node.remove'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null) {
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: `"${node.id}" is a page or symbol root and can't be removed this way.`,
      hint: 'Use page.remove or symbol.remove.',
    });
  }
  if (!guardInstance(ctx, node, 'remove it')) return;
  for (const d of descendants(ctx.draft, node.id)) {
    retireId(ctx, d.id);
    ctx.draft.deleteNode(d.id);
  }
  retireId(ctx, node.id);
  ctx.draft.deleteNode(node.id);
}

function nodeDuplicate(ctx: OpContext, op: OpOf<'node.duplicate'>) {
  const { draft } = ctx;
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null)
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: `"${node.id}" is a page or symbol root and can't be duplicated.`,
    });
  if (!guardInstance(ctx, node, 'duplicate it')) return;
  // An explicit id for the copy (pinned by proposals and sync, so later ops can refer to it).
  if (op.copy) {
    const problem = !isValidId(op.copy)
      ? `"${op.copy}" is not a valid id.`
      : !fitsScope(op.copy, scopeFor(draft, node.parent))
        ? `"${op.copy}" doesn't fit next to "${node.id}": ids there look like "${scopeFor(draft, node.parent)}<name>".`
        : newIdProblem(draft, op.copy);
    if (problem) {
      return fail(ctx, {
        code: 'invalid_id',
        nodeId: op.copy,
        message: problem,
        hint: 'Leave "copy" out to get an id generated.',
      });
    }
  }
  const order = orderNextTo(draft.children(node.parent), node.order, 'after');
  // Instance copies keep their links (a copy of an instance is another instance), and start
  // from the same definition state as their source, so sync in this transaction treats them alike.
  const idMap = copySubtree(ctx, node, {
    parent: node.parent,
    order,
    rootId: op.copy ?? allocateCopyId(ctx, node.id),
  });
  for (const [from, to] of idMap) {
    const src = draft.node(from);
    if (!src?.link) continue;
    const base = ctx.linkBase?.get(from) ?? own(draft.base.nodes, src.link.node);
    if (!base) continue;
    ctx.linkBase ??= new Map();
    ctx.linkBase.set(to, base);
  }
}

function textEdit(ctx: OpContext, op: OpOf<'text.edit'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  const key = op.prop ?? 'text';
  const locale = translationLocale(ctx, op.locale);
  if (locale === null) return;
  // A translation starts from the default text until it has its own.
  const current = locale ? (node.l10n?.[locale]?.[key] ?? node.props[key]) : node.props[key];
  if (typeof current !== 'string') {
    return fail(ctx, {
      code: 'invalid_op',
      nodeId: node.id,
      message: `"${node.id}" has no text prop "${key}".`,
    });
  }
  const count = current.split(op.find).length - 1;
  if (count === 0) {
    return fail(ctx, {
      code: 'text_not_found',
      nodeId: node.id,
      message: `"${op.find}" was not found in ${node.id}.${key}.`,
      hint: `Current text: "${truncate(current, 200)}".`,
    });
  }
  if (count > 1) {
    return fail(ctx, {
      code: 'ambiguous_text',
      nodeId: node.id,
      message: `"${op.find}" occurs ${count} times in ${node.id}.${key}.`,
      hint: 'Include more surrounding text so the match is unique.',
    });
  }
  const patch = { [key]: current.replace(op.find, () => op.replace) };
  if (locale) setTranslation(ctx, node, locale, patch);
  else setProps(ctx, node, patch);
}

const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * The locale an op writes to: `undefined` for the default language, `null` (after reporting an
 * error) if the locale isn't one of the site's.
 */
function translationLocale(ctx: OpContext, locale: string | undefined): string | undefined | null {
  const settings = ctx.draft.locales();
  // A site without languages set is in English ("en" is the implicit default).
  if (!locale || locale === (settings?.default ?? 'en')) return undefined;
  if (settings?.others.includes(locale)) return locale;
  const add = JSON.stringify(locale);
  fail(ctx, {
    code: 'unknown_locale',
    message: `The site has no language "${locale}".${didYouMean(locale, settings?.others ?? [])}`,
    hint: settings
      ? `Languages: ${[settings.default, ...settings.others].join(', ')}. Add it with {"op":"locale.set","add":[${add}]}.`
      : `Add it with {"op":"locale.set","default":"<language of the current content>","add":[${add}]}.`,
  });
  return null;
}

/** Writes translated content props (validated like the props themselves; null removes). */
function setTranslation(
  ctx: OpContext,
  node: BNode,
  locale: string,
  patch: Record<string, unknown>,
): void {
  const def = ctx.registry.component(node.type);
  if (!def) return;
  const content = new Set(def.contentProps ?? []);
  const keys = Object.keys(patch);
  const other = keys.filter((k) => !content.has(k));
  if (other.length) {
    fail(ctx, {
      code: 'invalid_props',
      nodeId: node.id,
      path: other[0],
      message: `Only content can be translated; ${other.join(', ')} ${other.length === 1 ? 'is' : 'are'} not a content prop of ${def.name}.`,
      hint: `Translatable props of ${def.name}: ${[...content].join(', ') || '(none)'}. Set others without "locale".`,
    });
    return;
  }
  // Validate against the component schema by trying the values in place of the defaults.
  const trial = { ...node.props };
  for (const [k, v] of Object.entries(patch)) if (v !== null) trial[k] = v as never;
  const props = validateProps(ctx, def, trial, node.id);
  if (!props) return;
  const current = { ...(node.l10n?.[locale] ?? {}) };
  for (const k of keys) {
    if (patch[k] === null) delete current[k];
    else current[k] = props[k]!;
  }
  const l10n = { ...(node.l10n ?? {}) };
  if (Object.keys(current).length) l10n[locale] = current;
  else delete l10n[locale];
  const next: BNode = { ...node, l10n };
  if (!Object.keys(l10n).length) delete next.l10n;
  ctx.draft.setNode(next);
  markExplicit(
    ctx,
    node.id,
    keys.map((k) => `l10n.${locale}.${k}`),
  );
}

function localeSet(ctx: OpContext, op: OpOf<'locale.set'>) {
  const { draft } = ctx;
  const current = draft.locales();
  const bad = [op.default, ...(op.add ?? []), ...(op.remove ?? [])].filter(
    (l): l is string => typeof l === 'string' && !LOCALE.test(l),
  );
  if (bad.length) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Not a language code: ${bad.join(', ')}.`,
      hint: 'Use codes like "en", "de", "pt-BR".',
    });
  }
  const hasTranslations =
    draft.nodeIds().some((id) => draft.node(id)?.l10n) || draft.pages().some((p) => p.l10n);
  const nextDefault = op.default ?? current?.default ?? 'en';
  const currentDefault = current?.default ?? 'en';
  if (op.default && op.default !== currentDefault && hasTranslations) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Can't change the default language from "${currentDefault}" to "${op.default}" once there are translations.`,
    });
  }
  if (!op.default && op.add?.length && op.add.every((l) => l === nextDefault)) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `"${nextDefault}" is already the default language (the content itself).`,
      hint: current
        ? 'Add other languages to translate into.'
        : `If the content is in another language, say so: {"op":"locale.set","default":"<content language>","add":["${nextDefault}"]}.`,
    });
  }
  const others = new Set(current?.others ?? []);
  // Language codes are case-insensitive: "pt-BR" and "pt-br" publish to the same /pt-br/ tree.
  for (const l of op.add ?? []) {
    const same = [nextDefault, ...others, ...(op.add ?? [])].find(
      (o) => o !== l && o.toLowerCase() === l.toLowerCase(),
    );
    if (same) {
      return fail(ctx, {
        code: 'invalid_op',
        message: `"${l}" is the same language as "${same}" (codes ignore case).`,
        hint: `Use "${same}".`,
      });
    }
  }
  for (const l of op.add ?? []) if (l !== nextDefault) others.add(l);
  for (const l of op.remove ?? []) {
    if (l === nextDefault) {
      return fail(ctx, {
        code: 'invalid_op',
        message: `"${l}" is the default language and can't be removed.`,
      });
    }
    others.delete(l);
  }
  others.delete(nextDefault);
  // A page at "/de" would clash with the "de" language's pages when published.
  for (const l of others) {
    if (current?.others.includes(l)) continue;
    const clash = draft.pages().find((p) => firstSegment(p.path) === l.toLowerCase());
    if (clash) {
      return fail(ctx, {
        code: 'invalid_op',
        message: `Page "${clash.id}" (${clash.path}) uses the path of language "${l}", whose pages are published under /${l}/.`,
        hint: 'Move that page first (page.update with another path).',
      });
    }
  }
  // Translations of removed languages go too (undo brings them back).
  for (const l of op.remove ?? []) {
    for (const id of draft.nodeIds()) {
      const n = draft.node(id)!;
      if (!n.l10n?.[l]) continue;
      const { [l]: _, ...rest } = n.l10n;
      const next: BNode = { ...n, l10n: rest };
      if (!Object.keys(rest).length) delete next.l10n;
      draft.setNode(next);
    }
    for (const p of draft.pages()) {
      if (!p.l10n?.[l]) continue;
      const { [l]: _, ...rest } = p.l10n;
      const next: Page = { ...p, l10n: rest };
      if (!Object.keys(rest).length) delete next.l10n;
      draft.setPage(next);
    }
  }
  // Keep a declared default language even without translations ({default: "de", others: []}).
  draft.setLocales(
    others.size || nextDefault !== 'en'
      ? { default: nextDefault, others: [...others].sort() }
      : undefined,
  );
}

/** "/de/about" → "de"; "/" → "". Lower-cased, without a trailing slash. */
function firstSegment(path: string): string {
  return path.split('/')[1]?.toLowerCase() ?? '';
}

/**
 * Paths that publish to the same place: "/about" and "/about/", and "/About" (static export writes
 * folders, which are case-insensitive on macOS and Windows).
 */
export function samePagePath(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p).toLowerCase();
  return norm(a) === norm(b);
}

/** Refuses a path another page publishes to, or one that clashes with a language's pages. */
function checkPagePath(ctx: OpContext, path: string, pageId?: string): boolean {
  const other = ctx.draft.pages().find((p) => p.id !== pageId && samePagePath(p.path, path));
  if (other) {
    fail(ctx, {
      code: 'duplicate_id',
      message:
        other.path === path
          ? `Page "${other.id}" already uses the path "${path}".`
          : `Page "${other.id}" already uses "${other.path}", the same ${other.path.replace(/\/+$/, '') === path.replace(/\/+$/, '') ? 'URL' : 'URL once letter case is ignored (as exported folders are on macOS and Windows)'} as "${path}".`,
    });
    return false;
  }
  const settings = ctx.draft.locales();
  const lang = settings?.others.find((l) => l.toLowerCase() === firstSegment(path));
  if (lang) {
    fail(ctx, {
      code: 'invalid_op',
      message: `"${path}" is where the "${lang}" translation of the site is published.`,
      hint: `Pick another path; to translate a page, use props.set or page.update with "locale": "${lang}".`,
    });
    return false;
  }
  return true;
}

function styleSet(ctx: OpContext, op: OpOf<'style.set'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  const bp = op.bp ?? ctx.draft.breakpoints()[0]!.id;
  const state = op.state ?? 'default';
  if (!checkBpState(ctx, node.id, bp, state)) return;
  const before = ctx.issues.length;
  const parsed = parseDeclarations(op.css ?? '');
  for (const i of parsed.issues) fail(ctx, { ...i, nodeId: node.id });
  checkDecls(ctx, node.id, parsed.decls, styleContext(ctx, node.id));
  if (ctx.issues.length > before) return;
  if (!parsed.decls.length && !op.remove?.length && !op.replace) {
    return fail(ctx, {
      code: 'invalid_op',
      nodeId: node.id,
      message: 'Nothing to change: give "css" and/or "remove".',
    });
  }
  const styles: NodeStyles = clone(node.styles ?? {});
  const states = ensure(styles, bp, () => ({}));
  const block = op.replace ? {} : { ...(states[state] ?? {}) };
  for (const [p, v] of parsed.decls) block[p] = v;
  for (const p of op.remove ?? []) delete block[p.trim().toLowerCase()];
  states[state] = block;
  const next: BNode = { ...node };
  const pruned = pruneEmpty(styles);
  if (pruned) next.styles = pruned;
  else delete next.styles;
  ctx.draft.setNode(next);
  markExplicit(ctx, node.id, ['styles']);
}

function varsSet(ctx: OpContext, op: OpOf<'vars.set'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  const before = ctx.issues.length;
  checkVars(
    ctx,
    node.id,
    op.vars,
    styleContext(ctx, node.id),
    sectionVarNames(ctx.draft, ctx.registry, node.id),
  );
  if (ctx.issues.length > before) return;
  const vars = { ...(node.vars ?? {}) };
  for (const [k, v] of Object.entries(op.vars)) {
    if (v === null) delete vars[k];
    else vars[k] = v;
  }
  const next: BNode = { ...node };
  if (Object.keys(vars).length) next.vars = vars;
  else delete next.vars;
  ctx.draft.setNode(next);
  markExplicit(ctx, node.id, ['vars']);
}

const PATH_SEGMENT = /^[A-Za-z0-9\-._~]+$/;

/** "/" or "/a/b": URL-safe segments, no empty, "." or ".." segments (so no "//host" links). */
export function isValidPagePath(path: string): boolean {
  if (path === '/') return true;
  if (!path.startsWith('/') || path.length > 200) return false;
  const segments = path.slice(1).split('/');
  if (segments.at(-1) === '') segments.pop();
  return (
    segments.length > 0 && segments.every((s) => PATH_SEGMENT.test(s) && s !== '.' && s !== '..')
  );
}

const EMPTY_TITLE = {
  code: 'invalid_op',
  message: "A page title can't be empty.",
  hint: 'Give the page a short title; it shows in browser tabs, search results and page menus.',
} as const;

function pageCreate(ctx: OpContext, op: OpOf<'page.create'>) {
  const { draft } = ctx;
  if (!op.title.trim()) return fail(ctx, EMPTY_TITLE);
  if (!isValidPagePath(op.path)) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Page path "${op.path}" must start with "/" and use URL-safe segments (no "//", "." or "..").`,
    });
  }
  if (!checkPagePath(ctx, op.path)) return;
  let id = op.id ?? (op.path === '/' ? 'home' : slugify(op.path, 'page'));
  if (!PAGE_ID_PATTERN.test(id))
    return fail(ctx, {
      code: 'invalid_id',
      message: `"${id}" is not a valid page id (kebab-case).`,
    });
  if (draft.page(id)) {
    if (op.id)
      return fail(ctx, { code: 'duplicate_id', message: `A page "${id}" already exists.` });
    let n = 1;
    while (draft.page(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  // A page root id is reused only if it was never used before.
  let rootId = `root-${id}`;
  if (draft.has(rootId) || draft.counter(rootId) > 0) rootId = allocateId(ctx, rootId);
  else draft.useCounter(rootId, 1);
  draft.setNode({ id: rootId, type: 'root', parent: null, order: 'a0', props: {} });
  draft.setPage({ id, path: op.path, title: op.title, rootId });
}

function pageUpdate(ctx: OpContext, op: OpOf<'page.update'>) {
  const page = ctx.draft.page(op.id);
  if (!page) return fail(ctx, { code: 'not_found', message: `No page "${op.id}".` });
  if (op.locale !== undefined) {
    const locale = translationLocale(ctx, op.locale);
    if (locale === null) return;
    if (locale) {
      if (op.path !== undefined) {
        return fail(ctx, {
          code: 'invalid_op',
          message: `Pages have one path in every language ("${op.locale}" pages are published under /${op.locale}/).`,
          hint: 'Set the path without "locale".',
        });
      }
      // An empty string removes that translation.
      const current = { ...(page.l10n?.[locale] ?? {}) };
      for (const key of ['title', 'description'] as const) {
        const value = op[key];
        if (value === undefined) continue;
        if (value === '') delete current[key];
        else current[key] = value;
      }
      const l10n = { ...(page.l10n ?? {}) };
      if (Object.keys(current).length) l10n[locale] = current;
      else delete l10n[locale];
      const next: Page = { ...page, l10n };
      if (!Object.keys(l10n).length) delete next.l10n;
      ctx.draft.setPage(next);
      return;
    }
  }
  if (op.title !== undefined && !op.title.trim()) return fail(ctx, EMPTY_TITLE);
  if (op.path !== undefined) {
    if (!isValidPagePath(op.path))
      return fail(ctx, { code: 'invalid_op', message: `Page path "${op.path}" is not valid.` });
    if (!checkPagePath(ctx, op.path, page.id)) return;
  }
  ctx.draft.setPage({
    ...page,
    ...(op.path !== undefined ? { path: op.path } : {}),
    ...(op.title !== undefined ? { title: op.title } : {}),
    ...(op.description !== undefined ? { description: op.description } : {}),
  });
}

function pageRemove(ctx: OpContext, op: OpOf<'page.remove'>) {
  const page = ctx.draft.page(op.id);
  if (!page) return fail(ctx, { code: 'not_found', message: `No page "${op.id}".` });
  if (ctx.draft.pages().length <= 1)
    return fail(ctx, { code: 'invalid_op', message: "The last page can't be removed." });
  for (const d of descendants(ctx.draft, page.rootId)) {
    retireId(ctx, d.id);
    ctx.draft.deleteNode(d.id);
  }
  ctx.draft.useCounter(page.rootId, 1);
  ctx.draft.deleteNode(page.rootId);
  ctx.draft.deletePage(page.id);
}

const varRefs = (css: string) => [...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((m) => m[1]!);

/**
 * A token alias chain that loops back to `start`, if any (e.g. a → b → a). With `theme`, the
 * theme's values replace the base values they override, as they do in CSS.
 */
function aliasCycle(
  tokens: TokenTree,
  startVar: string,
  theme?: Record<string, string>,
): string[] | undefined {
  const refs = new Map<string, string[]>();
  for (const t of flattenTokens(tokens).tokens) refs.set(t.cssVar, varRefs(t.value));
  for (const [path, value] of Object.entries(theme ?? {}))
    refs.set(tokenVar(path), varRefs(aliasToCss(value)));
  const path: string[] = [];
  const visit = (name: string): boolean => {
    if (path.includes(name)) return name === startVar;
    path.push(name);
    for (const next of refs.get(name) ?? []) if (visit(next)) return true;
    path.pop();
    return false;
  };
  return visit(startVar) ? [...path, startVar] : undefined;
}

function tokenSet(ctx: OpContext, op: OpOf<'token.set'>) {
  const { draft } = ctx;
  const segs = op.path.split('.');
  if (!TOKEN_PATH.test(op.path) || !segs.every(isSafeKey)) {
    return fail(ctx, {
      code: 'invalid_token',
      path: op.path,
      message: `"${op.path}" is not a valid token path (e.g. "color.brand.600").`,
    });
  }
  const value = op.value;
  if (value !== null) {
    const syntax =
      value.length > 500 ? 'is too long' : cssValueSyntaxError(value.replace(/\{[^{}]+\}/g, 'x'));
    if (syntax) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `Token value "${value}" ${syntax}.`,
      });
    }
    const known = flattenTokens(draft.tokens()).tokens;
    const paths = known.map((t) => t.path);
    for (const alias of aliasesIn(value)) {
      if (alias === op.path) {
        return fail(ctx, {
          code: 'invalid_token',
          path: op.path,
          message: `"${op.path}" can't refer to itself ({${alias}}).`,
          hint: 'Give it a value, or the alias of another token.',
        });
      }
      if (!paths.includes(alias)) {
        return fail(ctx, {
          code: 'unknown_token',
          path: op.path,
          message: `Alias {${alias}} doesn't refer to an existing token.${didYouMean(alias, paths)}`,
        });
      }
    }
    const clash = known.find((t) => t.cssVar === tokenVar(op.path) && t.path !== op.path);
    if (clash) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `"${op.path}" would use the same CSS variable (${clash.cssVar}) as token "${clash.path}".`,
      });
    }
  }
  if (op.theme) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(op.theme) || !isSafeKey(op.theme)) {
      return fail(ctx, {
        code: 'invalid_token',
        message: `Theme name "${op.theme}" must be lowercase kebab-case.`,
      });
    }
    if (!getTokenLeaf(draft.tokens(), op.path)) {
      return fail(ctx, {
        code: 'not_found',
        path: op.path,
        message: `Theme values can only be set for existing tokens; "${op.path}" doesn't exist.`,
      });
    }
    const themes = clone(draft.themes());
    const theme = ensure(themes, op.theme, () => ({}));
    if (value === null) delete theme[op.path];
    else theme[op.path] = value;
    const cycle = value === null ? undefined : aliasCycle(draft.tokens(), tokenVar(op.path), theme);
    if (cycle) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `In theme "${op.theme}", token aliases would form a loop: ${cycle.join(' → ')}.`,
      });
    }
    if (!Object.keys(theme).length) delete themes[op.theme];
    draft.setThemes(themes);
    return;
  }
  const tokens = clone(draft.tokens());
  let group: Record<string, unknown> = tokens;
  for (const seg of segs.slice(0, -1)) {
    const next = own(group, seg);
    if (next === undefined) {
      if (value === null)
        return fail(ctx, { code: 'not_found', path: op.path, message: `No token "${op.path}".` });
      const created: Record<string, unknown> = {};
      group[seg] = created;
      group = created;
      continue;
    }
    if (!isPlainObject(next) || '$value' in next) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `"${seg}" in "${op.path}" is a token, not a group.`,
      });
    }
    group = next;
  }
  const last = segs.at(-1)!;
  const existing = own(group, last);
  const isGroup = isPlainObject(existing) && !('$value' in existing);
  if (value === null) {
    if (existing === undefined)
      return fail(ctx, { code: 'not_found', path: op.path, message: `No token "${op.path}".` });
    if (isGroup) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `"${op.path}" is a group of tokens; remove its tokens one by one.`,
      });
    }
    const users = tokenUsers(ctx, op.path);
    if (users.length && !op.force) {
      return fail(ctx, {
        code: 'token_in_use',
        path: op.path,
        message: `Token "${op.path}" is still used by ${listPreview(users, 8)}.`,
        hint: 'Change those references first, or pass "force": true to remove it anyway.',
      });
    }
    delete group[last];
    const themes = clone(draft.themes());
    let themesChanged = false;
    for (const theme of Object.values(themes)) {
      if (Object.hasOwn(theme, op.path)) {
        delete theme[op.path];
        themesChanged = true;
      }
    }
    if (themesChanged) draft.setThemes(themes);
  } else {
    if (isGroup) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `"${op.path}" is a group; set a token inside it.`,
      });
    }
    const leaf: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
    leaf.$value = value;
    if (op.type) leaf.$type = op.type;
    group[last] = leaf;
    // Check the base values, and each theme on top of them (a theme can close a loop too).
    for (const [name, theme] of [[undefined, undefined], ...Object.entries(draft.themes())] as [
      string | undefined,
      Record<string, string> | undefined,
    ][]) {
      const cycle = aliasCycle(tokens, tokenVar(op.path), theme);
      if (cycle) {
        return fail(ctx, {
          code: 'invalid_token',
          path: op.path,
          message: `${name ? `In theme "${name}", t` : 'T'}oken aliases would form a loop: ${cycle.join(' → ')}.`,
        });
      }
    }
  }
  draft.setTokens(tokens);
}

/** Nodes, sections and tokens that reference a token. */
function tokenUsers(ctx: OpContext, path: string): string[] {
  const cssVar = tokenVar(path);
  const ref = new RegExp(`var\\(\\s*${cssVar.replace(/[-]/g, '\\-')}\\s*[,)]`);
  const users: string[] = [];
  for (const id of ctx.draft.nodeIds()) {
    const n = ctx.draft.node(id)!;
    const values = [
      ...Object.values(n.vars ?? {}),
      ...Object.values(n.styles ?? {}).flatMap((states) =>
        Object.values(states).flatMap((decls) => Object.values(decls)),
      ),
    ];
    if (values.some((v) => ref.test(v))) users.push(`node "${id}"`);
  }
  for (const def of ctx.registry.listSections()) {
    const usesDefault = Object.values(def.vars ?? {}).some((v) => ref.test(v.default));
    if (usesDefault || ref.test(def.css ?? '')) users.push(`section "${def.name}"`);
  }
  for (const t of flattenTokens(ctx.draft.tokens()).tokens) {
    if (t.path !== path && ref.test(t.value)) users.push(`token "${t.path}"`);
  }
  for (const [theme, values] of Object.entries(ctx.draft.themes())) {
    for (const [p, v] of Object.entries(values)) {
      if (p !== path && (aliasesIn(v).includes(path) || ref.test(v)))
        users.push(`theme "${theme}" (${p})`);
    }
  }
  return users;
}

/**
 * Expands a section template in a scratch document (fresh id counters, so unnamed template nodes
 * get the ids they got when the section was inserted). Returns the nodes in document order.
 */
function expandTemplate(
  ctx: OpContext,
  def: SectionDef,
  variant: Record<string, string>,
  rootId: string,
): BNode[] | undefined {
  const scratchRoot: BNode = {
    id: 'scratch-root',
    type: 'root',
    parent: null,
    order: 'a0',
    props: {},
  };
  const { counters: _counters, ...base } = ctx.draft.base;
  const scratch = new Draft({
    ...base,
    nodes: { [scratchRoot.id]: scratchRoot },
    pages: {},
    tokens: ctx.draft.tokens(),
  });
  const sctx: OpContext = { ...ctx, draft: scratch, issues: [], warnings: [] };
  const section = { name: def.name, version: def.version, variant };
  let template: NodeInput;
  try {
    template = def.template({ variant });
  } catch (error) {
    fail(ctx, {
      code: 'invalid_op',
      message: `Section "${def.name}" failed to build: ${String(error)}`,
    });
    return undefined;
  }
  const root = createTree(sctx, template, scratchRoot, 'a0', '', { id: rootId, section });
  if (!root) {
    for (const issue of sctx.issues) fail(ctx, issue);
    return undefined;
  }
  return descendants(scratch, rootId);
}

/**
 * Switches a section's variant by merging, not rebuilding:
 * - every existing node stays where it is (people's moves and additions are kept);
 * - parts the new variant doesn't have are removed, and anything people added inside them moves up;
 * - parts new in this variant are created (with fresh ids if an id is taken);
 * - props merge three ways: values someone changed are kept, untouched template defaults follow the
 *   new variant;
 * - parts that are still where the template put them move to the new template's structure, and
 *   siblings are re-ordered to follow the new template.
 */
function sectionVariant(ctx: OpContext, op: OpOf<'section.variant'>) {
  const { draft, registry } = ctx;
  const root = requireNode(ctx, op.id);
  if (!root) return;
  const linkedInside = descendants(draft, root.id).find((d) => isLinked(draft, d));
  if (linkedInside && !isLinked(draft, root)) {
    return fail(ctx, {
      code: 'instance',
      nodeId: root.id,
      message: `"${root.id}" contains an instance of symbol "${linkedInside.link!.symbol}", which a variant change would rebuild.`,
      hint: `Move or detach "${instanceRootOf(draft, linkedInside.id)?.id ?? linkedInside.id}" first.`,
    });
  }
  if (isLinked(draft, root)) {
    return fail(ctx, {
      code: 'instance',
      nodeId: root.id,
      message: `"${root.id}" is ${isInstanceRoot(draft, root) ? 'an instance' : 'inside an instance'} of symbol "${root.link!.symbol}", so its variant follows the definition.`,
      hint: `Change the variant on the definition ("${root.link!.node}"), or run symbol.detach first.`,
    });
  }
  if (!root.section) {
    const owner = sectionRootOf(draft, root.id);
    return fail(ctx, {
      code: 'invalid_op',
      nodeId: root.id,
      message: `"${root.id}" is not a section root.`,
      ...(owner ? { hint: `It belongs to section "${owner.id}".` } : {}),
    });
  }
  const def = registry.section(root.section.name);
  if (!def) {
    return fail(ctx, {
      code: 'unknown_section',
      nodeId: root.id,
      message: `Unknown section "${root.section.name}".`,
    });
  }
  const { variant, errors } = resolveVariant(def, { ...root.section.variant, ...op.variant });
  for (const message of errors) fail(ctx, { code: 'invalid_variant', nodeId: root.id, message });
  if (errors.length || deepEqual(variant, root.section.variant)) return;
  const oldTemplate = expandTemplate(ctx, def, root.section.variant, root.id);
  const newTemplate = expandTemplate(ctx, def, variant, root.id);
  if (!oldTemplate || !newTemplate) return;
  const oldById = new Map(oldTemplate.map((n) => [n.id, n]));
  const newIds = new Set(newTemplate.map((n) => n.id));
  const inSection = new Set(descendants(draft, root.id).map((n) => n.id));

  // 1. Remove dropped parts; whatever is inside them that isn't dropped moves up.
  const dropped = [...inSection].filter((id) => oldById.has(id) && !newIds.has(id));
  const droppedSet = new Set(dropped);
  const survivingParent = (id: string): string => {
    let p = draft.node(id)?.parent ?? root.id;
    while (droppedSet.has(p)) p = draft.node(p)?.parent ?? root.id;
    return p;
  };
  for (const id of dropped) {
    for (const child of draft.children(id)) {
      if (!droppedSet.has(child.id)) draft.setNode({ ...child, parent: survivingParent(id) });
    }
  }
  for (const id of dropped) draft.deleteNode(id);

  // 2. Create parts that are new in this variant; map template ids to real ids.
  const idMap = new Map<string, string>([[root.id, root.id]]);
  for (const tmpl of newTemplate) {
    const parent = tmpl.parent ? idMap.get(tmpl.parent) : undefined;
    if (oldById.has(tmpl.id)) {
      // A part both variants share: keep it if it's still in the section; if someone deleted it or
      // moved it out, respect that.
      if (inSection.has(tmpl.id) && draft.has(tmpl.id)) idMap.set(tmpl.id, tmpl.id);
      continue;
    }
    if (!parent) continue;
    const id = draft.has(tmpl.id) ? allocateCopyId(ctx, tmpl.id) : tmpl.id;
    idMap.set(tmpl.id, id);
    draft.setNode({ ...clone(tmpl), id, parent, order: 'a0' });
  }

  // 3. Shared parts: three-way prop merge; follow the new structure unless someone moved them.
  for (const tmpl of newTemplate) {
    const before = oldById.get(tmpl.id);
    const now = idMap.get(tmpl.id) === tmpl.id ? draft.node(tmpl.id) : undefined;
    if (!before || !now || !inSection.has(tmpl.id)) continue;
    const next: BNode = { ...now };
    if (before.type === tmpl.type && now.type === tmpl.type) {
      const props: Record<string, unknown> = { ...now.props };
      for (const key of new Set([...Object.keys(before.props), ...Object.keys(tmpl.props)])) {
        if (!deepEqual(now.props[key], before.props[key])) continue;
        if (tmpl.props[key] === undefined) delete props[key];
        else props[key] = tmpl.props[key];
      }
      next.props = props as BNode['props'];
    }
    const oldParent = before.parent ? (idMap.get(before.parent) ?? before.parent) : undefined;
    const newParent = tmpl.parent ? idMap.get(tmpl.parent) : undefined;
    const untouched = now.parent === before.parent || now.parent === oldParent;
    const wouldCycle =
      newParent !== undefined &&
      (newParent === now.id || ancestors(draft, newParent).some((a) => a.id === now.id));
    if (untouched && newParent && newParent !== now.parent && !wouldCycle) next.parent = newParent;
    draft.setNode(next);
  }

  // 4. Re-order children of every template parent: template children in template order, other
  //    children stay after the template sibling they followed.
  const templateChildren = new Map<string, string[]>();
  for (const tmpl of newTemplate) {
    const parent = tmpl.parent ? idMap.get(tmpl.parent) : undefined;
    const id = idMap.get(tmpl.id);
    if (parent && id) templateChildren.set(parent, [...(templateChildren.get(parent) ?? []), id]);
  }
  for (const [parentId, ordered] of templateChildren) {
    const current = draft.children(parentId);
    const templateSet = new Set(ordered.filter((id) => current.some((c) => c.id === id)));
    const anchored = new Map<string, string[]>();
    let anchor = '';
    for (const child of current) {
      if (templateSet.has(child.id)) anchor = child.id;
      else anchored.set(anchor, [...(anchored.get(anchor) ?? []), child.id]);
    }
    const sequence = [...(anchored.get('') ?? [])];
    for (const id of ordered) {
      if (!templateSet.has(id)) continue;
      sequence.push(id, ...(anchored.get(id) ?? []));
    }
    let prev: string | undefined;
    for (const id of sequence) {
      const order = keyBetween(prev, undefined);
      prev = order;
      const n = draft.node(id)!;
      if (n.order !== order) draft.setNode({ ...n, order });
    }
  }

  if (dropped.length) {
    const top = dropped.filter((id) => !dropped.some((d) => d !== id && id.startsWith(`${d}/`)));
    ctx.warnings.push({
      code: 'parts_removed',
      opIndex: ctx.opIndex,
      nodeId: root.id,
      message: `The new variant has no ${listPreview(top)}; they were removed (undo restores them).`,
    });
  }
  draft.setNode({ ...draft.node(root.id)!, section: { ...root.section, variant } });
}

function propsSet(ctx: OpContext, op: OpOf<'props.set'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  const locale = translationLocale(ctx, op.locale);
  if (locale === null) return;
  if (locale) setTranslation(ctx, node, locale, op.props);
  else setProps(ctx, node, op.props);
}

const HANDLERS: { [K in Op['op']]: (ctx: OpContext, op: OpOf<K>) => unknown } = {
  'section.insert': sectionInsert,
  'section.variant': sectionVariant,
  'node.insert': nodeInsert,
  'node.move': nodeMove,
  'node.remove': nodeRemove,
  'node.duplicate': nodeDuplicate,
  'props.set': propsSet,
  'text.edit': textEdit,
  'style.set': styleSet,
  'vars.set': varsSet,
  'page.create': pageCreate,
  'page.update': pageUpdate,
  'page.remove': pageRemove,
  'token.set': tokenSet,
  'locale.set': localeSet,
  'symbol.create': symbolCreate,
  'symbol.insert': symbolInsert,
  'symbol.detach': symbolDetach,
  'symbol.reset': symbolReset,
  'symbol.update': symbolUpdate,
  'symbol.remove': symbolRemove,
};

/** Applies one op to the draft; problems are pushed to `ctx.issues`. */
export function applyOp(ctx: OpContext, op: Op): void {
  (HANDLERS[op.op] as (ctx: OpContext, op: Op) => unknown)(ctx, op);
}
