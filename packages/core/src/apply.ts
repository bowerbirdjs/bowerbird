import { ancestors, type DocView, descendants, sectionRootOf } from './doc.js';
import { Draft } from './draft.js';
import { didYouMean, type Issue, listPreview } from './errors.js';
import { duplicateId, isValidId, nextId, PAGE_ID_PATTERN, slugify } from './ids.js';
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
  checkValue,
  parseDeclarations,
  STATE_PSEUDO,
  type StyleCheckContext,
} from './styles.js';
import {
  aliasesIn,
  flattenTokens,
  getTokenLeaf,
  resolvedTokenValues,
  TOKEN_PATH,
  tokenVar,
} from './tokens.js';
import type { Actor, BNode, NodeId, NodeStyles, Props, SectionRef, TokenTree } from './types.js';
import { clone, deepEqual, ensure, isPlainObject, pruneEmpty } from './util.js';

export interface OpContext {
  draft: Draft;
  registry: Registry;
  actor: Actor;
  policy: Policy;
  opIndex: number;
  issues: Issue[];
  warnings: Issue[];
}

function fail(ctx: OpContext, issue: Omit<Issue, 'opIndex'>): undefined {
  ctx.issues.push({ ...issue, opIndex: ctx.opIndex });
  return undefined;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

function requireNode(ctx: OpContext, id: NodeId): BNode | undefined {
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
  if (!(state in STATE_PSEUDO)) {
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
function positionKey(
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
  if (!anchor) return safeKey(sibs.at(-1)?.order, undefined);
  const idx = sibs.findIndex((n) => n.id === anchor);
  if (idx < 0) {
    return fail(ctx, {
      code: 'not_found',
      nodeId: anchor,
      message: `"${anchor}" is not a child of "${parentId}".`,
      hint: `Children of ${parentId}: ${listPreview(sibs.map((s) => s.id)) || '(none)'}.`,
    });
  }
  return before
    ? safeKey(sibs[idx - 1]?.order, sibs[idx]!.order)
    : safeKey(sibs[idx]!.order, sibs[idx + 1]?.order);
}

function safeKey(a: string | undefined, b: string | undefined): string {
  if (a !== undefined && b !== undefined && a >= b) return keyBetween(a, undefined);
  return keyBetween(a, b);
}

/** Id prefix for new nodes under `parentId`: the nearest section root or keyed item. */
function scopeFor(view: DocView, parentId: NodeId): string {
  for (const n of [view.node(parentId), ...ancestors(view, parentId)]) {
    if (n && (n.section || n.key)) return `${n.id}/`;
  }
  return '';
}

function resolveParent(ctx: OpContext, pageId?: string, parentId?: NodeId): BNode | undefined {
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
  opts: { id?: string; section?: SectionRef } = {},
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

  const exists = (id: string) => draft.has(id);
  const explicit = opts.id ?? input.id;
  let id: string;
  if (explicit) {
    if (!isValidId(explicit)) {
      return fail(ctx, {
        code: 'invalid_id',
        message: `"${explicit}" is not a valid id.`,
        hint: 'Ids are lowercase kebab-case segments separated by "/", e.g. "hero-1/heading".',
      });
    }
    if (exists(explicit))
      return fail(ctx, {
        code: 'duplicate_id',
        nodeId: explicit,
        message: `A node "${explicit}" already exists.`,
      });
    id = explicit;
  } else if (input.part) {
    id = scope + slugify(input.key ? `${input.part}-${input.key}` : input.part);
    if (exists(id)) id = duplicateId(id, exists);
  } else {
    id = nextId(scope + slugify(input.type), exists);
  }

  const before = ctx.issues.length;
  const props = validateProps(ctx, def, input.props ?? {}, id);
  const sctx = styleContext(ctx, parent.id, opts.section);

  let styles: NodeStyles | undefined = input.styles ? clone(input.styles) : undefined;
  for (const [bp, states] of Object.entries(input.styles ?? {})) {
    for (const [state, decls] of Object.entries(states)) {
      if (checkBpState(ctx, id, bp, state)) checkDecls(ctx, id, Object.entries(decls), sctx);
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

  const childScope = node.section || node.key ? `${id}/` : scope;
  let prev: string | undefined;
  for (const child of input.children ?? []) {
    const childOrder = keyBetween(prev, undefined);
    prev = childOrder;
    if (!createTree(ctx, child, node, childOrder, childScope)) return undefined;
  }
  return node;
}

function setProps(ctx: OpContext, node: BNode, patch: Record<string, unknown>) {
  const def = ctx.registry.component(node.type);
  if (!def)
    return fail(ctx, {
      code: 'unknown_type',
      nodeId: node.id,
      message: `Unknown component type "${node.type}".`,
    });
  const merged: Record<string, unknown> = { ...node.props };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
  }
  const props = validateProps(ctx, def, merged, node.id);
  if (props) ctx.draft.setNode({ ...node, props });
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Op handlers

type OpOf<K extends Op['op']> = Extract<Op, { op: K }>;

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
  if (!parent) return;
  const { variant, errors } = resolveVariant(def, op.variant);
  for (const message of errors) fail(ctx, { code: 'invalid_variant', message });
  if (errors.length) return;
  const id = op.id ?? nextId(def.name, (x) => draft.has(x));
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
  if (!parent) return;
  const order = positionKey(ctx, parent.id, op.before, op.after);
  if (order === undefined) return;
  createTree(ctx, op.node, parent, order, scopeFor(ctx.draft, parent.id));
}

function nodeMove(ctx: OpContext, op: OpOf<'node.move'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null)
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: "A page root can't be moved.",
    });
  const parent = op.parent ? requireNode(ctx, op.parent) : ctx.draft.node(node.parent);
  if (!parent) return;
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
  const order = positionKey(ctx, parent.id, op.before, op.after, node.id);
  if (order === undefined) return;
  ctx.draft.setNode({ ...node, parent: parent.id, order });
}

function nodeRemove(ctx: OpContext, op: OpOf<'node.remove'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  if (node.parent === null) {
    return fail(ctx, {
      code: 'root_node',
      nodeId: node.id,
      message: "A page root can't be removed.",
      hint: 'Use page.remove.',
    });
  }
  for (const d of descendants(ctx.draft, node.id)) ctx.draft.deleteNode(d.id);
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
      message: "A page root can't be duplicated.",
    });
  const subtree = [node, ...descendants(draft, node.id)];
  const created = new Set<string>();
  const exists = (id: string) => draft.has(id) || created.has(id);
  const idMap = new Map<string, string>();
  const newRoot = duplicateId(node.id, exists);
  idMap.set(node.id, newRoot);
  created.add(newRoot);
  for (const n of subtree.slice(1)) {
    let nid = n.id.startsWith(`${node.id}/`)
      ? newRoot + n.id.slice(node.id.length)
      : duplicateId(n.id, exists);
    if (exists(nid)) nid = duplicateId(nid, exists);
    idMap.set(n.id, nid);
    created.add(nid);
  }
  const sibs = draft.children(node.parent);
  const next = sibs[sibs.findIndex((s) => s.id === node.id) + 1];
  const order = safeKey(node.order, next?.order);
  for (const n of subtree) {
    const isRoot = n.id === node.id;
    const copy: BNode = {
      ...clone(n),
      id: idMap.get(n.id)!,
      parent: isRoot ? n.parent : idMap.get(n.parent!)!,
      order: isRoot ? order : n.order,
    };
    if (isRoot && n.part && n.key !== undefined) {
      const last = copy.id.split('/').pop()!;
      if (last.startsWith(`${n.part}-`)) copy.key = last.slice(n.part.length + 1);
    }
    draft.setNode(copy);
  }
}

function textEdit(ctx: OpContext, op: OpOf<'text.edit'>) {
  const node = requireNode(ctx, op.id);
  if (!node) return;
  const key = op.prop ?? 'text';
  const current = node.props[key];
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
  setProps(ctx, node, { [key]: current.replace(op.find, () => op.replace) });
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
}

const PATH_RE = /^\/[A-Za-z0-9\-._~/]*$/;

function pageCreate(ctx: OpContext, op: OpOf<'page.create'>) {
  const { draft } = ctx;
  if (!PATH_RE.test(op.path)) {
    return fail(ctx, {
      code: 'invalid_op',
      message: `Page path "${op.path}" must start with "/" and use URL-safe characters.`,
    });
  }
  const pages = draft.pages();
  if (pages.some((p) => p.path === op.path)) {
    return fail(ctx, {
      code: 'duplicate_id',
      message: `A page with path "${op.path}" already exists.`,
    });
  }
  let id = op.id ?? (op.path === '/' ? 'home' : slugify(op.path, 'page'));
  if (!PAGE_ID_PATTERN.test(id))
    return fail(ctx, {
      code: 'invalid_id',
      message: `"${id}" is not a valid page id (kebab-case).`,
    });
  if (draft.page(id)) {
    if (op.id)
      return fail(ctx, { code: 'duplicate_id', message: `A page "${id}" already exists.` });
    id = nextId(id, (x) => !!draft.page(x));
  }
  let rootId = `root-${id}`;
  if (draft.has(rootId)) rootId = nextId(rootId, (x) => draft.has(x));
  draft.setNode({ id: rootId, type: 'root', parent: null, order: 'a0', props: {} });
  draft.setPage({ id, path: op.path, title: op.title, rootId });
}

function pageUpdate(ctx: OpContext, op: OpOf<'page.update'>) {
  const page = ctx.draft.page(op.id);
  if (!page) return fail(ctx, { code: 'not_found', message: `No page "${op.id}".` });
  if (op.path !== undefined) {
    if (!PATH_RE.test(op.path))
      return fail(ctx, { code: 'invalid_op', message: `Page path "${op.path}" is not valid.` });
    if (ctx.draft.pages().some((p) => p.path === op.path && p.id !== page.id)) {
      return fail(ctx, {
        code: 'duplicate_id',
        message: `Another page already uses "${op.path}".`,
      });
    }
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
  for (const d of descendants(ctx.draft, page.rootId)) ctx.draft.deleteNode(d.id);
  ctx.draft.deleteNode(page.rootId);
  ctx.draft.deletePage(page.id);
}

function tokenSet(ctx: OpContext, op: OpOf<'token.set'>) {
  const { draft } = ctx;
  if (!TOKEN_PATH.test(op.path)) {
    return fail(ctx, {
      code: 'invalid_token',
      path: op.path,
      message: `"${op.path}" is not a valid token path (e.g. "color.brand.600").`,
    });
  }
  const value = op.value;
  if (value !== null) {
    if (value.length > 500 || /[;<>\\]|\/\*|@|javascript:/i.test(value)) {
      return fail(ctx, {
        code: 'invalid_token',
        path: op.path,
        message: `Token value "${value}" contains characters that aren't allowed.`,
      });
    }
    const known = flattenTokens(draft.tokens()).tokens.map((t) => t.path);
    for (const alias of aliasesIn(value)) {
      if (alias === op.path || !known.includes(alias)) {
        return fail(ctx, {
          code: 'unknown_token',
          path: op.path,
          message: `Alias {${alias}} doesn't refer to another existing token.${didYouMean(alias, known)}`,
        });
      }
    }
  }
  if (op.theme) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(op.theme)) {
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
    if (!Object.keys(theme).length) delete themes[op.theme];
    draft.setThemes(themes);
    return;
  }
  const tokens = clone(draft.tokens());
  const segs = op.path.split('.');
  let group: Record<string, unknown> = tokens;
  for (const seg of segs.slice(0, -1)) {
    const next = group[seg];
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
  const existing = group[last];
  if (value === null) {
    if (existing === undefined)
      return fail(ctx, { code: 'not_found', path: op.path, message: `No token "${op.path}".` });
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
      if (op.path in theme) {
        delete theme[op.path];
        themesChanged = true;
      }
    }
    if (themesChanged) draft.setThemes(themes);
  } else {
    if (isPlainObject(existing) && !('$value' in existing)) {
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
  return users;
}

/** Ids a section template creates under `rootId`, found by expanding it in a scratch document. */
function templateIds(
  ctx: OpContext,
  def: SectionDef,
  variant: Record<string, string>,
  rootId: string,
): Set<string> | undefined {
  const scratchRoot: BNode = {
    id: 'scratch-root',
    type: 'root',
    parent: null,
    order: 'a0',
    props: {},
  };
  const scratch = new Draft({
    ...ctx.draft.base,
    nodes: { [scratchRoot.id]: scratchRoot },
    pages: {},
    tokens: ctx.draft.tokens(),
  });
  const sctx: OpContext = { ...ctx, draft: scratch, issues: [], warnings: [] };
  const section = { name: def.name, version: def.version, variant };
  const root = createTree(sctx, def.template({ variant }), scratchRoot, 'a0', '', {
    id: rootId,
    section,
  });
  if (!root) {
    for (const issue of sctx.issues) fail(ctx, issue);
    return undefined;
  }
  return new Set(descendants(scratch, rootId).map((n) => n.id));
}

function sectionVariant(ctx: OpContext, op: OpOf<'section.variant'>) {
  const { draft, registry } = ctx;
  const root = requireNode(ctx, op.id);
  if (!root) return;
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
  const oldIds = templateIds(ctx, def, root.section.variant, root.id);
  const newIds = templateIds(ctx, def, variant, root.id);
  if (!oldIds || !newIds) return;

  const old = descendants(draft, root.id);
  const oldById = new Map(old.map((n) => [n.id, n]));
  for (const n of old) draft.deleteNode(n.id);
  let prev: string | undefined;
  for (const child of def.template({ variant }).children ?? []) {
    const order = keyBetween(prev, undefined);
    prev = order;
    if (!createTree(ctx, child, root, order, `${root.id}/`)) return;
  }
  // Parts present in both variants keep their content, styles and variables.
  for (const id of newIds) {
    const before = oldById.get(id);
    const now = draft.node(id);
    if (!before || !now || before.type !== now.type) continue;
    const next: BNode = { ...now, props: before.props };
    if (before.styles) next.styles = before.styles;
    if (before.vars) next.vars = before.vars;
    if (before.name) next.name = before.name;
    draft.setNode(next);
  }
  // Parts someone deleted stay deleted.
  for (const id of newIds) {
    if (oldIds.has(id) && !oldById.has(id) && draft.has(id)) {
      for (const d of descendants(draft, id)) draft.deleteNode(d.id);
      draft.deleteNode(id);
    }
  }
  // Nodes added by people or agents come back under the same parent, or the nearest one left.
  const dropped: string[] = [];
  for (const n of old) {
    if (oldIds.has(n.id)) {
      if (!newIds.has(n.id) && !dropped.some((d) => n.id.startsWith(`${d}/`))) dropped.push(n.id);
      continue;
    }
    let parentId = n.parent!;
    while (!draft.has(parentId) && oldById.has(parentId)) parentId = oldById.get(parentId)!.parent!;
    if (!draft.has(parentId)) parentId = root.id;
    const restored: BNode = { ...n, parent: parentId };
    if (parentId !== n.parent)
      restored.order = keyBetween(draft.children(parentId).at(-1)?.order, undefined);
    draft.setNode(restored);
  }
  if (dropped.length) {
    ctx.warnings.push({
      code: 'parts_removed',
      opIndex: ctx.opIndex,
      nodeId: root.id,
      message: `The new variant has no ${listPreview(dropped)}; their content was removed (undo restores it).`,
    });
  }
  draft.setNode({ ...draft.node(root.id)!, section: { ...root.section, variant } });
}

function propsSet(ctx: OpContext, op: OpOf<'props.set'>) {
  const node = requireNode(ctx, op.id);
  if (node) setProps(ctx, node, op.props);
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
};

/** Applies one op to the draft; problems are pushed to `ctx.issues`. */
export function applyOp(ctx: OpContext, op: Op): void {
  (HANDLERS[op.op] as (ctx: OpContext, op: Op) => unknown)(ctx, op);
}
