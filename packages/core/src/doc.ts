import { compareOrder } from './order.js';
import type { BNode, Breakpoint, NodeId, Page, PageId, SiteDoc, TokenTree } from './types.js';
import { ensureIn } from './util.js';

/** Read access to a document, implemented by committed docs (`DocIndex`) and drafts. */
export interface DocView {
  node(id: NodeId): BNode | undefined;
  /** Children of a node, in order. */
  children(id: NodeId): BNode[];
  page(id: PageId): Page | undefined;
  pages(): Page[];
  breakpoints(): Breakpoint[];
  tokens(): TokenTree;
  themes(): Record<string, Record<string, string>>;
}

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { id: 'base', minWidth: 0, label: 'Mobile' },
  { id: 'md', minWidth: 768, label: 'Tablet' },
  { id: 'lg', minWidth: 1024, label: 'Desktop' },
];

export function createEmptyDoc(
  options: {
    tokens?: TokenTree;
    themes?: Record<string, Record<string, string>>;
    breakpoints?: Breakpoint[];
  } = {},
): SiteDoc {
  return {
    schemaVersion: 1,
    revision: 0,
    pages: {},
    nodes: {},
    tokens: options.tokens ?? {},
    themes: options.themes ?? {},
    breakpoints: options.breakpoints ?? DEFAULT_BREAKPOINTS,
  };
}

export function buildChildIndex(nodes: Iterable<BNode>): Map<NodeId, Set<NodeId>> {
  const index = new Map<NodeId, Set<NodeId>>();
  for (const n of nodes) {
    if (n.parent === null) continue;
    ensureIn(index, n.parent, () => new Set<NodeId>()).add(n.id);
  }
  return index;
}

/** Indexed, read-only view of a committed document. */
export class DocIndex implements DocView {
  private readonly childIndex: Map<NodeId, Set<NodeId>>;

  constructor(readonly doc: SiteDoc) {
    this.childIndex = buildChildIndex(Object.values(doc.nodes));
  }

  node(id: NodeId) {
    return this.doc.nodes[id];
  }

  children(id: NodeId): BNode[] {
    const ids = this.childIndex.get(id);
    if (!ids) return [];
    return [...ids].map((c) => this.doc.nodes[c]!).sort(compareOrder);
  }

  page(id: PageId) {
    return this.doc.pages[id];
  }

  pages() {
    return Object.values(this.doc.pages);
  }

  breakpoints() {
    return this.doc.breakpoints;
  }

  tokens() {
    return this.doc.tokens;
  }

  themes() {
    return this.doc.themes;
  }
}

/** Ancestors from the parent up to the page root. */
export function ancestors(view: DocView, id: NodeId): BNode[] {
  const out: BNode[] = [];
  const seen = new Set<NodeId>();
  let cur = view.node(id);
  while (cur?.parent && !seen.has(cur.parent)) {
    seen.add(cur.parent);
    cur = view.node(cur.parent);
    if (cur) out.push(cur);
  }
  return out;
}

/** All descendants in document order (depth-first, pre-order). */
export function descendants(view: DocView, id: NodeId): BNode[] {
  const out: BNode[] = [];
  const walk = (pid: NodeId) => {
    for (const child of view.children(pid)) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** The nearest section root at or above `id`. */
export function sectionRootOf(view: DocView, id: NodeId): BNode | undefined {
  const self = view.node(id);
  if (self?.section) return self;
  return ancestors(view, id).find((n) => n.section);
}

export function pageOf(view: DocView, id: NodeId): Page | undefined {
  const self = view.node(id);
  const root = self?.parent === null ? self : ancestors(view, id).at(-1);
  return root ? view.pages().find((p) => p.rootId === root.id) : undefined;
}

/** All nodes of a page, in document order (root first). */
export function pageNodes(view: DocView, pageId: PageId): BNode[] {
  const page = view.page(pageId);
  const root = page && view.node(page.rootId);
  return root ? [root, ...descendants(view, root.id)] : [];
}
