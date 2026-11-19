import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  createEmptyDoc,
  createRegistry,
  createStore,
  defineComponent,
  type Store,
} from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { renderDocument, renderPage, sanitizeUrl } from '@bowerbirdjs/html';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function site(): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home & <friends>' },
      { op: 'section.insert', section: 'hero', variant: { layout: 'split' } },
      { op: 'style.set', id: 'hero-1/heading', css: 'color: var(--color-accent)' },
      { op: 'style.set', id: 'hero-1/heading', bp: 'lg', css: 'font-size: var(--text-5xl)' },
      {
        op: 'style.set',
        id: 'hero-1/primary',
        state: 'hover',
        css: 'background: var(--color-brand-700)',
      },
      { op: 'vars.set', id: 'hero-1', vars: { '--hero-bg': 'var(--color-surface-muted)' } },
    ],
  });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return store;
}

describe('renderPage', () => {
  it('renders semantic HTML with section and part classes', () => {
    const store = site();
    const { html } = renderPage(store.doc, store.registry, 'home');
    expect(html).toContain('<div class="bb-page">');
    expect(html).toContain('<section class="bb-hero bb-hero--layout-split" data-bb-node="hero-1">');
    expect(html).toContain('<h1 class="bb-hero__heading" data-bb-node="hero-1/heading">');
    expect(html).toMatch(
      /<img class="bb-hero__media" src="data:image\/svg\+xml,[^"]+" alt="Product screenshot"/,
    );
    // unstyled nodes carry no data attribute in published output
    expect(html).toContain('<p class="bb-hero__eyebrow">New release</p>');
  });

  it('marks every node in editor mode', () => {
    const store = site();
    const { html } = renderPage(store.doc, store.registry, 'home', { mode: 'editor' });
    expect(html).toContain('data-bb-node="hero-1/eyebrow"');
    expect(html).toContain('data-bb-section="hero"');
  });

  it('escapes text and attributes', () => {
    const store = site();
    store.apply({
      ops: [
        { op: 'props.set', id: 'hero-1/heading', props: { text: '<script>alert(1)</script>' } },
        { op: 'props.set', id: 'hero-1/primary', props: { text: 'Go', href: '/a?b="c"' } },
      ],
    });
    const { html } = renderPage(store.doc, store.registry, 'home');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('href="/a?b=&quot;c&quot;"');
    expect(renderDocument(store.doc, store.registry, 'home')).toContain(
      '<title>Home &amp; &lt;friends&gt;</title>',
    );
  });

  it('neutralises dangerous URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('java\tscript:alert(1)')).toBe('#');
    expect(sanitizeUrl(' JAVASCRIPT:alert(1)')).toBe('#');
    expect(sanitizeUrl('data:text/html,<b>x</b>', 'src')).toBe('');
    expect(sanitizeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeUrl('/pricing#faq')).toBe('/pricing#faq');
    expect(sanitizeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    const store = site();
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/primary', props: { href: 'javascript:alert(1)' } }],
    });
    expect(renderPage(store.doc, store.registry, 'home').html).toContain(
      '<a class="bb-hero__primary" href="#"',
    );
  });
});

describe('compileCss', () => {
  it('emits layered CSS with tokens, section defaults and container queries', () => {
    const store = site();
    const css = compileCss(store.doc, store.registry, { page: 'home' });
    expect(css).toContain('@layer bb.tokens, bb.base, bb.sections, bb.nodes;');
    expect(css).toContain('--color-accent: var(--color-brand-600);');
    expect(css).toContain('--space-lg: 1.5rem;');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('.bb-hero {\n    --hero-bg: var(--color-surface);');
    expect(css).toContain('[data-bb-node="hero-1"] {\n    --hero-bg: var(--color-surface-muted);');
    expect(css).toContain('[data-bb-node="hero-1/primary"]:hover');
    expect(css).toMatch(
      /@container bb-page \(min-width: 1024px\) \{\n\s+\[data-bb-node="hero-1\/heading"\] \{\n\s+font-size: var\(--text-5xl\);/,
    );
    // sections not on the page are not included
    expect(css).not.toContain('.bb-pricing');
  });

  it('scopes everything to the canvas in editor mode, without layers', () => {
    const store = site();
    const css = compileCss(store.doc, store.registry, { mode: 'editor', page: 'home' });
    expect(css).not.toContain('@layer');
    expect(css).toMatch(/^\[data-bb-canvas\] \{\n {2}--color-brand-50:/);
    // The host-CSS reset comes first so base, section and node rules (same specificity) win.
    expect(css).toContain('[data-bb-canvas] {\n  .bb-page { all: initial; display: block; }');
    expect(css.indexOf('all: revert')).toBeLessThan(css.indexOf('container: bb-page'));
    expect(css.indexOf('all: initial')).toBeLessThan(css.indexOf('container: bb-page'));
    expect(compileCss(store.doc, store.registry)).not.toContain('all: revert');
  });
});

describe('code components', () => {
  it('are marked with data-bb-code in editor mode so host styles keep applying', () => {
    const registry = createRegistry({
      components: [
        defineComponent({
          name: 'ticket-badge',
          kind: 'code',
          tag: 'acme-ticket-badge',
          description: 'Badge',
          children: false,
          props: z.object({ label: z.string().optional() }),
        }),
      ],
    });
    const store = createStore({ registry, doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: { type: 'ticket-badge', props: { label: 'VIP' } },
        },
      ],
    });
    const editor = renderPage(store.doc, registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain(
      '<acme-ticket-badge label="VIP" data-bb-node="ticket-badge-1" data-bb-code="ticket-badge">',
    );
    expect(renderPage(store.doc, registry, 'home').html).not.toContain('data-bb-code');
  });

  it('props named like global attributes never reach the element itself', () => {
    const registry = createRegistry({
      components: [
        defineComponent({
          name: 'promo-card',
          kind: 'code',
          tag: 'acme-promo',
          description: 'Promo',
          children: false,
          props: z.looseObject({}),
        }),
      ],
    });
    const store = createStore({ registry, doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: {
            type: 'promo-card',
            props: { hidden: true, id: 'x', tabIndex: 3, ariaLabel: 'no', heading: 'Hi' },
          },
        },
      ],
    });
    for (const mode of ['editor', 'published'] as const) {
      const html = renderPage(store.doc, registry, 'home', { mode }).html;
      expect(html).toContain('heading="Hi"');
      expect(html).not.toMatch(/ hidden| id="x"| tabindex| aria-label/);
    }
  });

  it('a prop marked as editable carries its field, but no data path, and only in the editor', () => {
    const registry = createRegistry({
      components: [
        defineComponent({
          name: 'quote-card',
          kind: 'primitive',
          description: 'Quote',
          children: false,
          props: z.object({ quote: z.string() }),
          render: (node) => ({
            tag: 'blockquote',
            text: String(node.props.quote),
            edit: { prop: 'quote', label: 'Quote', kind: 'multiline' },
          }),
        }),
      ],
    });
    const store = createStore({ registry, doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: { type: 'quote-card', props: { quote: 'Hi' } },
        },
      ],
    });
    const editor = renderPage(store.doc, registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain(
      `data-bb-edit="${JSON.stringify([{ prop: 'quote', label: 'Quote', kind: 'multiline' }]).replace(/"/g, '&quot;')}"`,
    );
    expect(editor).not.toContain('data-bb-data');
    expect(renderPage(store.doc, registry, 'home').html).not.toContain('data-bb-edit');
  });
});

describe('standalone documents', () => {
  it('the page background fills the window, so a short dark page has no white band', () => {
    const html = renderDocument(site().doc, createDefaultRegistry(), 'home', { theme: 'dark' });
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('<body style="margin:0;background:var(--color-surface,Canvas)">');
  });
});

describe('host frame and host-drawn children (editor)', () => {
  const setup = () => {
    const registry = createRegistry({
      components: [
        defineComponent({
          name: 'card',
          kind: 'code',
          tag: 'acme-card',
          description: 'Card',
          children: { allow: ['text'] },
          props: z.object({}),
        }),
      ],
    });
    const store = createStore({ registry, doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: {
            type: 'card',
            id: 'card-1',
            children: [{ type: 'text', props: { text: 'Inside' } }],
          },
        },
      ],
    });
    return { store, registry };
  };

  it('wraps the content in a frame with the host attributes, in the editor only', () => {
    const { store, registry } = setup();
    const html = renderPage(store.doc, registry, 'home', {
      mode: 'editor',
      frame: { 'data-site': '', style: '--brand: #c00', onclick: 'alert(1)', lang: 'de' },
    }).html;
    expect(html).toMatch(
      /<div class="bb-page"[^>]*>\n<div data-bb-frame data-site="" style="--brand: #c00" lang="de">/,
    );
    expect(html).not.toContain('onclick');
    const published = renderPage(store.doc, registry, 'home', { frame: { 'data-site': '' } }).html;
    expect(published).not.toContain('data-bb-frame');
  });

  it('leaves a code component’s children to the host when asked', () => {
    const { store, registry } = setup();
    const drawn = renderPage(store.doc, registry, 'home', {
      mode: 'editor',
      hostChildren: true,
    }).html;
    expect(drawn).toContain('data-bb-node="card-1"');
    expect(drawn).not.toContain('Inside');
    expect(renderPage(store.doc, registry, 'home', { mode: 'editor' }).html).toContain('Inside');
  });
});
