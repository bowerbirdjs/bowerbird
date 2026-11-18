import {
  type BNode,
  DocIndex,
  type DocView,
  type ElementSpec,
  type Page,
  type Registry,
  type SiteDoc,
  sanitizeUrl,
} from '@bowerbirdjs/core';
import { type CompileCssOptions, type CssMode, compileCss } from '@bowerbirdjs/css';

export interface RenderOptions {
  mode?: CssMode;
  /**
   * Which elements get `data-bb-node` attributes. `all` (editor default) makes every node
   * addressable; `styled` (published default) only marks nodes that have node-level CSS.
   */
  nodeIds?: 'all' | 'styled' | 'none';
  /** Passed to the CSS compiler in editor mode. */
  canvasSelector?: CompileCssOptions['canvasSelector'];
}

export interface RenderedPage {
  page: Page;
  html: string;
  css: string;
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);
const TAG_RE = /^[a-z][a-z0-9-]*$/;
const ATTR_RE = /^[a-z][a-z0-9-]*$/;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

export { sanitizeUrl };

function attrString(attrs: Record<string, unknown>): string {
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (!ATTR_RE.test(name) || name.startsWith('on') || name === 'style') continue;
    out += value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  return out;
}

function codeComponentAttrs(props: BNode['props']): NonNullable<ElementSpec['attrs']> {
  const attrs: NonNullable<ElementSpec['attrs']> = {};
  for (const [key, value] of Object.entries(props)) {
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    attrs[name] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  }
  return attrs;
}

interface Ctx {
  view: DocView;
  registry: Registry;
  mode: CssMode;
  nodeIds: NonNullable<RenderOptions['nodeIds']>;
}

function renderNode(ctx: Ctx, node: BNode, sectionName: string | undefined, depth = 0): string {
  // Validated documents are at most MAX_DEPTH deep; this guards documents loaded from elsewhere.
  if (depth > 200) return '';
  const def = ctx.registry.component(node.type);
  let spec: ElementSpec;
  if (def?.render) spec = def.render(node);
  else if (def?.kind === 'code' && def.tag)
    spec = { tag: def.tag, attrs: codeComponentAttrs(node.props) };
  else spec = { tag: 'div', attrs: { 'data-bb-missing': node.type } };
  const tag = TAG_RE.test(spec.tag) ? spec.tag : 'div';

  const { class: specClass, ...specAttrs } = spec.attrs ?? {};
  const classes = specClass ? [String(specClass)] : [];
  let scope = sectionName;
  if (node.section) {
    scope = node.section.name;
    classes.push(`bb-${scope}`);
    for (const [axis, value] of Object.entries(node.section.variant))
      classes.push(`bb-${scope}--${axis}-${value}`);
  } else if (node.part && scope) {
    classes.push(`bb-${scope}__${node.part}`);
  }
  const attrs: Record<string, unknown> = { class: classes.join(' ') || undefined, ...specAttrs };
  if (ctx.nodeIds === 'all' || (ctx.nodeIds === 'styled' && (node.styles || node.vars))) {
    attrs['data-bb-node'] = node.id;
  }
  if (ctx.mode === 'editor' && node.section) attrs['data-bb-section'] = node.section.name;
  if (typeof attrs.href === 'string') attrs.href = sanitizeUrl(attrs.href, 'href');
  if (typeof attrs.src === 'string') attrs.src = sanitizeUrl(attrs.src, 'src');

  const open = `<${tag}${attrString(attrs)}>`;
  if (spec.void || VOID.has(tag)) return open;
  const children = ctx.view.children(node.id);
  const inner = children.length
    ? children
        .map((c) => renderNode(ctx, c, scope, depth + 1))
        .join(node.parent === null ? '\n' : '')
    : escapeHtml(spec.text ?? '');
  return node.parent === null ? `${open}\n${inner}\n</${tag}>` : `${open}${inner}</${tag}>`;
}

/** Renders one page to semantic HTML (light DOM, no scripts) plus its CSS. */
export function renderPage(
  doc: SiteDoc,
  registry: Registry,
  pageId: string,
  options: RenderOptions = {},
): RenderedPage {
  const view = new DocIndex(doc);
  const page = view.page(pageId);
  if (!page) throw new Error(`No page "${pageId}".`);
  const root = view.node(page.rootId);
  if (!root) throw new Error(`Page "${pageId}" has no root node.`);
  const mode = options.mode ?? 'published';
  const ctx: Ctx = {
    view,
    registry,
    mode,
    nodeIds: options.nodeIds ?? (mode === 'editor' ? 'all' : 'styled'),
  };
  const html = renderNode(ctx, root, undefined);
  const css = compileCss(doc, registry, {
    mode,
    page: pageId,
    ...(options.canvasSelector ? { canvasSelector: options.canvasSelector } : {}),
  });
  return { page, html, css };
}

export interface DocumentOptions extends RenderOptions {
  lang?: string;
  /** Sets `data-theme` on `<html>`. */
  theme?: string;
  /** Extra markup for `<head>` (trusted). */
  head?: string;
  /** Extra markup before `</body>` (trusted). */
  bodyEnd?: string;
}

/** A complete standalone HTML document for a page. */
export function renderDocument(
  doc: SiteDoc,
  registry: Registry,
  pageId: string,
  options: DocumentOptions = {},
): string {
  const { page, html, css } = renderPage(doc, registry, pageId, options);
  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(options.lang ?? 'en')}"${options.theme ? ` data-theme="${escapeAttr(options.theme)}"` : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)}</title>`,
    page.description ? `<meta name="description" content="${escapeAttr(page.description)}">` : '',
    `<style>\n${css.replace(/<\/style/gi, '<\\/style')}</style>`,
    options.head ?? '',
    '</head>',
    '<body style="margin:0">',
    html,
    options.bodyEnd ?? '',
    '</body>',
    '</html>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
