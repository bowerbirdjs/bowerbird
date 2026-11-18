import { DocIndex, type Page, pageNodes, type Registry, type SiteDoc } from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { escapeAttr, escapeHtml, renderPage } from '@bowerbirdjs/html';

/** A file to write, with a path relative to the output folder (forward slashes). */
export interface ExportedFile {
  path: string;
  contents: string;
}

export interface StaticSiteOptions {
  /** `lang` on every page. Default `en`. */
  lang?: string;
  /** Sets `data-theme` on `<html>` (e.g. `dark`). */
  theme?: string;
  /** Public origin, e.g. `https://example.com`; adds `sitemap.xml` and canonical links. */
  baseUrl?: string;
  /** Name of the shared stylesheet. Default `styles.css`. */
  cssFile?: string;
  /** Extra markup for every `<head>` (trusted: analytics, fonts). */
  head?: string;
}

/** `/` → `index.html`, `/about` → `about/index.html`, so every page has a clean URL. */
export function pageFile(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/index.html` : 'index.html';
}

/** Relative path from a page file back to the output root (`about/index.html` → `../`). */
const toRoot = (file: string) => '../'.repeat(file.split('/').length - 1);

/**
 * A document with only what is on pages: symbol definitions (and any stray nodes) are dropped, so
 * the shared stylesheet holds no rules for them.
 */
export function publishedDoc(doc: SiteDoc): SiteDoc {
  const view = new DocIndex(doc);
  const nodes: SiteDoc['nodes'] = {};
  for (const page of Object.values(doc.pages)) {
    for (const n of pageNodes(view, page.id)) nodes[n.id] = n;
  }
  const { symbols: _, ...rest } = doc;
  return { ...rest, nodes };
}

/** URL path of a page in a locale: default language at the root, others under `/<locale>/`. */
function localePath(path: string, locale: string | undefined): string {
  const clean = path === '/' ? '/' : `${path.replace(/\/+$/, '')}/`;
  return locale ? `/${locale}${clean}` : clean;
}

function pageDocument(
  page: Page,
  html: string,
  file: string,
  options: StaticSiteOptions,
  lang: string,
  alternates: { lang: string; path: string }[],
  self: string,
): string {
  const css = `${toRoot(file)}${options.cssFile ?? 'styles.css'}`;
  const base = options.baseUrl?.replace(/\/+$/, '');
  const links = base
    ? [
        `<link rel="canonical" href="${escapeAttr(`${base}${self}`)}">`,
        ...(alternates.length > 1
          ? alternates.map(
              (a) =>
                `<link rel="alternate" hreflang="${escapeAttr(a.lang)}" href="${escapeAttr(`${base}${a.path}`)}">`,
            )
          : []),
      ].join('\n')
    : '';
  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(options.lang ?? lang)}"${options.theme ? ` data-theme="${escapeAttr(options.theme)}"` : ''}>`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(page.title)}</title>`,
    page.description ? `<meta name="description" content="${escapeAttr(page.description)}">` : '',
    links,
    `<link rel="stylesheet" href="${escapeAttr(css)}">`,
    options.head ?? '',
    '</head>',
    '<body style="margin:0">',
    html,
    '</body>',
    '</html>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * Every page as a standalone HTML file with clean URLs, one shared stylesheet, and a sitemap when
 * `baseUrl` is given. Output is plain HTML and CSS: no scripts, no framework.
 */
export function exportStaticSite(
  doc: SiteDoc,
  registry: Registry,
  options: StaticSiteOptions = {},
): ExportedFile[] {
  const published = publishedDoc(doc);
  const files: ExportedFile[] = [
    { path: options.cssFile ?? 'styles.css', contents: compileCss(published, registry) },
  ];
  const pages = Object.values(published.pages).sort((a, b) => a.path.localeCompare(b.path));
  // Every language gets every page: the default at the root, others under /<locale>/.
  const defaultLang = published.locales?.default ?? 'en';
  const languages: (string | undefined)[] = [undefined, ...(published.locales?.others ?? [])];
  const urls: string[] = [];
  for (const page of pages) {
    const alternates = languages.map((l) => ({
      lang: l ?? defaultLang,
      path: localePath(page.path, l),
    }));
    for (const locale of languages) {
      const self = localePath(page.path, locale);
      const file = pageFile(self);
      const { html } = renderPage(published, registry, page.id, locale ? { locale } : {});
      files.push({
        path: file,
        contents: pageDocument(page, html, file, options, locale ?? defaultLang, alternates, self),
      });
      urls.push(self);
    }
  }
  if (options.baseUrl) {
    const base = options.baseUrl.replace(/\/+$/, '');
    const list = urls.map((u) => `  <url><loc>${escapeHtml(`${base}${u}`)}</loc></url>`).join('\n');
    files.push({
      path: 'sitemap.xml',
      contents: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list}\n</urlset>\n`,
    });
  }
  return files;
}
