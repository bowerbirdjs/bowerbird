import { type DocView, descendants, isInstanceRoot } from './doc.js';
import { checkReadLocale, localizedProps, untranslatedProps } from './l10n.js';
import { PRIMITIVES } from './primitives.js';
import type { Registry } from './registry.js';
import { richTextToPlain } from './richtext.js';
import { instancesOf, overridesOf } from './symbols.js';
import type { BNode, NodeId, PageId } from './types.js';

export interface OutlineOptions {
  page?: PageId;
  /** Outline the subtree of this node instead of whole pages. */
  root?: NodeId;
  /** Levels below the page root (or `root`) to show. Default 3. */
  depth?: number;
  /** Maximum characters of text shown per node. Default 60. */
  maxText?: number;
  /**
   * Show this language's translations; untranslated content is marked. The default language
   * shows the content itself; an unknown language gives an error line.
   */
  locale?: string;
  /** Knows the content props of code components (for untranslated marks). */
  registry?: Registry;
}

const PRIMITIVE_CONTENT = new Map(PRIMITIVES.map((p) => [p.name, p.contentProps ?? []]));

/** Symbol and provenance notes for one node: instance roots, overrides, people's edits. */
export function nodeNotes(view: DocView, n: BNode): string[] {
  const notes: string[] = [];
  if (n.symbol) notes.push(`definition of symbol:${n.symbol}`);
  if (n.link) {
    if (isInstanceRoot(view, n)) notes.push(`instance of symbol:${n.link.symbol}`);
    const overrides = overridesOf(view, n);
    if (overrides.length)
      notes.push(`overrides(${overrides.map((o) => o.replace(/^props\./, '')).join(', ')})`);
  }
  const human = Object.entries(n.edited ?? {})
    .filter(([field, s]) => field !== 'node' && s.kind === 'user')
    .map(([, s]) => s)
    .sort((a, b) => b.rev - a.rev)[0];
  if (human) notes.push(`edited by ${human.by}`);
  return notes;
}

const quote = (value: unknown, max: number) => {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ') : '';
  return JSON.stringify(s.length > max ? `${s.slice(0, max - 1)}…` : s);
};

/** One line describing a node, e.g. `hero-1/heading  text<h1>  "Ship faster"`. */
export function describeNode(node: BNode, maxText = 60, locale?: string): string {
  const n = locale ? { ...node, props: localizedProps(node, locale) } : node;
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
  if (n.type === 'rich-text')
    parts.push(
      quote(richTextToPlain(typeof n.props.html === 'string' ? n.props.html : ''), maxText),
    );
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
  let locale: string | undefined;
  if (options.locale) {
    const checked = checkReadLocale(view.locales?.(), options.locale);
    if (checked.error) return checked.error;
    if (checked.note) lines.push(checked.note);
    locale = checked.locale;
  }
  const content = (type: string) =>
    options.registry?.component(type)?.contentProps ?? PRIMITIVE_CONTENT.get(type) ?? [];
  const walk = (node: BNode, level: number) => {
    const notes = nodeNotes(view, node);
    if (locale && untranslatedProps(node, content(node.type), locale).length)
      notes.push(`untranslated ${locale}`);
    lines.push(
      `${'  '.repeat(level)}${describeNode(node, maxText, locale)}${notes.length ? `  [${notes.join('; ')}]` : ''}`,
    );
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
    const title = (locale && page.l10n?.[locale]?.title) || page.title;
    lines.push(`page ${page.id}  "${page.path}"  title=${JSON.stringify(title)}`);
    const children = view.children(page.rootId);
    if (!children.length) lines.push('  (empty)');
    for (const child of children) walk(child, 1);
  }
  if (!options.page) {
    for (const symbol of view.symbols()) {
      const count = instancesOf(view, symbol.id).length;
      lines.push(
        `symbol ${symbol.id}  ${JSON.stringify(symbol.name)}  definition=${symbol.rootId}  ${count} instance${count === 1 ? '' : 's'}`,
      );
    }
  }
  return lines.join('\n');
}
