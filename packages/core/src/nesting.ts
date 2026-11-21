import { ancestors, type DocView, descendants } from './doc.js';
import type { BNode } from './types.js';

/** What a link can't contain: browsers split or drop interactive content inside an `<a>`. */
export const INTERACTIVE: ReadonlySet<string> = new Set([
  'link',
  'button',
  'form',
  'field',
  'details',
]);

export interface NestingProblem {
  /** The node that sits where it can't. */
  node: BNode;
  /** The link or form somewhere above it. */
  inside: BNode;
  kind: 'in-link' | 'form-in-form';
}

/** What's wrong with where `n` itself sits, if anything. */
export function nestingProblemAt(view: DocView, n: BNode): NestingProblem | undefined {
  if (!INTERACTIVE.has(n.type)) return undefined;
  const above = ancestors(view, n.id);
  const link = above.find((a) => a.type === 'link');
  if (link) return { node: n, inside: link, kind: 'in-link' };
  if (n.type !== 'form') return undefined;
  const form = above.find((a) => a.type === 'form');
  return form ? { node: n, inside: form, kind: 'form-in-form' } : undefined;
}

/**
 * The first place in `node`'s subtree (the node included) where something interactive sits inside
 * a link, or a form inside a form. Everything above `node` counts, and so does nesting within the
 * subtree itself (a form in a box in a form, placed in one go). Browsers split or drop such
 * nesting, so the page would no longer match the document.
 */
export function nestingProblem(view: DocView, node: BNode): NestingProblem | undefined {
  for (const n of [node, ...descendants(view, node.id)]) {
    const problem = nestingProblemAt(view, n);
    if (problem) return problem;
  }
  return undefined;
}

/** A nesting problem in words: what, where, and what to do instead. */
export function describeNesting(problem: NestingProblem): { message: string; hint: string } {
  const { node, inside } = problem;
  return problem.kind === 'in-link'
    ? {
        message: `"${node.id}" (${node.type}) can't be inside link "${inside.id}": links can't contain links, buttons or form parts.`,
        hint: `Put it next to "${inside.id}" instead.`,
      }
    : {
        message: `Form "${node.id}" can't be inside form "${inside.id}": browsers drop a form inside a form.`,
        hint: `Put its fields into "${inside.id}", or place it next to it.`,
      };
}
