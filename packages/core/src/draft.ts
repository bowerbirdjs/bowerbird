import { buildChildIndex, type DocView } from './doc.js';
import { compareOrder } from './order.js';
import type { BNode, NodeId, Page, PageId, SiteDoc, TokenTree } from './types.js';
import { deepEqual, ensureIn, own } from './util.js';

/** A record-level change: `before` absent = created, `after` absent = removed. */
export type Change =
  | { kind: 'node'; id: NodeId; before?: BNode; after?: BNode }
  | { kind: 'page'; id: PageId; before?: Page; after?: Page }
  | { kind: 'tokens'; id: 'tokens'; before: TokenTree; after: TokenTree }
  | { kind: 'themes'; id: 'themes'; before: SiteDoc['themes']; after: SiteDoc['themes'] };

/**
 * A copy-on-write working copy of a document. Ops mutate the draft; `finish()` produces the next
 * immutable document plus the list of record changes (used for history and undo).
 */
export class Draft implements DocView {
  private readonly nodeOverlay = new Map<NodeId, BNode | null>();
  private readonly pageOverlay = new Map<PageId, Page | null>();
  private readonly counterOverlay = new Map<string, number>();
  private readonly childIndex: Map<NodeId, Set<NodeId>>;
  private tokenTree: TokenTree;
  private themeMap: SiteDoc['themes'];
  /** Bumped whenever tokens or nodes change, so callers can invalidate caches. */
  version = 0;

  constructor(readonly base: SiteDoc) {
    this.childIndex = buildChildIndex(Object.values(base.nodes));
    this.tokenTree = base.tokens;
    this.themeMap = base.themes;
  }

  node(id: NodeId): BNode | undefined {
    if (this.nodeOverlay.has(id)) return this.nodeOverlay.get(id) ?? undefined;
    return own(this.base.nodes, id);
  }

  has(id: NodeId): boolean {
    return this.node(id) !== undefined;
  }

  children(id: NodeId): BNode[] {
    const ids = this.childIndex.get(id);
    if (!ids) return [];
    return [...ids].map((c) => this.node(c)!).sort(compareOrder);
  }

  page(id: PageId): Page | undefined {
    if (this.pageOverlay.has(id)) return this.pageOverlay.get(id) ?? undefined;
    return own(this.base.pages, id);
  }

  /** Highest number used so far for an id prefix. */
  counter(prefix: string): number {
    return this.counterOverlay.get(prefix) ?? own(this.base.counters ?? {}, prefix) ?? 0;
  }

  /** Records that numbers up to `n` have been used for `prefix` (never decreases). */
  useCounter(prefix: string, n: number): void {
    if (n > this.counter(prefix)) this.counterOverlay.set(prefix, n);
  }

  pages(): Page[] {
    const ids = new Set([...Object.keys(this.base.pages), ...this.pageOverlay.keys()]);
    return [...ids].map((id) => this.page(id)).filter((p): p is Page => !!p);
  }

  nodeIds(): NodeId[] {
    const ids = new Set([...Object.keys(this.base.nodes), ...this.nodeOverlay.keys()]);
    return [...ids].filter((id) => this.node(id));
  }

  breakpoints() {
    return this.base.breakpoints;
  }

  tokens(): TokenTree {
    return this.tokenTree;
  }

  themes() {
    return this.themeMap;
  }

  setNode(node: BNode): void {
    const prev = this.node(node.id);
    if (prev && prev.parent !== node.parent && prev.parent !== null) {
      this.childIndex.get(prev.parent)?.delete(node.id);
    }
    if (node.parent !== null) {
      ensureIn(this.childIndex, node.parent, () => new Set<NodeId>()).add(node.id);
    }
    this.nodeOverlay.set(node.id, node);
    this.version++;
  }

  deleteNode(id: NodeId): void {
    const prev = this.node(id);
    if (!prev) return;
    if (prev.parent !== null) this.childIndex.get(prev.parent)?.delete(id);
    this.nodeOverlay.set(id, null);
    this.version++;
  }

  setPage(page: Page): void {
    this.pageOverlay.set(page.id, page);
  }

  deletePage(id: PageId): void {
    this.pageOverlay.set(id, null);
  }

  setTokens(tokens: TokenTree): void {
    this.tokenTree = tokens;
    this.version++;
  }

  setThemes(themes: SiteDoc['themes']): void {
    this.themeMap = themes;
    this.version++;
  }

  changes(): Change[] {
    const out: Change[] = [];
    for (const [id, after] of this.nodeOverlay) {
      const before = own(this.base.nodes, id);
      if (deepEqual(before, after ?? undefined)) continue;
      out.push({ kind: 'node', id, ...(before ? { before } : {}), ...(after ? { after } : {}) });
    }
    for (const [id, after] of this.pageOverlay) {
      const before = own(this.base.pages, id);
      if (deepEqual(before, after ?? undefined)) continue;
      out.push({ kind: 'page', id, ...(before ? { before } : {}), ...(after ? { after } : {}) });
    }
    if (!deepEqual(this.base.tokens, this.tokenTree)) {
      out.push({ kind: 'tokens', id: 'tokens', before: this.base.tokens, after: this.tokenTree });
    }
    if (!deepEqual(this.base.themes, this.themeMap)) {
      out.push({ kind: 'themes', id: 'themes', before: this.base.themes, after: this.themeMap });
    }
    return out;
  }

  /** Builds the next document. Unchanged records are shared with the base document. */
  finish(revision: number): SiteDoc {
    const nodes = { ...this.base.nodes };
    for (const [id, n] of this.nodeOverlay) {
      if (n) nodes[id] = n;
      else delete nodes[id];
    }
    const pages = { ...this.base.pages };
    for (const [id, p] of this.pageOverlay) {
      if (p) pages[id] = p;
      else delete pages[id];
    }
    const next: SiteDoc = {
      ...this.base,
      revision,
      nodes,
      pages,
      tokens: this.tokenTree,
      themes: this.themeMap,
    };
    if (this.counterOverlay.size) {
      next.counters = { ...(this.base.counters ?? {}), ...Object.fromEntries(this.counterOverlay) };
    }
    return next;
  }
}
