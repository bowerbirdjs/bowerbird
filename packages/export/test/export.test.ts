import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, type Store } from '@bowerbirdjs/core';
import { exportReact, exportStaticSite, pageFile } from '@bowerbirdjs/export';
import { renderPage } from '@bowerbirdjs/html';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';

function site(): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'page.create', id: 'pricing', path: '/pricing/teams', title: 'Team pricing' },
      {
        op: 'section.insert',
        section: 'hero',
        page: 'home',
        content: { heading: { text: 'Tom & Jerry say "hi" {curly} <tags>' } },
      },
      { op: 'section.insert', section: 'features', page: 'home' },
      { op: 'section.insert', section: 'footer', page: 'home' },
      { op: 'section.insert', section: 'pricing', page: 'pricing' },
      { op: 'style.set', id: 'hero-1/heading', css: 'color: var(--color-accent)' },
      { op: 'symbol.create', id: 'footer-1', name: 'Site footer' },
    ],
  });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return store;
}

describe('exportStaticSite', () => {
  it('writes clean-URL pages, one stylesheet and a sitemap', () => {
    const { doc, registry } = site();
    const files = exportStaticSite(doc, registry, { baseUrl: 'https://example.com/' });
    expect(files.map((f) => f.path)).toEqual([
      'styles.css',
      'index.html',
      'pricing/teams/index.html',
      'sitemap.xml',
    ]);
    const nested = files.find((f) => f.path === 'pricing/teams/index.html')!.contents;
    expect(nested).toContain('<link rel="stylesheet" href="../../styles.css">');
    // The page background fills the window (no white band under a short dark page).
    expect(nested).toContain('<body style="margin:0;background:var(--color-surface,Canvas)">');
    expect(nested).toContain('<link rel="canonical" href="https://example.com/pricing/teams/">');
    expect(nested).not.toContain('<style');
    expect(files.at(-1)!.contents).toContain('<loc>https://example.com/pricing/teams/</loc>');
    const css = files[0]!.contents;
    expect(css).toContain('[data-bb-node="hero-1/heading"]');
    // Symbol definitions are not on any page, so they are not published.
    expect(css).not.toContain('symbol-site-footer');
    expect(pageFile('/')).toBe('index.html');
  });
});

describe('exportStaticSite with languages', () => {
  it('writes every page per language with hreflang alternates', () => {
    const store = site();
    store.apply({
      ops: [
        { op: 'locale.set', add: ['de'] },
        { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
      ],
    });
    const files = exportStaticSite(store.doc, store.registry, { baseUrl: 'https://example.com' });
    expect(files.map((f) => f.path)).toEqual([
      'styles.css',
      'index.html',
      'de/index.html',
      'pricing/teams/index.html',
      'de/pricing/teams/index.html',
      'sitemap.xml',
    ]);
    const de = files.find((f) => f.path === 'de/index.html')!.contents;
    expect(de).toContain('<html lang="de">');
    expect(de).toContain('Hallo');
    expect(de).toContain('<link rel="stylesheet" href="../styles.css">');
    expect(de).toContain('<link rel="alternate" hreflang="en" href="https://example.com/">');
    expect(de).toContain('<link rel="canonical" href="https://example.com/de/">');
  });
});

describe('exportReact', () => {
  it('produces components that render the same markup as the HTML renderer', async () => {
    const { doc, registry } = site();
    const files = exportReact(doc, registry);
    expect(files.map((f) => f.path)).toEqual([
      'styles.css',
      'pages/Home.tsx',
      'pages/PricingTeams.tsx',
      'routes.ts',
    ]);
    for (const [file, pageId] of [
      ['pages/Home.tsx', 'home'],
      ['pages/PricingTeams.tsx', 'pricing'],
    ] as const) {
      const source = files.find((f) => f.path === file)!.contents;
      const { code } = await transformWithOxc(source, file, {
        jsx: { runtime: 'classic', pragma: 'React.createElement' },
        lang: 'tsx',
      });
      const component = new Function(
        'React',
        `${code.replace(/export default function/, 'return function').replace(/export const/g, 'const')}`,
      )({
        createElement,
      });
      const markup = renderToStaticMarkup(createElement(component));
      const expected = renderPage(doc, registry, pageId).html.replace(/\n/g, '');
      // React escapes quotes in text as &quot;; the HTML renderer leaves them (both are valid).
      expect(markup.replaceAll('&quot;', '"')).toBe(expected);
    }
    expect(files.at(-1)!.contents).toContain(
      '{ path: "/pricing/teams", title: "Team pricing", Component: PricingTeams }',
    );
  });
});

describe('exportCatalog', () => {
  it('describes components and sections with JSON Schema, and validates node trees', async () => {
    const { exportCatalog } = await import('@bowerbirdjs/export');
    const catalog = exportCatalog(createDefaultRegistry());
    expect(catalog.format).toBe('bowerbird-catalog');
    const text = catalog.components.find((c) => c.name === 'text')!;
    expect(text.contentProps).toEqual(['text']);
    expect((text.props as { properties: Record<string, unknown> }).properties).toHaveProperty(
      'tag',
    );
    const hero = catalog.sections.find((s) => s.name === 'hero')!;
    expect(hero.variants.layout).toContain('split');
    expect(hero.parts.map((p) => p.path)).toContain('heading');
    const node = (catalog.nodeSchema.$defs as { node: { oneOf: unknown[] } }).node;
    expect(node.oneOf.length).toBe(catalog.components.length);
    expect(JSON.stringify(catalog)).not.toContain('"$schema":"http://json-schema.org/draft-07');
  });
});
