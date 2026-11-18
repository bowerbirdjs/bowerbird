import type { Registry, SiteDoc } from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { renderPage } from '@bowerbirdjs/html';
import { type ChildNode, isTag, isText } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { type ExportedFile, publishedDoc } from './site.js';

export interface ReactExportOptions {
  /** `.tsx` (default) or `.jsx` files. */
  typescript?: boolean;
  /** Folder for page components. Default `pages`. */
  pagesDir?: string;
}

/** HTML attribute → JSX prop name. `aria-*` and `data-*` stay as they are. */
const PROP_NAMES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  srcset: 'srcSet',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  fetchpriority: 'fetchPriority',
  enterkeyhint: 'enterKeyHint',
  autocomplete: 'autoComplete',
};
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);
const NUMERIC = new Set(['width', 'height']);

/** A JSX attribute value: a plain string literal when safe, a JS expression otherwise. */
function jsxValue(name: string, value: string): string {
  if (NUMERIC.has(name) && /^\d+$/.test(value)) return `{${value}}`;
  return /["\\&{}<>\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

/** Text as JSX children: as is when harmless, otherwise as a string expression. */
function jsxText(text: string): string {
  if (!text.trim()) return text.includes('\n') ? '' : text;
  return /[{}<>&"'`\\]/.test(text) || /^\s|\s$/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

function toJsx(nodes: ChildNode[], indent: string): string {
  const out: string[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      const text = jsxText(node.data);
      if (text) out.push(text);
      continue;
    }
    if (!isTag(node)) continue;
    const attrs = Object.entries(node.attribs)
      .map(([name, value]) => {
        const prop = PROP_NAMES[name] ?? name;
        return value === '' && name !== 'alt' ? prop : `${prop}=${jsxValue(name, value)}`;
      })
      .join(' ');
    const open = `<${node.name}${attrs ? ` ${attrs}` : ''}`;
    if (VOID.has(node.name)) {
      out.push(`${open} />`);
      continue;
    }
    const blockChildren = node.children.some((c) => isTag(c));
    const inner = toJsx(node.children, `${indent}  `);
    out.push(
      blockChildren
        ? `${open}>\n${indent}  ${inner}\n${indent}</${node.name}>`
        : `${open}>${inner}</${node.name}>`,
    );
  }
  return out.join(`\n${indent}`);
}

/** `/` → `Home`, `/pricing/teams` → `PricingTeams`. */
export function componentName(path: string, title: string): string {
  const source = path === '/' ? 'home' : path;
  const name = source
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Z]/.test(name) ? name : `Page${name || title.replace(/[^a-zA-Z0-9]/g, '')}`;
}

/**
 * React components, one per page, plus the shared stylesheet and a route list. Components are
 * static JSX: edit content in Bowerbird and export again, or treat the files as a starting point.
 */
export function exportReact(
  doc: SiteDoc,
  registry: Registry,
  options: ReactExportOptions = {},
): ExportedFile[] {
  const ext = options.typescript === false ? 'jsx' : 'tsx';
  const dir = options.pagesDir ?? 'pages';
  const published = publishedDoc(doc);
  const files: ExportedFile[] = [{ path: 'styles.css', contents: compileCss(published, registry) }];
  const used = new Set<string>();
  const routes: { path: string; name: string; title: string }[] = [];
  for (const page of Object.values(published.pages).sort((a, b) => a.path.localeCompare(b.path))) {
    let name = componentName(page.path, page.title);
    for (let n = 2; used.has(name); n++) name = `${componentName(page.path, page.title)}${n}`;
    used.add(name);
    const { html } = renderPage(published, registry, page.id);
    const tree = parseDocument(html, { decodeEntities: true }).children;
    const jsx = toJsx(tree, '    ');
    files.push({
      path: `${dir}/${name}.${ext}`,
      contents: [
        `// ${page.title} (${page.path}), exported from Bowerbird.`,
        `export const title = ${JSON.stringify(page.title)};`,
        ...(page.description
          ? [`export const description = ${JSON.stringify(page.description)};`]
          : []),
        '',
        `export default function ${name}() {`,
        '  return (',
        `    ${jsx}`,
        '  );',
        '}',
        '',
      ].join('\n'),
    });
    routes.push({ path: page.path, name, title: page.title });
  }
  files.push({
    path: `routes.${ext === 'tsx' ? 'ts' : 'js'}`,
    contents: [
      "import './styles.css';",
      ...routes.map((r) => `import ${r.name} from './${dir}/${r.name}.js';`),
      '',
      'export const routes = [',
      ...routes.map(
        (r) =>
          `  { path: ${JSON.stringify(r.path)}, title: ${JSON.stringify(r.title)}, Component: ${r.name} },`,
      ),
      ']' + (ext === 'tsx' ? ' as const;' : ';'),
      '',
    ].join('\n'),
  });
  return files;
}
