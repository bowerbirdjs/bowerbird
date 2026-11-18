import type { Draft } from './draft.js';
import type { Issue } from './errors.js';
import { flattenL10n } from './l10n.js';
import type { Actor, BNode, SiteDoc, Stamp, TokenTree } from './types.js';
import { deepEqual, isPlainObject, own } from './util.js';

/**
 * Provenance: each node records who last changed each of its fields (`BNode.edited`). It is
 * written when a transaction commits and reverted with it on undo. Agents use it to avoid
 * silently overwriting what people wrote (see `protectHumanEdits` in the policy).
 */

/** Fields that differ between two versions of a node, as provenance keys. */
export function changedFields(before: BNode, after: BNode): string[] {
  const out: string[] = [];
  if (before.parent !== after.parent || before.order !== after.order) out.push('position');
  if (!deepEqual(before.section, after.section)) out.push('variant');
  if (!deepEqual(before.styles, after.styles)) out.push('styles');
  if (!deepEqual(before.vars, after.vars)) out.push('vars');
  for (const k of new Set([...Object.keys(before.props), ...Object.keys(after.props)])) {
    if (!deepEqual(before.props[k], after.props[k])) out.push(`props.${k}`);
  }
  const a = flattenL10n(before.l10n);
  const b = flattenL10n(after.l10n);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
    if (!deepEqual(a[k], b[k])) out.push(`l10n.${k.replace('|', '.')}`);
  return out;
}

/** The stamp that covers `field`: its own, or the node's creation stamp. */
export function stampFor(node: BNode, field: string): Stamp | undefined {
  return node.edited?.[field] ?? node.edited?.node;
}

/**
 * Stamps every node changed in the draft with `actor`. Created nodes get a fresh `node` stamp, plus
 * the fields the actor set on purpose (`explicit`: content given with a section, a node.insert's
 * props), so what a person wrote into a new node is protected like an edit; template placeholders
 * are not.
 */
export function stampChanges(
  draft: Draft,
  actor: Actor,
  rev: number,
  explicit?: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const stamp: Stamp = { by: actor.id, kind: actor.kind, rev };
  for (const c of draft.changes()) {
    if (c.kind !== 'node' || !c.after) continue;
    let edited: Record<string, Stamp> | undefined;
    if (!c.before) {
      edited = { node: stamp };
      for (const f of explicit?.get(c.id) ?? []) edited[f] = stamp;
    } else {
      const fields = changedFields(c.before, c.after);
      if (!fields.length) continue;
      edited = { ...(c.after.edited ?? {}) };
      for (const f of fields) edited[f] = stamp;
    }
    draft.setNode({ ...c.after, edited });
  }
}

const describeStamp = (s: Stamp) => `${s.by} (${s.kind}) in revision ${s.rev}`;

/**
 * Changes in the draft that overwrite fields a person last changed, or remove nodes with such
 * fields. One issue per node.
 * Only meaningful for agent transactions; the caller decides whether these are errors or warnings.
 */
export function humanEditConflicts(draft: Draft): Omit<Issue, 'code'>[] {
  const out: Omit<Issue, 'code'>[] = [];
  const changes = draft.changes();
  const removedNodes = changes.filter(
    (c): c is Extract<typeof c, { kind: 'node' }> => c.kind === 'node' && !!c.before && !c.after,
  );
  const removed = new Set(removedNodes.map((c) => c.id));
  // Stamps of everything removed under a removed node (by its original parent links).
  const children = new Map<string, BNode[]>();
  for (const c of removedNodes) {
    const parent = c.before!.parent;
    if (parent) children.set(parent, [...(children.get(parent) ?? []), c.before!]);
  }
  // A person's field edits, or the top node of something a person added (a section, an element,
  // an instance), are theirs. The rest of an added template or instance copy is placeholder.
  const edit = (n: BNode) =>
    Object.entries(n.edited ?? {}).find(([field, s]) => field !== 'node' && s.kind === 'user')?.[1];
  const addition = (n: BNode): Stamp | undefined => {
    const s = n.edited?.node;
    if (s?.kind !== 'user') return undefined;
    const parent = n.parent ? own(draft.base.nodes, n.parent)?.edited?.node : undefined;
    return parent && parent.by === s.by && parent.rev === s.rev ? undefined : s;
  };
  function* descendantStamps(id: string): Generator<Stamp> {
    for (const child of children.get(id) ?? []) {
      const s = edit(child) ?? addition(child);
      if (s) yield s;
      yield* descendantStamps(child.id);
    }
  }
  for (const c of changes) {
    if (c.kind !== 'node' || !c.before) continue;
    const before = c.before;
    if (!c.after) {
      // Removing what a person added or changed counts (reported once, at the top of a removed
      // subtree): they put it there on purpose.
      if (before.parent && removed.has(before.parent)) continue;
      const edited = edit(before);
      const added = addition(before);
      const inside = edited || added ? undefined : descendantStamps(c.id).next().value;
      const message = edited
        ? `Removes "${c.id}", which ${describeStamp(edited)} edited.`
        : added
          ? `Removes "${c.id}", which ${describeStamp(added)} added.`
          : inside
            ? `Removes "${c.id}" with what ${describeStamp(inside)} added or edited inside it.`
            : undefined;
      if (message) out.push({ nodeId: c.id, message });
      continue;
    }
    // Only fields a person changed count; creating a node (e.g. inserting a template section)
    // doesn't make its placeholder content theirs.
    const fields = changedFields(before, c.after).filter(
      (f) => before.edited?.[f]?.kind === 'user',
    );
    if (!fields.length) continue;
    const s = before.edited![fields[0]!]!;
    out.push({
      nodeId: c.id,
      path: fields[0]!,
      message: `Overwrites ${fields.join(', ')} on "${c.id}", last changed by ${describeStamp(s)}.`,
    });
  }
  return out;
}

/** Token leaves keyed by dot path (values are the leaf objects or shorthand values). */
export function tokenLeaves(tree: TokenTree): Record<string, unknown> {
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

export function themeEntries(themes: SiteDoc['themes']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [theme, values] of Object.entries(themes)) {
    for (const [path, value] of Object.entries(values)) out[`${theme}\u0000${path}`] = value;
  }
  return out;
}

/** Token and theme values that differ between two documents, as `token:<path>` / `theme:<name>:<path>` keys. */
export function changedTokenKeys(draft: Draft): string[] {
  const out: string[] = [];
  const diff = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
    key: (k: string) => string,
  ) => {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (!deepEqual(a[k], b[k])) out.push(key(k));
  };
  if (draft.tokens() !== draft.base.tokens)
    diff(tokenLeaves(draft.base.tokens), tokenLeaves(draft.tokens()), (k) => `token:${k}`);
  if (draft.themes() !== draft.base.themes)
    diff(
      themeEntries(draft.base.themes),
      themeEntries(draft.themes()),
      (k) => `theme:${k.replace('\u0000', ':')}`,
    );
  return out;
}

/** Stamps changed tokens and theme values (people's design decisions are protected too). */
export function stampTokens(draft: Draft, actor: Actor, rev: number): void {
  const keys = changedTokenKeys(draft);
  if (!keys.length) return;
  const stamps = { ...(draft.tokenStamps() ?? {}) };
  for (const k of keys) stamps[k] = { by: actor.id, kind: actor.kind, rev };
  draft.setTokenStamps(stamps);
}

/** Token or theme values a person set last that the draft changes. */
export function humanTokenConflicts(draft: Draft): Omit<Issue, 'code'>[] {
  const stamps = draft.base.tokenEdits ?? {};
  return changedTokenKeys(draft).flatMap((k) => {
    const s = stamps[k];
    if (s?.kind !== 'user') return [];
    const what = k.startsWith('token:') ? `token ${k.slice(6)}` : `theme value ${k.slice(6)}`;
    return [{ path: k, message: `Overwrites ${what}, last changed by ${describeStamp(s)}.` }];
  });
}
