import { localizedPage, type Registry, type SiteDoc } from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { renderPage } from '@bowerbirdjs/html';
import { type ChildNode, isTag, isText } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import {
  checkOutputPaths,
  type ExportedFile,
  localePath,
  localizeLinks,
  publishedDoc,
} from './site.js';

/** CR, LF and the line/paragraph separators, which end a `//` comment in JavaScript. */
const LINE_TERMINATORS = new RegExp(`[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

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

/** Attributes whose presence means true; every other empty value is an empty string. */
const BOOLEAN_ATTRS = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

/** A JSX attribute value: a plain string literal when safe, a JS expression otherwise. */
function jsxValue(name: string, value: string): string {
  if (NUMERIC.has(name) && /^\d+$/.test(value)) return `{${value}}`;
  return /["\\&{}<>\n]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`;
}

/**
 * Text as JSX children: as is when harmless, otherwise as a string expression. Whitespace-only
 * text becomes `{" "}` (JSX would drop it, but between inline elements it's a visible space).
 */
function jsxText(text: string, dropNewlines: boolean): string {
  if (!text.trim()) return dropNewlines && text.includes('\n') ? '' : '{" "}';
  return /[{}<>&"'`\\\n]/.test(text) || /^\s|\s$/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

/**
 * `top`: the page's root element(s). Line breaks between their children (the sections) are
 * formatting of the generated HTML, not content, so they're dropped.
 */
function toJsx(nodes: ChildNode[], indent: string, top = false, dropNewlines = false): string {
  const out: string[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      const text = jsxText(node.data, dropNewlines);
      if (text) out.push(text);
      continue;
    }
    if (!isTag(node)) continue;
    const attrs = Object.entries(node.attribs)
      .map(([name, value]) => {
        const prop = PROP_NAMES[name] ?? name;
        return value === '' && BOOLEAN_ATTRS.has(name) ? prop : `${prop}=${jsxValue(name, value)}`;
      })
      .join(' ');
    const open = `<${node.name}${attrs ? ` ${attrs}` : ''}`;
    if (VOID.has(node.name)) {
      out.push(`${open} />`);
      continue;
    }
    const blockChildren = node.children.some((c) => isTag(c));
    const inner = toJsx(node.children, `${indent}  `, false, top);
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
  const sources = ['the stylesheet'];
  // Compared case-insensitively: `/a-b` and `/ab` must not become AB.tsx and Ab.tsx (macOS, Windows).
  const used = new Set<string>();
  const routes: { path: string; locale?: string; name: string; title: string }[] = [];
  const pages = Object.values(published.pages).sort((a, b) => a.path.localeCompare(b.path));
  // Every language gets every page, like the static export: others under /<locale>/.
  const languages: (string | undefined)[] = [undefined, ...(published.locales?.others ?? [])];
  for (const locale of languages) {
    for (const page of pages) {
      const base = componentName(page.path, page.title) + (locale ? localeSuffix(locale) : '');
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}${n}`;
      used.add(name.toLowerCase());
      const rendered = renderPage(published, registry, page.id, locale ? { locale } : {}).html;
      const html = locale ? localizeLinks(rendered, locale, pages) : rendered;
      const tree = parseDocument(html, { decodeEntities: true }).children;
      const jsx = toJsx(tree, '    ', true);
      const { title, description } = localizedPage(page, locale);
      // Line terminators would end the comment (titles are one line, but documents come from anywhere).
      const comment = `${title} (${page.path}${locale ? `, ${locale}` : ''})`.replace(
        LINE_TERMINATORS,
        ' ',
      );
      files.push({
        path: `${dir}/${name}.${ext}`,
        contents: [
          `// ${comment}, exported from Bowerbird.`,
          `export const title = ${JSON.stringify(title)};`,
          ...(description ? [`export const description = ${JSON.stringify(description)};`] : []),
          '',
          `export default function ${name}() {`,
          '  return (',
          `    ${jsx}`,
          '  );',
          '}',
          '',
        ].join('\n'),
      });
      sources.push(`page "${page.id}" (${page.path}${locale ? `, ${locale}` : ''})`);
      routes.push({
        path: locale ? localePath(page.path, locale) : page.path,
        ...(locale ? { locale } : {}),
        name,
        title,
      });
    }
  }
  // Imports name the file itself in JS; TypeScript resolves `.js` to the `.tsx` source.
  const importExt = ext === 'tsx' ? 'js' : 'jsx';
  files.push({
    path: `routes.${ext === 'tsx' ? 'ts' : 'js'}`,
    contents: [
      "import './styles.css';",
      ...routes.map((r) => `import ${r.name} from './${dir}/${r.name}.${importExt}';`),
      '',
      'export const routes = [',
      ...routes.map(
        (r) =>
          `  { path: ${JSON.stringify(r.path)}, ${r.locale ? `locale: ${JSON.stringify(r.locale)}, ` : ''}title: ${JSON.stringify(r.title)}, Component: ${r.name} },`,
      ),
      `]${ext === 'tsx' ? ' as const;' : ';'}`,
      '',
    ].join('\n'),
  });
  sources.push('the route list');
  checkOutputPaths(files, sources);
  return files;
}

/** `de` → `De`, `pt-BR` → `PtBR` (appended to component names). */
function localeSuffix(locale: string): string {
  return locale
    .split('-')
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join('');
}
