import { createDefaultRegistry, createStarterDoc, SECTIONS } from '@bowerbirdjs/blocks';
import {
  createRegistry,
  defineComponent,
  defineData,
  defineSection,
  type SiteDoc,
  t,
} from '@bowerbirdjs/core';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  buildSectionThumbs,
  categoryLabel,
  groupSections,
  matchesQuery,
} from '../src/thumbnails.js';

describe('section previews', () => {
  test('every starter section gets its published markup and one scoped stylesheet', () => {
    const registry = createDefaultRegistry();
    const { html, css } = buildSectionThumbs(registry, createStarterDoc(), SECTIONS, '.bb-thumbs');
    expect([...html.keys()]).toEqual(SECTIONS.map((s) => s.name));
    const hero = html.get('hero')!;
    expect(hero).toContain('<div class="bb-page">');
    expect(hero).toContain('<h1 class="bb-hero__heading">');
    // As published: no editor marks, no node ids to mistake for the page's, accordions closed.
    for (const markup of html.values()) {
      expect(markup).not.toContain('data-bb-edit');
      expect(markup).not.toContain('data-bb-section');
      expect(markup).not.toContain('data-bb-node');
    }
    expect(html.get('faq')).toContain('<details class="bb-faq__item"><summary');
    // Tokens sit on the scope, and every rule is nested under it.
    expect(css.startsWith('.bb-thumbs {\n  --color-brand-50')).toBe(true);
    expect(css).toContain('.bb-thumbs[data-theme="dark"], .bb-thumbs [data-theme="dark"]');
    expect(css).toContain('.bb-pricing__tier');
    expect(css).not.toContain(':root');
    expect(css).not.toContain('@layer');
  });

  test('shows the site as it is: its tokens, breakpoints and data', () => {
    const doc: SiteDoc = {
      ...createStarterDoc(),
      data: { event: { title: 'Ada & Grace' } },
    };
    (doc.tokens.color as Record<string, Record<string, unknown>>).accent = { $value: '#0f766e' };
    const registry = createRegistry({
      data: [
        defineData({ key: 'event', title: 'Event', description: 'The event.', schema: z.any() }),
      ],
      components: [
        defineComponent({
          name: 'event-title',
          kind: 'primitive',
          description: 'The event title.',
          props: z.strictObject({}),
          children: false,
          insertable: false,
          render: (_node, ctx) => ({
            tag: 'h2',
            text: (ctx.data('event') as { title?: string } | undefined)?.title ?? 'No title',
          }),
        }),
      ],
      sections: [
        defineSection({
          name: 'intro',
          version: 1,
          title: 'Intro',
          description: 'Shows the event title.',
          template: () =>
            t.box({ tag: 'section', css: 'padding: var(--space-lg)' }, [
              t.component('event-title', { part: 'title' }),
            ]),
        }),
      ],
    });
    const { html, css } = buildSectionThumbs(registry, doc, registry.listSections(), '.x');
    expect(html.get('intro')).toContain('<h2 class="bb-intro__title">Ada &amp; Grace</h2>');
    // A styled node keeps an id of the preview's own (never one of the page's).
    expect(html.get('intro')).toContain('data-bb-node="thumb-1-section"');
    expect(css).toContain('[data-bb-node="thumb-1-section"]');
    expect(css).toContain('--color-accent: #0f766e;');
  });

  test('a section that cannot be built is left out; the others still get theirs', () => {
    const broken = defineSection({
      name: 'broken',
      version: 1,
      title: 'Broken',
      description: 'Throws.',
      template: () => {
        throw new Error('nope');
      },
    });
    const fine = defineSection({
      name: 'fine',
      version: 1,
      title: 'Fine',
      description: 'Works.',
      template: () => t.box({ tag: 'section' }, [t.text({ part: 'text', text: 'Hello' })]),
    });
    const registry = createRegistry({ sections: [broken, fine] });
    const { html } = buildSectionThumbs(registry, createStarterDoc(), [broken, fine], '.x');
    expect([...html.keys()]).toEqual(['fine']);
    expect(buildSectionThumbs(registry, createStarterDoc(), [], '.x')).toEqual({
      css: '',
      html: new Map(),
    });
  });
});

describe('the catalog in the Insert tab', () => {
  test('sections are grouped by category, in the order categories first appear', () => {
    const groups = groupSections(SECTIONS);
    expect(groups.map(([label, list]) => [label, list.map((s) => s.name)])).toEqual([
      ['Navigation', ['banner', 'nav', 'footer']],
      ['Headers', ['hero', 'page-header']],
      ['Social proof', ['logos', 'testimonials']],
      ['Content', ['features', 'split', 'steps', 'stats', 'cards', 'schedule', 'faq', 'content']],
      ['Media and people', ['gallery', 'team']],
      ['Pricing', ['pricing']],
      ['Forms and calls to action', ['newsletter', 'contact', 'cta']],
    ]);
    // A host's own categories are shown in words; none is "Other".
    expect(categoryLabel('case-studies')).toBe('Case studies');
    expect(categoryLabel('event_facts')).toBe('Event facts');
    expect(categoryLabel(undefined)).toBe('Other');
    expect(categoryLabel('constructor')).toBe('Constructor');
  });

  test('search matches every word, anywhere in what a section says about itself', () => {
    const found = (query: string) =>
      SECTIONS.filter((s) => matchesQuery(query, s.name, s.title, s.category, s.description)).map(
        (s) => s.name,
      );
    expect(found('')).toHaveLength(SECTIONS.length);
    expect(found('form')).toEqual(['newsletter', 'contact']);
    expect(found('FAQ')).toEqual(['faq']);
    expect(found('accordion question')).toEqual(['faq']);
    expect(found('image heading')).toEqual(expect.arrayContaining(['split', 'gallery', 'cards']));
    expect(found('zzz')).toEqual([]);
  });
});
