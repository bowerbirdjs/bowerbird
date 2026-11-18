import {
  createPolicy,
  lintPage,
  outline,
  richTextToPlain,
  type Store,
  sanitizeRichText,
} from '@bowerbirdjs/core';
import { renderDocument, renderPage } from '@bowerbirdjs/html';
import { beforeEach, describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

describe('sanitizeRichText', () => {
  it.each([
    ['Plain & <b>bold</b>', 'Plain &amp; <b>bold</b>'],
    ['<strong>a <em>b</strong> c', '<strong>a <em>b</em></strong> c'],
    ['<script>alert(1)</script>', 'alert(1)'],
    ['<a href="javascript:alert(1)" onclick="x()">x</a>', '<a href="#">x</a>'],
    ["<a href='/docs?a=1&amp;b=2' class=x>docs</a>", '<a href="/docs?a=1&amp;b=2">docs</a>'],
    ['<a href="/a"><a href="/b">nested</a></a>', '<a href="/a">nested</a>'],
    ['line<br/>break', 'line<br>break'],
    ['<img src=x onerror=alert(1)>', ''],
    ['</em>stray close', 'stray close'],
    ['5 < 6 && 7 > 3', '5 &lt; 6 &amp;&amp; 7 &gt; 3'],
    ['<em attr="<b>">x</em>', '&lt;em attr="<b>"&gt;x</b>'],
  ])('%s', (input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected);
  });

  it('extracts plain text', () => {
    expect(richTextToPlain('a <strong>b</strong><br>c &amp; d')).toBe('a b\nc & d');
  });
});

describe('rich-text nodes', () => {
  it('sanitizes on write and again on render', () => {
    const store = makeStore();
    const root = store.doc.pages.home!.rootId;
    const res = store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: root,
          node: {
            type: 'rich-text',
            props: { html: 'Hi <strong>there</strong><script>x</script>' },
          },
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(store.view.node('rich-text-1')?.props.html).toBe('Hi <strong>there</strong>x');
    // A stored document that skipped validation still renders safely.
    const doc = structuredClone(store.doc);
    doc.nodes['rich-text-1']!.props.html = '<img src=x onerror=alert(1)><em>ok</em>';
    expect(renderPage(doc, store.registry, 'home').html).toContain('<p><em>ok</em></p>');
    expect(outline(store.view)).toContain('rich-text-1  rich-text<p>  "Hi therex"');
  });
});

describe('localized content', () => {
  let store: Store;
  beforeEach(() => {
    store = makeStore();
    store.apply({
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'locale.set', default: 'en', add: ['de', 'fr'] },
      ],
    });
  });

  it('stores translations per content prop and renders them with fallback', () => {
    const res = store.apply({
      ops: [
        {
          op: 'props.set',
          id: 'hero-1/heading',
          locale: 'de',
          props: { text: 'Deine Überschrift' },
        },
        {
          op: 'text.edit',
          id: 'hero-1/subheading',
          locale: 'de',
          find: 'Supporting',
          replace: 'Unterstützender',
        },
      ],
    });
    expect(res.ok).toBe(true);
    const heading = store.view.node('hero-1/heading')!;
    expect(heading.props.text).toBe('Your headline');
    expect(heading.l10n).toEqual({ de: { text: 'Deine Überschrift' } });
    const de = renderDocument(store.doc, store.registry, 'home', { locale: 'de' });
    expect(de).toContain('<html lang="de"');
    expect(de).toContain('Deine Überschrift');
    expect(de).toContain('Unterstützender copy');
    // French has no translations: the default content is used.
    expect(renderPage(store.doc, store.registry, 'home', { locale: 'fr' }).html).toContain(
      'Your headline',
    );
    expect(outline(store.view, { locale: 'de' })).toContain('"Deine Überschrift"');
    expect(outline(store.view, { locale: 'fr' })).toContain('[untranslated fr]');
  });

  it('refuses unknown locales and non-content props, with hints', () => {
    const unknown = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'es', props: { text: 'x' } }],
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]).toMatchObject({ code: 'unknown_locale' });
    const tag = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { tag: 'h2' } }],
    });
    expect(tag.ok).toBe(false);
    if (!tag.ok) expect(tag.errors[0]?.hint).toMatch(/Translatable props of text: text/);
  });

  it('lints missing translations, and removing a language drops its translations (undoably)', () => {
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } }],
    });
    const issues = lintPage(store.view, store.registry, 'home').filter(
      (i) => i.rule === 'missing-translation',
    );
    expect(issues.map((i) => i.message)).toEqual([
      expect.stringMatching(/^2 texts have no "de" translation: hero-1\/subheading, hero-1\/cta/),
      expect.stringMatching(/^3 texts have no "fr" translation/),
    ]);
    store.apply({ ops: [{ op: 'locale.set', remove: ['de'] }] });
    expect(store.view.node('hero-1/heading')?.l10n).toBeUndefined();
    expect(store.doc.locales).toEqual({ default: 'en', others: ['fr'] });
    store.undo();
    expect(store.view.node('hero-1/heading')?.l10n).toEqual({ de: { text: 'Hallo' } });
    expect(store.doc.locales?.others).toEqual(['de', 'fr']);
  });

  it('translations are content-level and protected like other edits', () => {
    store.setPolicy(createPolicy({ levels: { user: 'content' }, protectHumanEdits: 'confirm' }));
    expect(
      store.apply({
        ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo' } }],
        actor: human,
      }).ok,
    ).toBe(true);
    const res = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Agent' } }],
      actor: agent,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.message).toContain('l10n.de.text');
  });

  it('translations follow linked component definitions', () => {
    store.apply({
      ops: [
        { op: 'symbol.create', id: 'hero-1', name: 'Hero' },
        { op: 'symbol.insert', symbol: 'hero' },
        { op: 'props.set', id: 'symbol-hero/heading', locale: 'de', props: { text: 'Geteilt' } },
      ],
    });
    expect(store.view.node('hero-2/heading')?.l10n).toEqual({ de: { text: 'Geteilt' } });
    expect(store.view.node('hero-1/heading')?.l10n).toEqual({ de: { text: 'Geteilt' } });
  });
});
