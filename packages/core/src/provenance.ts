import type { Draft } from './draft.js';
import type { Issue } from './errors.js';
import type { Actor, BNode, Stamp } from './types.js';
import { deepEqual } from './util.js';

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
