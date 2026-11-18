import {
  type BNode,
  DocIndex,
  type DocView,
  type ElementSpec,
  localizedPage,
  localizedProps,
  type Page,
  type Registry,
  type RenderContext,
  type SiteDoc,
  sanitizeRichText,
  sanitizeUrl,
  stripRichTextLinks,
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
  /** Render this language's translations (falling back to the default content). */
  locale?: string;
}

export interface RenderedPage {
  page: Page;
  html: string;
  css: string;
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);
/**
 * Never emitted, whatever a component or a stored document says: these run code, load resources
 * or change how the rest of the page is parsed or styled.
 */
const DENIED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'template',
  'base',
  'meta',
  'link',
  'title',
  'head',
  'html',
  'body',
  'svg',
  'math',
  'noscript',
  'xmp',
  'plaintext',
  'textarea',
  'form',
  'input',
  'select',
  'portal',
]);
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
  locale?: string;
  /** What components' `render` functions see. */
  render: RenderContext;
}

function renderContext(view: DocView, mode: CssMode, locale?: string): RenderContext {
  return {
    data: (key) => view.data?.(key),
    mode: mode === 'editor' ? 'editor' : 'published',
    view,
    ...(locale ? { locale } : {}),
  };
}

/** Attributes as written, minus editor-only marks outside the editor, with URLs sanitized. */
function cleanAttrs(ctx: Ctx, attrs: Record<string, unknown>): Record<string, unknown> {
  const out = { ...attrs };
  if (ctx.mode !== 'editor') delete out['data-bb-data'];
  if (typeof out.href === 'string') out.href = sanitizeUrl(out.href, 'href');
  if (typeof out.src === 'string') out.src = sanitizeUrl(out.src, 'src');
  return out;
}

const VAR_NAME = /^--[a-z][a-z0-9-]*$/;
const VAR_VALUE = /^(#[0-9a-fA-F]{3,8}|-?\d+(\.\d+)?(px|rem|em|%|deg)?)$/;

/** `ElementSpec.vars` as a style attribute; anything that isn't a colour or number is dropped. */
function varsAttr(vars: ElementSpec['vars']): string {
  const decls = Object.entries(vars ?? {}).filter(
    ([name, value]) => VAR_NAME.test(name) && VAR_VALUE.test(value),
  );
  return decls.length
    ? ` style="${escapeAttr(decls.map(([n, v]) => `${n}: ${v}`).join('; '))}"`
    : '';
}

/** Elements a component generated from data (see `ElementSpec.children`). */
function renderSpec(ctx: Ctx, spec: ElementSpec | string, depth: number, inLink: boolean): string {
  if (typeof spec === 'string') return escapeHtml(spec);
  if (depth > 200) return '';
  const tag = TAG_RE.test(spec.tag) && !DENIED_TAGS.has(spec.tag) ? spec.tag : 'div';
  const open = `<${tag}${attrString(cleanAttrs(ctx, spec.attrs ?? {}))}${varsAttr(spec.vars)}>`;
  if (spec.void || VOID.has(tag)) return open;
  const linked = inLink || tag === 'a';
  return `${open}${specInner(ctx, spec, depth, linked)}</${tag}>`;
}

function specInner(ctx: Ctx, spec: ElementSpec, depth: number, linked: boolean): string {
  if (spec.children?.length)
    return spec.children.map((c) => renderSpec(ctx, c, depth + 1, linked)).join('');
  if (spec.html !== undefined)
    return linked ? stripRichTextLinks(sanitizeRichText(spec.html)) : sanitizeRichText(spec.html);
  return escapeHtml(spec.text ?? '');
}

function renderNode(
  ctx: Ctx,
  node: BNode,
  sectionName: string | undefined,
  depth = 0,
  inLink = false,
): string {
  // Validated documents are at most MAX_DEPTH deep; this guards documents loaded from elsewhere.
  if (depth > 200) return '';
  const def = ctx.registry.component(node.type);
  const props = localizedProps(node, ctx.locale);
  let spec: ElementSpec;
  if (def?.render) spec = def.render(props === node.props ? node : { ...node, props }, ctx.render);
  else if (def?.kind === 'code' && def.tag)
    spec = { tag: def.tag, attrs: codeComponentAttrs(props) };
  else spec = { tag: 'div', attrs: { 'data-bb-missing': node.type } };
  const tag = TAG_RE.test(spec.tag) && !DENIED_TAGS.has(spec.tag) ? spec.tag : 'div';

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
  // Host code components keep the host's own styling inside the editor canvas (see the reset).
  if (ctx.mode === 'editor' && def?.kind === 'code') attrs['data-bb-code'] = node.type;

  const open = `<${tag}${attrString(cleanAttrs(ctx, attrs))}>`;
  if (spec.void || VOID.has(tag)) return open;
  const children = ctx.view.children(node.id);
  // Links can't nest (browsers split them apart), so rich text inside a link loses its own links.
  const linked = inLink || tag === 'a';
  const inner = children.length
    ? children
        .map((c) => renderNode(ctx, c, scope, depth + 1, linked))
        .join(node.parent === null ? '\n' : '')
    : specInner(ctx, spec, depth, linked);
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
    ...(options.locale ? { locale: options.locale } : {}),
    render: renderContext(view, mode, options.locale),
  };
  const html = renderNode(ctx, root, undefined);
  const css = compileCss(doc, registry, {
    mode,
    page: pageId,
    ...(options.canvasSelector ? { canvasSelector: options.canvasSelector } : {}),
  });
  return { page, html, css };
}

/**
 * Renders one node's subtree (e.g. a symbol definition, which is on no page) inside a page root
 * element, so section CSS, base styles and container queries apply as they do on a page.
 */
export function renderSubtree(
  doc: SiteDoc,
  registry: Registry,
  rootId: string,
  options: RenderOptions = {},
): { html: string; css: string } {
  const view = new DocIndex(doc);
  const root = view.node(rootId);
  if (!root) throw new Error(`No node "${rootId}".`);
  const mode = options.mode ?? 'published';
  const ctx: Ctx = {
    view,
    registry,
    mode,
    nodeIds: options.nodeIds ?? (mode === 'editor' ? 'all' : 'styled'),
    ...(options.locale ? { locale: options.locale } : {}),
    render: renderContext(view, mode, options.locale),
  };
  const html = `<div class="bb-page">\n${renderNode(ctx, root, undefined)}\n</div>`;
  const css = compileCss(doc, registry, {
    mode,
    root: rootId,
    ...(options.canvasSelector ? { canvasSelector: options.canvasSelector } : {}),
  });
  return { html, css };
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
  const { title, description } = localizedPage(page, options.locale);
  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(options.lang ?? options.locale ?? doc.locales?.default ?? 'en')}"${options.theme ? ` data-theme="${escapeAttr(options.theme)}"` : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeAttr(description)}">` : '',
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
