import type { Draft } from './draft.js';
import type { Issue } from './errors.js';
import type { Actor, BNode, SiteDoc, Stamp, TokenTree } from './types.js';
import { deepEqual, isPlainObject } from './util.js';

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
  return out;
}

/** The stamp that covers `field`: its own, or the node's creation stamp. */
export function stampFor(node: BNode, field: string): Stamp | undefined {
  return node.edited?.[field] ?? node.edited?.node;
}

/** Stamps every node changed in the draft with `actor` (created nodes get a fresh `node` stamp). */
export function stampChanges(draft: Draft, actor: Actor, rev: number): void {
  const stamp: Stamp = { by: actor.id, kind: actor.kind, rev };
  for (const c of draft.changes()) {
    if (c.kind !== 'node' || !c.after) continue;
    let edited: Record<string, Stamp> | undefined;
    if (!c.before) edited = { node: stamp };
    else {
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
  for (const c of draft.changes()) {
    if (c.kind !== 'node' || !c.before) continue;
    const before = c.before;
    if (!c.after) {
      const human = Object.entries(before.edited ?? {}).find(
        ([field, s]) => field !== 'node' && s.kind === 'user',
      )?.[1];
      if (human) {
        out.push({
          nodeId: c.id,
          message: `Removes "${c.id}", which ${describeStamp(human)} edited.`,
        });
      }
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
function changedTokenKeys(draft: Draft): string[] {
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
