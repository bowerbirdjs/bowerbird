export type NodeId = string;
export type PageId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type PropValue = JsonValue;
export type Props = Record<string, PropValue>;

/** CSS property → value, e.g. `{ 'padding-block': 'var(--space-lg)' }`. */
export type Declarations = Record<string, string>;
/** Breakpoint id → state (`default`, `hover`, …) → declarations. */
export type NodeStyles = Record<string, Record<string, Declarations>>;

/** Marks a node as the root of an inserted section template. */
export interface SectionRef {
  name: string;
  version: number;
  variant: Record<string, string>;
}

/**
 * A node in the page tree. Nodes are stored flat (`SiteDoc.nodes`) and point to their parent;
 * siblings are ordered by a fractional index (`order`).
 */
export interface BNode {
  id: NodeId;
  type: string;
  parent: NodeId | null;
  order: string;
  props: Props;
  styles?: NodeStyles;
  /** CSS custom property overrides set on this node (section variables or token overrides). */
  vars?: Record<string, string>;
  /** Present on section roots. */
  section?: SectionRef;
  /** Part name inside a section (drives the `bb-<section>__<part>` class). */
  part?: string;
  /** Item key for repeated parts (`tier` + `pro` → id segment `tier-pro`). Keyed nodes scope child ids. */
  key?: string;
  /** Optional human-readable label. */
  name?: string;
  /** On the root of a symbol definition: the id of the symbol it defines. */
  symbol?: string;
  /**
   * On every node of a symbol instance: the definition node it mirrors. Changes to the definition
   * flow to instance fields that still match the definition; differing fields are overrides.
   */
  link?: { symbol: string; node: NodeId };
  /**
   * Who last changed each field, for provenance and protecting people's edits from agents. Keys:
   * `node` (created), `position`, `variant`, `styles`, `vars`, `props.<name>`.
   */
  edited?: Record<string, Stamp>;
}

/** Who made a change, and in which revision. */
export interface Stamp {
  by: string;
  kind: Actor['kind'];
  rev: number;
}

/** A linked component: one definition (a node subtree outside any page) and its instances. */
export interface SymbolDef {
  id: string;
  name: string;
  /** Root node of the definition subtree (its `parent` is null). */
  rootId: NodeId;
  description?: string;
}

export interface Page {
  id: PageId;
  path: string;
  title: string;
  description?: string;
  rootId: NodeId;
}

export interface Breakpoint {
  id: string;
  /** Minimum container width in px. The first breakpoint must be 0 (mobile-first base). */
  minWidth: number;
  label?: string;
}

/** Design tokens in (a lenient subset of) the W3C DTCG format. */
export type TokenTree = Record<string, unknown>;

export interface SiteDoc {
  schemaVersion: 1;
  revision: number;
  pages: Record<PageId, Page>;
  nodes: Record<NodeId, BNode>;
  tokens: TokenTree;
  /** Theme name → token path → CSS value (or `{alias}`). */
  themes: Record<string, Record<string, string>>;
  breakpoints: Breakpoint[];
  /** Linked components by id. */
  symbols?: Record<string, SymbolDef>;
  /** Who last changed each token (`token:<path>`) and theme value (`theme:<name>:<path>`). */
  tokenEdits?: Record<string, Stamp>;
  /**
   * Highest number handed out per id prefix (`hero` → 3 means hero-1…hero-3 were used). Ids are
   * never reused, so undo and references can't land on a different node with an old id.
   */
  counters?: Record<string, number>;
}

export interface Actor {
  kind: 'user' | 'agent' | 'system';
  id: string;
  name?: string;
}
