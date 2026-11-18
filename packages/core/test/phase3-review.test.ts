import {
  createPolicy,
  lintPage,
  outline,
  type Store,
  samePagePath,
  sanitizeRichText,
  untranslatedProps,
} from '@bowerbirdjs/core';
import { renderDocument, renderPage } from '@bowerbirdjs/html';
import { beforeEach, describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

const ok = (store: Store, ops: unknown[], actor: typeof agent | typeof human = human) => {
  const res = store.apply({ ops, actor });
  if (!res.ok) throw new Error(res.errors.map((e) => e.message).join('\n'));
  return res;
};
const fails = (store: Store, ops: unknown[], actor: typeof agent | typeof human = human) => {
  const res = store.apply({ ops, actor });
  expect(res.ok).toBe(false);
  return res.ok ? [] : res.errors;
};
const rules = (store: Store, page = 'home') =>
  lintPage(store.view, store.registry, page).map((i) => `${i.rule} ${i.nodeId ?? ''}`.trim());

describe('page titles and paths', () => {
  it('refuses line breaks and control characters in titles and descriptions', () => {
    const store = makeStore();
    for (const title of ['Evil\nglobalThis.pwned = 1; //', 'a\rb', 'a b', 'a b']) {
      const errors = fails(store, [{ op: 'page.create', path: '/x', title }]);
      expect(errors[0]?.message).toMatch(/one line of text/);
    }
    fails(store, [{ op: 'page.update', id: 'home', description: 'one\ntwo' }]);
    ok(store, [{ op: 'page.update', id: 'home', title: 'Home – “quoted” & fine' }]);
  });

  it('treats /about and /about/ as the same page path', () => {
    const store = makeStore();
    ok(store, [{ op: 'page.create', path: '/about', title: 'About' }]);
    const errors = fails(store, [{ op: 'page.create', path: '/about/', title: 'About 2' }]);
    expect(errors[0]?.message).toMatch(
      /"about" already uses "\/about", the same URL as "\/about\/"/,
    );
    ok(store, [{ op: 'page.create', id: 'team', path: '/team', title: 'Team' }]);
    fails(store, [{ op: 'page.update', id: 'team', path: '/about/' }]);
    expect(samePagePath('/', '/')).toBe(true);
    expect(samePagePath('/a/b/', '/a/b')).toBe(true);
  });

  it('keeps page paths and language paths apart, both ways', () => {
    const store = makeStore();
    ok(store, [{ op: 'locale.set', add: ['de'] }]);
    const errors = fails(store, [{ op: 'page.create', path: '/de/impressum', title: 'Impressum' }]);
    expect(errors[0]?.message).toMatch(/where the "de" translation of the site is published/);
    ok(store, [{ op: 'page.create', id: 'fr-page', path: '/fr', title: 'France' }]);
    const clash = fails(store, [{ op: 'locale.set', add: ['fr'] }]);
    expect(clash[0]?.message).toMatch(/Page "fr-page" \(\/fr\) uses the path of language "fr"/);
  });
});

describe('languages', () => {
  let store: Store;
  beforeEach(() => {
    store = makeStore();
    ok(store, [{ op: 'section.insert', section: 'hero' }]);
  });

  it('locks protect translations from locale.set remove', () => {
    ok(store, [
      { op: 'locale.set', add: ['de', 'fr'] },
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
    ]);
    store.setPolicy(createPolicy({ lockedNodes: ['hero-1'] }));
    const direct = store.apply({
      actor: agent,
      ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: null } }],
    });
    expect(direct.ok).toBe(false);
    const removed = store.apply({ actor: agent, ops: [{ op: 'locale.set', remove: ['de'] }] });
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.errors[0]?.message).toMatch(/"hero-1\/heading" is locked/);
    expect(store.view.node('hero-1/heading')?.l10n).toEqual({ de: { text: 'Hallo' } });
    // Removing a language nothing locked is translated into still works.
    ok(store, [{ op: 'locale.set', remove: ['fr'] }], agent);
  });

  it('keeps a declared default language when the last other language goes', () => {
    ok(store, [{ op: 'locale.set', default: 'de', add: ['en'] }]);
    ok(store, [{ op: 'locale.set', remove: ['en'] }]);
    expect(store.doc.locales).toEqual({ default: 'de', others: [] });
    expect(renderDocument(store.doc, store.registry, 'home')).toContain('<html lang="de"');
  });

  it('treats "en" as the implicit default, and refuses adding only the default', () => {
    // On a site without languages, locale "en" is the default content itself.
    ok(store, [{ op: 'props.set', id: 'hero-1/heading', locale: 'en', props: { text: 'Hi' } }]);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Hi');
    expect(store.view.node('hero-1/heading')?.l10n).toBeUndefined();
    const added = fails(store, [{ op: 'locale.set', add: ['en'] }]);
    expect(added[0]?.message).toMatch(/already the default language/);
    expect(added[0]?.hint).toContain('"default":"<content language>"');
    const unknown = fails(store, [
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
    ]);
    expect(unknown[0]?.hint).toContain(
      '{"op":"locale.set","default":"<language of the current content>","add":["de"]}',
    );
  });

  it('outline validates the language and marks every untranslated content prop', () => {
    ok(store, [
      { op: 'locale.set', add: ['de'] },
      {
        op: 'node.insert',
        parent: 'hero-1',
        node: { type: 'image', props: { src: '/a.png', alt: 'A cat' } },
      },
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
    ]);
    expect(outline(store.view, { locale: 'xx' })).toMatch(/^The site has no language "xx"/);
    const def = outline(store.view, { locale: 'en' });
    expect(def).toMatch(/^"en" is the default language/);
    expect(def).not.toContain('untranslated');
    const de = outline(store.view, { locale: 'de', registry: store.registry });
    expect(de).toMatch(/hero-1\/image-1 .*\[untranslated de\]/);
    expect(de).not.toMatch(/hero-1\/heading .*untranslated/);
    // Lint and outline agree on what's missing.
    const node = store.view.node('hero-1/image-1')!;
    expect(untranslatedProps(node, ['src', 'alt'], 'de')).toEqual(['alt']);
    const missing = lintPage(store.view, store.registry, 'home').find(
      (i) => i.rule === 'missing-translation',
    );
    expect(missing?.message).toContain('hero-1/image-1');
  });

  it('undoing a language removal after later language changes brings the language back', () => {
    ok(store, [
      { op: 'locale.set', add: ['de'] },
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } },
    ]);
    ok(store, [{ op: 'locale.set', remove: ['de'] }], human);
    ok(store, [{ op: 'locale.set', add: ['fr'] }], agent);
    const undo = store.undo({ actorId: human.id, actor: human });
    expect(undo.ok).toBe(true);
    expect(store.doc.locales).toEqual({ default: 'en', others: ['de', 'fr'] });
    expect(store.view.node('hero-1/heading')?.l10n).toEqual({ de: { text: 'Hallo' } });
    expect(outline(store.view, { locale: 'de' })).toContain('"Hallo"');
  });

  it('undoing an added language keeps it when there is content in it now', () => {
    ok(store, [{ op: 'locale.set', add: ['de'] }], human);
    ok(
      store,
      [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } }],
      agent,
    );
    const undo = store.undo({ actorId: human.id, actor: human });
    expect(undo.ok && undo.warnings.map((w) => w.message)).toContain(
      'Kept language "de": it has translations now.',
    );
    expect(store.doc.locales?.others).toEqual(['de']);
  });

  it('translates page titles and descriptions', () => {
    ok(store, [
      { op: 'locale.set', add: ['de'] },
      { op: 'page.update', id: 'home', description: 'Plan together' },
      {
        op: 'page.update',
        id: 'home',
        locale: 'de',
        title: 'Startseite',
        description: 'Gemeinsam planen',
      },
    ]);
    const de = renderDocument(store.doc, store.registry, 'home', { locale: 'de' });
    expect(de).toContain('<title>Startseite</title>');
    expect(de).toContain('content="Gemeinsam planen"');
    expect(renderDocument(store.doc, store.registry, 'home')).toContain('<title>Home</title>');
    expect(outline(store.view, { locale: 'de' })).toContain('title="Startseite"');
    fails(store, [{ op: 'page.update', id: 'home', locale: 'de', path: '/start' }]);
    // An empty string removes the translation; removing the language removes the rest.
    ok(store, [{ op: 'page.update', id: 'home', locale: 'de', title: '' }]);
    expect(store.doc.pages.home?.l10n).toEqual({ de: { description: 'Gemeinsam planen' } });
    ok(store, [{ op: 'locale.set', remove: ['de'] }]);
    expect(store.doc.pages.home?.l10n).toBeUndefined();
  });
});

describe('linked components with their own text', () => {
  it('an instance that overrides text stops showing the definition’s translation of it', () => {
    const store = makeStore();
    ok(store, [
      { op: 'section.insert', section: 'hero' },
      { op: 'locale.set', add: ['de'] },
      { op: 'symbol.create', id: 'hero-1', name: 'Hero' },
      { op: 'symbol.insert', symbol: 'hero' },
      { op: 'props.set', id: 'symbol-hero/heading', locale: 'de', props: { text: 'Willkommen' } },
    ]);
    expect(store.view.node('hero-2/heading')?.l10n).toEqual({ de: { text: 'Willkommen' } });
    ok(store, [{ op: 'props.set', id: 'hero-2/heading', props: { text: 'Pricing for teams' } }]);
    const html = renderPage(store.doc, store.registry, 'home', { locale: 'de' }).html;
    expect(html).toContain('Pricing for teams');
    expect(html.match(/Willkommen/g)).toHaveLength(1);
    expect(outline(store.view, { locale: 'de' })).toMatch(/hero-2\/heading .*untranslated de/);
    expect(
      lintPage(store.view, store.registry, 'home').find((i) => i.rule === 'missing-translation')
        ?.message,
    ).toContain('hero-2/heading');
    // Later translations of the definition don't reach the overridden instance either…
    ok(store, [
      { op: 'props.set', id: 'symbol-hero/heading', locale: 'de', props: { text: 'Hallo' } },
    ]);
    expect(store.view.node('hero-2/heading')?.l10n).toBeUndefined();
    expect(store.view.node('hero-1/heading')?.l10n).toEqual({ de: { text: 'Hallo' } });
    // …but its own translation is kept.
    ok(store, [
      { op: 'props.set', id: 'hero-2/heading', locale: 'de', props: { text: 'Preise für Teams' } },
      { op: 'props.set', id: 'symbol-hero/heading', locale: 'de', props: { text: 'Servus' } },
    ]);
    expect(store.view.node('hero-2/heading')?.l10n).toEqual({ de: { text: 'Preise für Teams' } });
  });
});

describe('lint with rich text and translations', () => {
  it('rich-text headings and link text count; translated URLs are checked', () => {
    const store = makeStore();
    ok(store, [
      { op: 'locale.set', add: ['de'] },
      {
        op: 'node.insert',
        parent: 'root-home',
        node: { type: 'rich-text', props: { tag: 'h1', html: 'Big <em>news</em>' } },
      },
      {
        op: 'node.insert',
        parent: 'root-home',
        node: {
          type: 'link',
          id: 'more',
          props: { href: '/more' },
          children: [{ type: 'rich-text', props: { html: 'Read more' } }],
        },
      },
      { op: 'props.set', id: 'more', locale: 'de', props: { href: 'javascript:alert(1)' } },
    ]);
    const found = rules(store);
    expect(found).not.toContain('single-h1');
    expect(found).not.toContain('link-name more');
    expect(found).toContain('unsafe-url more');
  });
});

describe('rich text sanitizing', () => {
  it.each([
    // Block boundaries become line breaks (pasted paragraphs and lists).
    [
      'Para one<p>First pasted para</p><p>Second para</p><ul><li>item one</li><li>item two</li></ul>',
      'Para one<br>First pasted para<br>Second para<br>item one<br>item two',
    ],
    ['<p>a</p>\n  <p>b</p>', 'a<br>b'],
    ['<div><strong>x</strong></div><div>y</div>', '<strong>x</strong><br>y'],
    // href comes from the href attribute, not from text inside other attributes.
    ['<a title="href=/safe" href="javascript:alert(1)">x</a>', '<a href="#">x</a>'],
    ['<a data-href="/ok" href="/real">x</a>', '<a href="/real">x</a>'],
    ['<a href="/first" href="/second">x</a>', '<a href="/first">x</a>'],
    ['<a href=/unquoted>x</a>', '<a href="/unquoted">x</a>'],
    // A tag that never ends stays text.
    ['ok <a href="/x', 'ok &lt;a href="/x'],
  ])('%s', (input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected);
  });

  it('is linear: hostile input sanitizes fast', () => {
    const inputs = [
      `<${'a'.repeat(19_999)}`,
      '<a x="'.repeat(4000),
      '<'.repeat(20_000),
      '<b '.repeat(7000),
    ];
    const start = performance.now();
    for (const input of inputs) sanitizeRichText(input);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it('checks the size after sanitizing, so stored values stay valid', () => {
    const store = makeStore();
    ok(store, [
      {
        op: 'node.insert',
        parent: 'root-home',
        node: { type: 'rich-text', id: 'rd', props: { html: 'R&D '.repeat(4000) } },
      },
    ]);
    // Later edits re-validate the stored (escaped) value.
    ok(store, [{ op: 'props.set', id: 'rd', props: { tag: 'h2' } }]);
    const errors = fails(store, [
      {
        op: 'node.insert',
        parent: 'root-home',
        node: { type: 'rich-text', props: { html: '&'.repeat(20_000) } },
      },
    ]);
    expect(errors[0]?.message).toMatch(/at most 40000 characters/);
  });

  it('rich text inside a link renders without links of its own', () => {
    const store = makeStore();
    ok(store, [
      {
        op: 'node.insert',
        parent: 'root-home',
        node: {
          type: 'link',
          props: { href: '/outer' },
          children: [
            { type: 'rich-text', props: { html: 'see <a href="/inner">this</a> <em>now</em>' } },
          ],
        },
      },
    ]);
    const html = renderPage(store.doc, store.registry, 'home').html;
    expect(html).toContain('<p>see this <em>now</em></p>');
    expect(html).not.toContain('/inner');
  });
});
