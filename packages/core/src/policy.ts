import { ancestors, type DocView, descendants } from './doc.js';
import type { Issue } from './errors.js';
import type { Op } from './ops.js';
import { type NodeInput, type Registry, resolveVariant, templateParts } from './registry.js';
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

function containsStyling(input: NodeInput): boolean {
  return (
    !!input.css ||
    !!(input.styles && Object.keys(input.styles).length) ||
    !!(input.vars && Object.keys(input.vars).length) ||
    (input.children ?? []).some(containsStyling)
  );
}

function contentOnly(registry: Registry, type: string | undefined, keys: string[]): boolean {
  const content = new Set(type ? (registry.component(type)?.contentProps ?? []) : []);
  return keys.every((k) => content.has(k));
}

export function requiredLevel(op: Op, view: DocView, registry: Registry): FreedomLevel {
  switch (op.op) {
    case 'props.set':
    case 'text.edit': {
      const keys = op.op === 'props.set' ? Object.keys(op.props) : [op.prop ?? 'text'];
      return contentOnly(registry, view.node(op.id)?.type, keys) ? 'content' : 'design';
    }
    case 'node.insert':
      if (containsCode(op.node, registry)) return 'code';
      return containsStyling(op.node) ? 'design' : 'layout';
    case 'section.insert': {
      const def = registry.section(op.section);
      if (!def || !op.content) return 'layout';
      const types = new Map(
        templateParts(def, resolveVariant(def, op.variant).variant).map((p) => [
          p.path,
          p.input.type,
        ]),
      );
      const designProps = Object.entries(op.content).some(
        ([path, patch]) => !contentOnly(registry, types.get(path), Object.keys(patch)),
      );
      return designProps ? 'design' : 'layout';
    }
    case 'style.set':
    case 'vars.set':
    case 'token.set':
      return 'design';
    default:
      return 'layout';
  }
}

/**
 * Nodes an op touches, for lock checks: `nodes` are checked with their ancestors, `subtrees` with
 * all their descendants too (an op that removes or moves a subtree changes everything in it).
 */
function touched(op: Op, view: DocView): { nodes: string[]; subtrees: string[] } {
  switch (op.op) {
    case 'node.insert':
      return { nodes: [op.parent], subtrees: [] };
    case 'section.insert': {
      if (op.parent) return { nodes: [op.parent], subtrees: [] };
      const pages = view.pages();
      const page = op.page ? view.page(op.page) : pages.length === 1 ? pages[0] : undefined;
      return { nodes: page ? [page.rootId] : [], subtrees: [] };
    }
    case 'node.move':
      return { nodes: [op.id, ...(op.parent ? [op.parent] : [])], subtrees: [op.id] };
    case 'node.remove':
    case 'section.variant':
      return { nodes: [op.id], subtrees: [op.id] };
    case 'page.remove': {
      const page = view.page(op.id);
      return { nodes: [], subtrees: page ? [page.rootId] : [] };
    }
    case 'node.duplicate':
    case 'props.set':
    case 'text.edit':
    case 'style.set':
    case 'vars.set':
      return { nodes: [op.id], subtrees: [] };
    default:
      return { nodes: [], subtrees: [] };
  }
}

export function createPolicy(options: PolicyOptions = {}): Policy {
  const locked = new Set(options.lockedNodes ?? []);
  const levelOf = (actor: Actor): FreedomLevel =>
    (options.actors && Object.hasOwn(options.actors, actor.id)
      ? options.actors[actor.id]
      : undefined) ??
    options.levels?.[actor.kind] ??
    'code';
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
      if (!locked.size) return undefined;
      const { nodes, subtrees } = touched(op, view);
      for (const id of nodes) {
        const lockedBy = [view.node(id), ...ancestors(view, id)].find((n) => n && locked.has(n.id));
        if (lockedBy) {
          return {
            code: 'policy',
            nodeId: id,
            message: `"${id}" is locked${lockedBy.id !== id ? ` (inside locked "${lockedBy.id}")` : ''} and can't be changed.`,
          };
        }
      }
      for (const id of subtrees) {
        const inside = descendants(view, id).find((n) => locked.has(n.id));
        if (inside) {
          return {
            code: 'policy',
            nodeId: id,
            message: `"${id}" contains locked "${inside.id}", so it can't be ${op.op === 'node.move' ? 'moved' : 'removed or rebuilt'}.`,
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
