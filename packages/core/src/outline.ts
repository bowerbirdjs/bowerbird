import { type DocView, descendants } from './doc.js';
import type { BNode, NodeId, PageId } from './types.js';

export interface OutlineOptions {
  page?: PageId;
  /** Outline the subtree of this node instead of whole pages. */
  root?: NodeId;
  /** Levels below the page root (or `root`) to show. Default 3. */
  depth?: number;
  /** Maximum characters of text shown per node. Default 60. */
  maxText?: number;
}

const quote = (value: unknown, max: number) => {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ') : '';
  return JSON.stringify(s.length > max ? `${s.slice(0, max - 1)}…` : s);
};

/** One line describing a node, e.g. `hero-1/heading  text<h1>  "Ship faster"`. */
export function describeNode(n: BNode, maxText = 60): string {
  const parts: string[] = [n.id];
  if (n.section) {
    const variant = Object.entries(n.section.variant)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    parts.push(`section:${n.section.name}${variant ? `[${variant}]` : ''}`);
  } else {
    parts.push(typeof n.props.tag === 'string' ? `${n.type}<${n.props.tag}>` : n.type);
  }
  if (n.type === 'text' || n.type === 'button') parts.push(quote(n.props.text, maxText));
  if (n.type === 'link') {
    parts.push(
      `${n.props.text ? `${quote(n.props.text, maxText)} ` : ''}→ ${String(n.props.href)}`,
    );
  }
  if (n.type === 'image') parts.push(`alt=${quote(n.props.alt, maxText)}`);
  if (n.vars) parts.push(`vars(${Object.keys(n.vars).join(', ')})`);
  if (n.styles) parts.push(`css(${Object.keys(n.styles).join(', ')})`);
  return parts.join('  ');
}

/**
 * A compact, token-efficient outline of pages or a subtree: one line per node, indented by depth.
 * Agents read this first and fetch full node data only where needed.
 */
export function outline(view: DocView, options: OutlineOptions = {}): string {
  const depth = options.depth ?? 3;
  const maxText = options.maxText ?? 60;
  const lines: string[] = [];
  const walk = (node: BNode, level: number) => {
    lines.push(`${'  '.repeat(level)}${describeNode(node, maxText)}`);
    const children = view.children(node.id);
    if (!children.length) return;
    if (level >= depth) {
      const count = descendants(view, node.id).length;
      lines[lines.length - 1] += `  [+${count} more]`;
      return;
    }
    for (const child of children) walk(child, level + 1);
  };

  if (options.root) {
    const node = view.node(options.root);
    if (!node) return `No node "${options.root}".`;
    if (node.parent === null) for (const child of view.children(node.id)) walk(child, 0);
    else walk(node, 0);
    return lines.join('\n');
  }
  const pages = options.page
    ? [view.page(options.page)].filter((p) => p !== undefined)
    : view.pages();
  if (!pages.length)
    return options.page ? `No page "${options.page}".` : 'The site has no pages yet.';
  for (const page of pages) {
    lines.push(`page ${page.id}  "${page.path}"  title=${JSON.stringify(page.title)}`);
    const children = view.children(page.rootId);
    if (!children.length) lines.push('  (empty)');
    for (const child of children) walk(child, 1);
  }
  return lines.join('\n');
}
