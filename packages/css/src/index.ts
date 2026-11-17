import {
  aliasToCss,
  type BNode,
  type Breakpoint,
  DocIndex,
  flattenTokens,
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
export function tokenDeclarations(doc: SiteDoc): { base: string[]; themes: [string, string[]][] } {
  const base = flattenTokens(doc.tokens).tokens.map((t) => `${t.cssVar}: ${t.value};`);
  const themes = Object.entries(doc.themes).map(
    ([name, values]) =>
      [name, Object.entries(values).map(([path, v]) => `${tokenVar(path)}: ${aliasToCss(v)};`)] as [
        string,
        string[],
      ],
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
export function nodeCss(nodes: Iterable<BNode>, breakpoints: Breakpoint[]): string {
  const base: string[] = [];
  const byBreakpoint = new Map<string, string[]>();
  for (const n of nodes) {
    const sel = nodeSelector(n.id);
    if (n.vars)
      base.push(
        block(
          sel,
          Object.entries(n.vars).map(([k, v]) => `${k}: ${v};`),
        ),
      );
    for (const bp of breakpoints) {
      const states = n.styles?.[bp.id];
      if (!states) continue;
      for (const [state, decls] of Object.entries(states)) {
        const rule = block(
          sel + (STATE_PSEUDO[state] ?? ''),
          Object.entries(decls).map(([p, v]) => `${p}: ${v};`),
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
  const nodes = options.page
    ? pageNodes(new DocIndex(doc), options.page)
    : Object.values(doc.nodes);
  const { base, themes } = tokenDeclarations(doc);
  const sections = sectionCss(
    registry,
    nodes.filter((n) => n.section).map((n) => n.section!.name),
  );
  const nodeRules = nodeCss(nodes, doc.breakpoints);

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

  // Editor mode: no layers (unlayered host CSS would beat any layer), everything scoped to the canvas.
  const scope = options.canvasSelector ?? '[data-bb-canvas]';
  return `${join([
    block(scope, base),
    ...themes.map(([name, decls]) =>
      block(`${scope}[data-theme="${name}"], ${scope} [data-theme="${name}"]`, decls),
    ),
    `${scope} {\n${indent(join([BASE_CSS, sections, nodeRules]))}\n}`,
  ])}\n`;
}
