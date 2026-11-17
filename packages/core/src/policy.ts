import { ancestors, type DocView } from './doc.js';
import type { Issue } from './errors.js';
import type { Op } from './ops.js';
import type { NodeInput, Registry } from './registry.js';
import type { Actor } from './types.js';

/**
 * How much an actor may change:
 * - content: text, links, images (props listed as `contentProps`)
 * - layout:  plus adding, moving and removing sections, nodes and pages
 * - design:  plus styles, variables, tokens and non-content props
 * - code:    plus inserting host code components
 */
export type FreedomLevel = 'content' | 'layout' | 'design' | 'code';
const RANK: Record<FreedomLevel, number> = { content: 0, layout: 1, design: 2, code: 3 };

export interface PolicyContext {
  actor: Actor;
  op: Op;
  view: DocView;
  registry: Registry;
}

export interface Policy {
  /** Returns an issue if the actor may not perform the op. */
  check(ctx: PolicyContext): Issue | undefined;
  /** Whether raw CSS values (px, hex colours, …) are allowed for this actor. */
  allowRawValues(actor: Actor): boolean;
}

export interface PolicyOptions {
  /** Level per actor kind. Default: `code` for everyone. */
  levels?: Partial<Record<Actor['kind'], FreedomLevel>>;
  /** Level per actor id (overrides `levels`). */
  actors?: Record<string, FreedomLevel>;
  /** Default: false, so styles must use design tokens. */
  allowRawValues?: boolean | Partial<Record<Actor['kind'], boolean>>;
  /** Nodes (and their subtrees) that may not be changed. */
  lockedNodes?: string[];
}

function containsCode(input: NodeInput, registry: Registry): boolean {
  return (
    registry.component(input.type)?.kind === 'code' ||
    (input.children ?? []).some((c) => containsCode(c, registry))
  );
}

export function requiredLevel(op: Op, view: DocView, registry: Registry): FreedomLevel {
  switch (op.op) {
    case 'props.set':
    case 'text.edit': {
      const node = view.node(op.id);
      const content = new Set(node ? (registry.component(node.type)?.contentProps ?? []) : []);
      const keys = op.op === 'props.set' ? Object.keys(op.props) : [op.prop ?? 'text'];
      return keys.every((k) => content.has(k)) ? 'content' : 'design';
    }
    case 'node.insert':
      return containsCode(op.node, registry) ? 'code' : 'layout';
    case 'style.set':
    case 'vars.set':
    case 'token.set':
      return 'design';
    default:
      return 'layout';
  }
}

/** Node ids an op touches (for lock checks). */
function touchedNodes(op: Op): string[] {
  switch (op.op) {
    case 'node.insert':
      return [op.parent];
    case 'section.insert':
      return op.parent ? [op.parent] : [];
    case 'node.move':
      return [op.id, ...(op.parent ? [op.parent] : [])];
    case 'node.remove':
    case 'node.duplicate':
    case 'section.variant':
    case 'props.set':
    case 'text.edit':
    case 'style.set':
    case 'vars.set':
      return [op.id];
    default:
      return [];
  }
}

export function createPolicy(options: PolicyOptions = {}): Policy {
  const locked = new Set(options.lockedNodes ?? []);
  const levelOf = (actor: Actor): FreedomLevel =>
    options.actors?.[actor.id] ?? options.levels?.[actor.kind] ?? 'code';
  return {
    check({ actor, op, view, registry }) {
      const needed = requiredLevel(op, view, registry);
      const has = levelOf(actor);
      if (RANK[has] < RANK[needed]) {
        return {
          code: 'policy',
          message: `${actor.kind} "${actor.id}" may make ${has} changes, but ${op.op} here needs ${needed} access.`,
          hint:
            has === 'content'
              ? 'Only text, links and images can be changed; ask a person with more access for layout or design changes.'
              : 'Ask a person with more access to make this change.',
        };
      }
      for (const id of touchedNodes(op)) {
        const lockedBy = [view.node(id), ...ancestors(view, id)].find((n) => n && locked.has(n.id));
        if (lockedBy) {
          return {
            code: 'policy',
            nodeId: id,
            message: `"${id}" is locked${lockedBy.id !== id ? ` (inside locked "${lockedBy.id}")` : ''} and can't be changed.`,
          };
        }
      }
      return undefined;
    },
    allowRawValues(actor) {
      const opt = options.allowRawValues;
      if (typeof opt === 'boolean') return opt;
      return opt?.[actor.kind] ?? false;
    },
  };
}
