import { ancestors, type DocView, descendants } from './doc.js';
import type { Change } from './draft.js';
import type { Issue } from './errors.js';
import type { Op } from './ops.js';
import { type NodeInput, type Registry, resolveVariant, templateParts } from './registry.js';
import { instancesOf } from './symbols.js';
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

export interface ChangesContext {
  actor: Actor;
  /** Record changes a transaction would commit (e.g. an undo). */
  changes: Change[];
  /** The document as it would be after the changes. */
  view: DocView;
  registry: Registry;
  /**
   * Why records change without ops: `revert` (undo, redo, revert; the default) or `sync` (linked
   * component instances following their definition). Only changes the wording of refusals.
   */
  purpose?: 'revert' | 'sync';
}

/** What happens when an agent changes something a person last edited. */
export type HumanEditProtection = 'off' | 'warn' | 'confirm';

export interface Policy {
  /** Returns an issue if the actor may not perform the op. */
  check(ctx: PolicyContext): Issue | undefined;
  /**
   * Returns an issue if the actor may not make these record changes. Used for undo, redo and
   * revert, which change records directly rather than through ops.
   */
  checkChanges?(ctx: ChangesContext): Issue | undefined;
  /** Whether raw CSS values (px, hex colours, …) are allowed for this actor. */
  allowRawValues(actor: Actor): boolean;
  /**
   * For agent changes to fields a person edited last: `warn` (default) applies them with a
   * warning, `confirm` refuses them unless the transaction sets `overwrite: true`.
   */
  protectHumanEdits?(actor: Actor): HumanEditProtection;
  /** Whether this actor's changes must be proposed as changesets and accepted by someone. */
  requiresReview?(actor: Actor): boolean;
  /**
   * How much this actor may change overall. Editors use it to offer only what the actor may do
   * (`check` still decides each op).
   */
  level?(actor: Actor): FreedomLevel;
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
  /** Default `warn`. See `Policy.protectHumanEdits`. */
  protectHumanEdits?: HumanEditProtection;
  /** Actor kinds whose changes must be proposed for review, e.g. `{ agent: true }`. */
  review?: Partial<Record<Actor['kind'], boolean>>;
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
      let parts: ReturnType<typeof templateParts>;
      try {
        parts = templateParts(def, resolveVariant(def, op.variant).variant);
      } catch {
        // A template that fails to build is reported by section.insert itself.
        return 'layout';
      }
      const types = new Map(parts.map((p) => [p.path, p.input.type]));
      const designProps = Object.entries(op.content).some(
        ([path, patch]) => !contentOnly(registry, types.get(path), Object.keys(patch)),
      );
      return designProps ? 'design' : 'layout';
    }
    // Site data is content: what the event is, where and when.
    case 'data.set':
      return 'content';
    case 'style.set':
    case 'vars.set':
    case 'token.set':
    case 'symbol.create':
    case 'symbol.remove':
    // Resetting overrides can drop an instance's styles and variables.
    case 'symbol.reset':
      return 'design';
    case 'symbol.insert': {
      const def = view.symbol(op.symbol);
      const root = def && view.node(def.rootId);
      if (!op.content) return 'layout';
      const designProps = Object.entries(op.content).some(([path, patch]) => {
        const target = root && (path === '' ? root : view.node(`${root.id}/${path}`));
        return !contentOnly(registry, target?.type, Object.keys(patch));
      });
      return designProps ? 'design' : 'layout';
    }
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
      // A locked page root locks the page itself: it can't be removed, renamed or moved.
      const page = view.page(op.id);
      return { nodes: page ? [page.rootId] : [], subtrees: page ? [page.rootId] : [] };
    }
    case 'page.update': {
      const page = view.page(op.id);
      return { nodes: page ? [page.rootId] : [], subtrees: [] };
    }
    case 'node.duplicate':
    case 'props.set':
    case 'text.edit':
    case 'style.set':
    case 'vars.set':
      return { nodes: [op.id], subtrees: [] };
    case 'symbol.create':
    case 'symbol.detach':
    case 'symbol.reset':
      return { nodes: [op.id], subtrees: [op.id] };
    case 'symbol.insert': {
      if (op.parent) return { nodes: [op.parent], subtrees: [] };
      const pages = view.pages();
      const page = op.page ? view.page(op.page) : pages.length === 1 ? pages[0] : undefined;
      return { nodes: page ? [page.rootId] : [], subtrees: [] };
    }
    case 'symbol.remove': {
      const def = view.symbol(op.symbol);
      if (!def) return { nodes: [], subtrees: [] };
      // The definition and every instance change (unlinked or removed).
      const roots = [def.rootId, ...instancesOf(view, def.id).map((n) => n.id)];
      return { nodes: roots, subtrees: roots };
    }
    case 'locale.set': {
      // Removing a language deletes its translations from every node that has one.
      const removed = op.remove ?? [];
      if (!removed.length) return { nodes: [], subtrees: [] };
      const nodes = view
        .nodeIds()
        .filter((id) => removed.some((l) => view.node(id)?.l10n?.[l] !== undefined));
      return { nodes, subtrees: [] };
    }
    default:
      return { nodes: [], subtrees: [] };
  }
}

/** The level needed to make a set of record changes (for undo, redo and revert). */
export function requiredLevelForChanges(changes: Change[], registry: Registry): FreedomLevel {
  let level: FreedomLevel = 'content';
  const raise = (l: FreedomLevel) => {
    if (RANK[l] > RANK[level]) level = l;
  };
  for (const c of changes) {
    if (c.kind === 'data') continue;
    if (c.kind === 'tokens' || c.kind === 'themes' || c.kind === 'symbol') raise('design');
    else if (c.kind === 'page' || c.kind === 'locales') raise('layout');
    else {
      const node = c.after ?? c.before!;
      if (!c.before || !c.after) {
        raise(registry.component(node.type)?.kind === 'code' ? 'code' : 'layout');
        continue;
      }
      const b = c.before;
      const a = c.after;
      if (b.parent !== a.parent || b.order !== a.order || b.type !== a.type) raise('layout');
      if (
        JSON.stringify([b.section, b.part, b.key, b.name, b.link, b.symbol]) !==
        JSON.stringify([a.section, a.part, a.key, a.name, a.link, a.symbol])
      )
        raise('layout');
      if (
        JSON.stringify(b.styles) !== JSON.stringify(a.styles) ||
        JSON.stringify(b.vars) !== JSON.stringify(a.vars)
      )
        raise('design');
      const keys = new Set([...Object.keys(b.props), ...Object.keys(a.props)]);
      const changed = [...keys].filter(
        (k) => JSON.stringify(b.props[k]) !== JSON.stringify(a.props[k]),
      );
      if (changed.length && !contentOnly(registry, a.type, changed)) raise('design');
    }
  }
  return level;
}

/** What each op does, in words people understand (refusals are read by people and agents). */
const OP_PHRASES: Partial<Record<Op['op'], string>> = {
  'section.insert': 'adding a section',
  'section.variant': "changing a section's layout",
  'node.insert': 'adding this element',
  'node.move': 'moving things',
  'node.remove': 'removing things',
  'node.duplicate': 'duplicating things',
  'props.set': 'changing settings other than text, links and images',
  'text.edit': 'changing this',
  'style.set': 'styling',
  'vars.set': 'changing section colours and spacing',
  'page.create': 'adding a page',
  'page.update': 'changing page settings',
  'page.remove': 'removing a page',
  'locale.set': 'changing languages',
  'symbol.create': 'making a linked component',
  'symbol.insert': 'adding a linked component',
  'symbol.detach': 'detaching a linked component',
  'symbol.reset': "resetting an instance's overrides",
  'symbol.update': 'renaming a linked component',
  'symbol.remove': 'deleting a linked component',
  'token.set': 'changing design tokens (brand colours, spacing, fonts)',
};

export function createPolicy(options: PolicyOptions = {}): Policy {
  const locked = new Set(options.lockedNodes ?? []);
  const levelOf = (actor: Actor): FreedomLevel =>
    (options.actors && Object.hasOwn(options.actors, actor.id)
      ? options.actors[actor.id]
      : undefined) ??
    options.levels?.[actor.kind] ??
    'code';
  return {
    level: levelOf,
    check({ actor, op, view, registry }) {
      const needed = requiredLevel(op, view, registry);
      const has = levelOf(actor);
      if (RANK[has] < RANK[needed]) {
        return {
          code: 'policy',
          message: `${actor.kind} "${actor.id}" may make ${has} changes, but ${OP_PHRASES[op.op] ?? 'this'} (${op.op}) needs ${needed} access.`,
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
    checkChanges({ actor, changes, view, registry, purpose = 'revert' }) {
      const needed = requiredLevelForChanges(changes, registry);
      const has = levelOf(actor);
      const sync = purpose === 'sync';
      if (RANK[has] < RANK[needed]) {
        return {
          code: 'policy',
          message: `${actor.kind} "${actor.id}" may make ${has} changes, but ${sync ? 'updating the instances of this linked component' : 'reverting this'} needs ${needed} access.`,
          hint: sync
            ? 'Ask a person with more access to change the linked component.'
            : 'Ask a person with more access to undo it.',
        };
      }
      if (!locked.size) return undefined;
      for (const c of changes) {
        if (c.kind !== 'node') continue;
        const parents = [c.before?.parent, c.after?.parent].filter((p): p is string => !!p);
        const chain = [
          c.id,
          ...parents.flatMap((p) => [p, ...ancestors(view, p).map((a) => a.id)]),
        ];
        const hit = chain.find((id) => locked.has(id));
        if (hit) {
          return {
            code: 'policy',
            nodeId: c.id,
            message: `"${c.id}" is locked${hit !== c.id ? ` (inside locked "${hit}")` : ''}, so ${sync ? "this linked component instance can't be updated" : "this can't be reverted"}.`,
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
    protectHumanEdits(actor) {
      return actor.kind === 'agent' ? (options.protectHumanEdits ?? 'warn') : 'off';
    },
    requiresReview(actor) {
      return options.review?.[actor.kind] ?? false;
    },
  };
}
