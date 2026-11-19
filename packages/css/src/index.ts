import {
  aliasToCss,
  type BNode,
  type Breakpoint,
  checkProperty,
  cssValueSyntaxError,
  DocIndex,
  descendants,
  flattenTokens,
  isStyleState,
  isValidId,
  pageNodes,
  type Registry,
  type SiteDoc,
  STATE_PSEUDO,
  tokenVar,
} from '@bowerbirdjs/core';

/** Name of the container every page root establishes; breakpoints are container queries on it. */
export const PAGE_CONTAINER = 'bb-page';

/** `published`: cascade layers, tokens on `:root`. `editor`: everything nested under the canvas element. */
export type CssMode = 'published' | 'editor';

export interface CompileCssOptions {
  mode?: CssMode;
  /** Only include sections and node rules used on this page. */
  page?: string;
  /** Only include sections and node rules used in this node's subtree (e.g. a symbol definition). */
  root?: string;
  /** Editor mode: the canvas element selector. Default `[data-bb-canvas]`. */
  canvasSelector?: string;
}

/** Reset and page-level defaults. Uses `:where()` so sections override them easily. */
export const BASE_CSS = `.bb-page {
  container: ${PAGE_CONTAINER} / inline-size;
  font-family: var(--font-body, system-ui, sans-serif);
  color: var(--color-on-surface, CanvasText);
  background: var(--color-surface, Canvas);
  line-height: var(--leading-normal, 1.6);
  -webkit-font-smoothing: antialiased;
  /* One long word (a URL, a German compound) wraps instead of widening the layout. */
  overflow-wrap: anywhere;
}
.bb-page *, .bb-page *::before, .bb-page *::after { box-sizing: border-box; }
.bb-page :where(h1, h2, h3, h4, h5, h6, p, figure, blockquote, ul, ol) { margin: 0; }
.bb-page :where(ul, ol) { padding: 0; list-style: none; }
.bb-page :where(h1, h2, h3, h4, h5, h6) {
  font-family: var(--font-heading, inherit);
  line-height: var(--leading-tight, 1.15);
  text-wrap: balance;
}
.bb-page :where(img, svg, video) { display: block; max-width: 100%; height: auto; }
.bb-page :where(a) { color: inherit; }
.bb-page :where(button) { font: inherit; }`;

/**
 * Editor mode only: the canvas shares the host document, so host element rules (`h1 { … }`,
 * `.prose p { … }`) would reach page content, and the page would inherit the host's (or the
 * editor's) fonts. The page root starts from initial values, so nothing is inherited, and
 * everything the host sets on content elements and their pseudo-elements is reverted to browser
 * defaults. It comes first, so base, section and node rules (same specificity, later) still win.
 * Images and media keep their size attributes; SVG and host code components keep their styling.
 * Host `!important` rules and selectors more specific than two classes still get through.
 */
export const EDITOR_RESET_CSS = `.bb-page { all: initial; display: block; }
.bb-page :where(*):where(:not(svg, svg *, img, video, iframe, [data-bb-code], [data-bb-code] *)),
.bb-page :where(*:not(svg *, [data-bb-code], [data-bb-code] *))::before,
.bb-page :where(*:not(svg *, [data-bb-code], [data-bb-code] *))::after,
.bb-page :where(*:not(svg *, [data-bb-code], [data-bb-code] *))::marker,
.bb-page :where(*:not(svg *, [data-bb-code], [data-bb-code] *))::first-letter,
.bb-page :where(*:not(svg *, [data-bb-code], [data-bb-code] *))::first-line { all: revert; }
.bb-page :where(img, video, iframe) {
  margin: 0; padding: 0; border: 0; border-radius: 0; outline: 0; box-shadow: none; background: none;
  opacity: 1; filter: none; transform: none; object-fit: fill; vertical-align: baseline;
}`;

/** `1.5rem` → `calc(1.5 * 16px)`: the editor canvas must not depend on the host's root font size. */
export function remToPx(css: string): string {
  return css.replace(/(?<![\w.-])(\d*\.?\d+)rem\b/g, 'calc($1 * 16px)');
}

export const nodeSelector = (id: string) => `[data-bb-node="${id}"]`;

const indent = (css: string, by = '  ') =>
  css
    .split('\n')
    .map((l) => (l ? by + l : l))
    .join('\n');

const block = (selector: string, decls: string[]) =>
  decls.length ? `${selector} {\n${decls.map((d) => `  ${d}`).join('\n')}\n}` : '';

const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');

/** Token custom properties, plus one declaration list per theme. */
// Documents loaded from storage may never have passed through validated ops, so everything that
// ends up in CSS text is checked again here. Anything unsafe is skipped rather than emitted.
const VAR_NAME = /^--[A-Za-z0-9_-]+$/;
const THEME_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const safeValue = (v: unknown): v is string => typeof v === 'string' && !cssValueSyntaxError(v);
const safeDecl = (p: string, v: unknown) => !checkProperty(p) && safeValue(v);

export function tokenDeclarations(doc: SiteDoc): { base: string[]; themes: [string, string[]][] } {
  const base = flattenTokens(doc.tokens)
    .tokens.filter((t) => VAR_NAME.test(t.cssVar) && safeValue(t.value))
    .map((t) => `${t.cssVar}: ${t.value};`);
  const themes = Object.entries(doc.themes ?? {})
    .filter(([name]) => THEME_NAME.test(name))
    .map(
      ([name, values]) =>
        [
          name,
          Object.entries(values)
            .map(
              ([path, v]) => [tokenVar(path), typeof v === 'string' ? aliasToCss(v) : ''] as const,
            )
            .filter(([name, v]) => VAR_NAME.test(name) && safeValue(v))
            .map(([name, v]) => `${name}: ${v};`),
        ] as [string, string[]],
    );
  return { base, themes };
}

/** Default values for each used section's style variables, then the section's own CSS. */
export function sectionCss(registry: Registry, names: Iterable<string>): string {
  const out: string[] = [];
  for (const name of new Set(names)) {
    const def = registry.section(name);
    if (!def) continue;
    const defaults = Object.entries(def.vars ?? {}).map(([v, spec]) => `${v}: ${spec.default};`);
    out.push(join([block(`.bb-${name}`, defaults), def.css?.trim() ?? '']));
  }
  return join(out);
}

/** Rules for node-level variables and styles, with breakpoints as container queries. */
/**
 * Editor mode has no cascade layers, so node rules get ID-level specificity (`:is(#x, *)` matches
 * every element but counts as an id) to beat compound section selectors, as the `bb.nodes` layer
 * does in published CSS.
 */
const EDITOR_BOOST = ':is(#bb-node, *)';

export function nodeCss(
  nodes: Iterable<BNode>,
  breakpoints: Breakpoint[],
  mode: CssMode = 'published',
): string {
  const base: string[] = [];
  const byBreakpoint = new Map<string, string[]>();
  for (const n of nodes) {
    if (!isValidId(n.id)) continue;
    const sel = nodeSelector(n.id) + (mode === 'editor' ? EDITOR_BOOST : '');
    if (n.vars)
      base.push(
        block(
          sel,
          Object.entries(n.vars)
            .filter(([k, v]) => VAR_NAME.test(k) && safeValue(v))
            .map(([k, v]) => `${k}: ${v};`),
        ),
      );
    for (const bp of breakpoints) {
      if (!Number.isFinite(bp.minWidth)) continue;
      const states = n.styles && Object.hasOwn(n.styles, bp.id) ? n.styles[bp.id] : undefined;
      if (!states) continue;
      for (const [state, decls] of Object.entries(states)) {
        if (!isStyleState(state)) continue;
        const rule = block(
          sel + STATE_PSEUDO[state],
          Object.entries(decls)
            .filter(([p, v]) => safeDecl(p, v))
            .map(([p, v]) => `${p}: ${v};`),
        );
        if (!rule) continue;
        if (bp.minWidth <= 0) base.push(rule);
        else {
          const list = byBreakpoint.get(bp.id) ?? [];
          list.push(rule);
          byBreakpoint.set(bp.id, list);
        }
      }
    }
  }
  const out = [...base];
  for (const bp of breakpoints) {
    const rules = byBreakpoint.get(bp.id);
    if (rules?.length) {
      out.push(
        `@container ${PAGE_CONTAINER} (min-width: ${bp.minWidth}px) {\n${indent(rules.join('\n'))}\n}`,
      );
    }
  }
  return out.join('\n');
}

/** Compiles tokens, base styles, section styles and node styles into one stylesheet. */
export function compileCss(
  doc: SiteDoc,
  registry: Registry,
  options: CompileCssOptions = {},
): string {
  const mode = options.mode ?? 'published';
  const index = options.page || options.root ? new DocIndex(doc) : undefined;
  const rootNode = options.root ? index!.node(options.root) : undefined;
  const nodes = rootNode
    ? [rootNode, ...descendants(index!, rootNode.id)]
    : options.page
      ? pageNodes(index!, options.page)
      : Object.values(doc.nodes);
  const { base, themes } = tokenDeclarations(doc);
  const sections = sectionCss(
    registry,
    nodes.filter((n) => n.section).map((n) => n.section!.name),
  );
  const nodeRules = nodeCss(nodes, doc.breakpoints, mode);

  if (mode === 'published') {
    return `${join([
      '@layer bb.tokens, bb.base, bb.sections, bb.nodes;',
      `@layer bb.tokens {\n${indent(
        join([
          block(':root', base),
          ...themes.map(([name, decls]) => block(`[data-theme="${name}"]`, decls)),
        ]),
      )}\n}`,
      `@layer bb.base {\n${indent(BASE_CSS)}\n}`,
      sections ? `@layer bb.sections {\n${indent(sections)}\n}` : '',
      nodeRules ? `@layer bb.nodes {\n${indent(nodeRules)}\n}` : '',
    ])}\n`;
  }

  // Editor mode: no layers (unlayered host CSS would beat any layer), everything scoped to the
  // canvas, and rem converted to px so the host's root font size doesn't rescale the page.
  const scope = options.canvasSelector ?? '[data-bb-canvas]';
  return `${remToPx(
    join([
      block(scope, base),
      ...themes.map(([name, decls]) =>
        block(`${scope}[data-theme="${name}"], ${scope} [data-theme="${name}"]`, decls),
      ),
      `${scope} {\n${indent(join([EDITOR_RESET_CSS, BASE_CSS, sections, nodeRules]))}\n}`,
    ]),
  )}\n`;
}
