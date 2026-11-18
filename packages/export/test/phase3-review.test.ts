import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, type SiteDoc, type Store } from '@bowerbirdjs/core';
import { exportReact, exportStaticSite } from '@bowerbirdjs/export';
import { renderPage } from '@bowerbirdjs/html';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { describe, expect, it } from 'vitest';

function site(ops: unknown[] = []): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }, ...ops] });
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return store;
}

/** Compiles an exported page component and returns it (and what evaluating it did). */
async function load(source: string, file: string) {
  const { code } = await transformWithOxc(source, file, {
    jsx: { runtime: 'classic', pragma: 'React.createElement' },
    lang: file.endsWith('.jsx') ? 'jsx' : 'tsx',
  });
  return new Function(
    'React',
    code.replace(/export default function/, 'return function').replace(/export const/g, 'const'),
  )({ createElement }) as FunctionComponent;
}

/** A stored document that skipped op validation (e.g. edited by hand or by an older version). */
const withPages = (doc: SiteDoc, pages: { id: string; path: string; title?: string }[]) => {
  const next = structuredClone(doc);
  for (const p of pages) {
    const rootId = `root-${p.id}`;
    next.nodes[rootId] = { id: rootId, type: 'root', parent: null, order: 'a0', props: {} };
    next.pages[p.id] = { id: p.id, path: p.path, title: p.title ?? p.id, rootId };
  }
  return next;
};

describe('React export safety and fidelity', () => {
  it('page titles never escape the header comment', async () => {
    const store = site();
    const lineSeparator = String.fromCharCode(0x2028);
    for (const title of [
      'Evil\nglobalThis.pwned = 1; //',
      `Evil${lineSeparator}globalThis.pwned = 1; //`,
    ]) {
      const doc = structuredClone(store.doc);
      doc.pages.home!.title = title;
      const file = exportReact(doc, store.registry).find((f) => f.path === 'pages/Home.tsx')!;
      expect(file.contents.split('\n')[0]).toMatch(
        /^\/\/ Evil.*globalThis\.pwned = 1; \/\/ \(\/\)/,
      );
      await load(file.contents, file.path);
      expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
    }
  });

  it('keeps spaces between inline elements and empty attribute values', async () => {
    const store = site([
      {
        op: 'node.insert',
        parent: 'root-home',
        node: {
          type: 'rich-text',
          props: {
            html: '<strong>Bold</strong> <em>italic</em> and <a href="/x">link</a> <b>z</b>',
          },
        },
      },
      {
        op: 'node.insert',
        parent: 'root-home',
        node: { type: 'link', props: { href: '', text: 'Empty' } },
      },
      { op: 'node.insert', parent: 'root-home', node: { type: 'box', props: { label: '' } } },
    ]);
    const file = exportReact(store.doc, store.registry).find((f) => f.path === 'pages/Home.tsx')!;
    expect(file.contents).toContain('href=""');
    expect(file.contents).not.toMatch(/ href[ >]/);
    expect(file.contents).not.toContain('aria-label>');
    const markup = renderToStaticMarkup(createElement(await load(file.contents, file.path)));
    const expected = renderPage(store.doc, store.registry, 'home').html.replace(/\n/g, '');
    expect(markup.replaceAll('&quot;', '"')).toBe(expected);
    expect(markup).toContain(
      '<strong>Bold</strong> <em>italic</em> and <a href="/x">link</a> <b>z</b>',
    );
  });

  it('JavaScript routes import the .jsx files; names never differ only in case', () => {
    const store = site([
      { op: 'page.create', path: '/a-b', title: 'A b' },
      { op: 'page.create', path: '/ab', title: 'Ab' },
    ]);
    const files = exportReact(store.doc, store.registry, { typescript: false });
    const pages = files.filter((f) => f.path.startsWith('pages/')).map((f) => f.path.toLowerCase());
    expect(new Set(pages).size).toBe(pages.length);
    const routes = files.find((f) => f.path === 'routes.js')!.contents;
    expect(routes).toContain("import Home from './pages/Home.jsx';");
    expect(routes).not.toContain(".js'");
  });

  it('exports every language, with translated titles and localized internal links', () => {
    const store = site([
      { op: 'page.create', id: 'pricing', path: '/pricing', title: 'Pricing' },
      { op: 'locale.set', add: ['de'] },
      {
        op: 'section.insert',
        section: 'hero',
        page: 'home',
        content: { primary: { href: '/pricing' } },
      },
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
      { op: 'page.update', id: 'home', locale: 'de', title: 'Startseite' },
    ]);
    const files = exportReact(store.doc, store.registry);
    const de = files.find((f) => f.path === 'pages/HomeDe.tsx')!.contents;
    expect(de).toContain('export const title = "Startseite";');
    expect(de).toContain('Hallo');
    expect(de).toContain('href="/de/pricing/"');
    const routes = files.find((f) => f.path === 'routes.ts')!.contents;
    expect(routes).toContain(
      '{ path: "/de/", locale: "de", title: "Startseite", Component: HomeDe }',
    );
  });
});

describe('static export', () => {
  it('refuses pages that would overwrite each other or the generated files', () => {
    const { doc, registry } = site();
    expect(() =>
      exportStaticSite(
        withPages(doc, [
          { id: 'a', path: '/about' },
          { id: 'b', path: '/about/' },
        ]),
        registry,
      ),
    ).toThrow(/page "a" \(\/about\) and page "b" \(\/about\/\) both write about\/index\.html/);
    expect(() =>
      exportStaticSite(withPages(doc, [{ id: 'css', path: '/styles.css' }]), registry),
    ).toThrow(/the stylesheet and page "css" .* need styles\.css as both a file and a folder/);
    expect(() =>
      exportStaticSite(withPages(doc, [{ id: 'map', path: '/sitemap.xml' }]), registry, {
        baseUrl: 'https://example.com',
      }),
    ).toThrow(/sitemap/);
    const localized = withPages(doc, [{ id: 'de-page', path: '/de' }]);
    localized.locales = { default: 'en', others: ['de'] };
    expect(() => exportStaticSite(localized, registry)).toThrow(/de\/index\.html/);
  });

  it('localizes titles, lang and internal links per language', () => {
    const store = site([
      { op: 'page.create', id: 'pricing', path: '/pricing', title: 'Pricing' },
      { op: 'locale.set', add: ['de'] },
      {
        op: 'section.insert',
        section: 'hero',
        page: 'home',
        content: { primary: { href: '/pricing#faq' } },
      },
      { op: 'page.update', id: 'home', locale: 'de', title: 'Startseite', description: 'Hallo' },
    ]);
    const files = exportStaticSite(store.doc, store.registry, { lang: 'fr' });
    const en = files.find((f) => f.path === 'index.html')!.contents;
    const de = files.find((f) => f.path === 'de/index.html')!.contents;
    expect(en).toContain('<html lang="en"');
    expect(en).toContain('<title>Home</title>');
    expect(en).toContain('href="/pricing#faq"');
    expect(de).toContain('<html lang="de"');
    expect(de).toContain('<title>Startseite</title>');
    expect(de).toContain('<meta name="description" content="Hallo">');
    expect(de).toContain('href="/de/pricing/#faq"');
    // Without declared languages, `lang` names the content's language.
    const plain = exportStaticSite(site().doc, store.registry, { lang: 'fr' });
    expect(plain.find((f) => f.path === 'index.html')!.contents).toContain('<html lang="fr"');
  });
});
