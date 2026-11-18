import { createStore } from '@bowerbirdjs/core';
import { renderPage } from '@bowerbirdjs/html';
import { describe, expect, it } from 'vitest';
import { BLOCKS, createBlocks } from '../src/site/blocks.js';
import { daysUntil, monogram } from '../src/site/copy.js';
import { contrast, DESIGNS, readableAccent, styleOps } from '../src/site/designs.js';
import {
  createEventSite,
  DEMO,
  eventRegistry,
  renderSite,
  starterFactOps,
} from '../src/site/site.js';

describe('event site', () => {
  it('builds the demo site through ops and renders every section', () => {
    const store = createEventSite(DEMO.de);
    expect(store.history).toEqual([]);
    const { html, css } = renderPage(store.doc, store.registry, 'home');
    expect(html).toContain('Lena &amp; Jonas');
    expect(html).toContain('L &amp; J');
    expect(html).toContain('12. Juni 2027');
    expect(html).toContain('14:00 Uhr');
    expect(html).toContain('Gut Lindenhof');
    expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=');
    expect(html).toContain('style="--swatch: #c9a27e"');
    expect(html).toContain('Dürfen Kinder mitkommen?');
    expect(css).toContain('--color-surface: #faf7f2');
    expect(html).not.toContain('data-bb-data');
  });

  it('every block inserts, renders in both languages, and has starter content', () => {
    for (const locale of ['de', 'en'] as const) {
      const store = createEventSite(DEMO[locale]);
      const blocks = createBlocks(locale);
      expect(blocks.map((b) => b.name)).toEqual(BLOCKS.map((b) => b.type));
      for (const block of BLOCKS) {
        const result = store.apply({
          ops: [{ op: 'section.insert', section: block.type, page: 'home' }],
        });
        expect(result.ok, `${block.type}: ${!result.ok && result.errors[0]?.message}`).toBe(true);
        // Every layout and background renders.
        const root = result.ok ? result.summary.created.find((id) => !id.includes('/')) : undefined;
        for (const layout of block.layouts) {
          const r = store.apply({
            ops: [{ op: 'section.variant', id: root, variant: { layout, background: 'inverse' } }],
          });
          expect(r.ok, `${block.type} ${layout}`).toBe(true);
        }
      }
      const html = renderPage(store.doc, store.registry, 'home').html;
      for (const block of BLOCKS) expect(html).toContain(`bb-${block.type}`);
    }
  });

  it('a fact change reaches every section that shows it', () => {
    const store = createEventSite(DEMO.de);
    store.apply({ ops: [{ op: 'section.insert', section: 'schedule', page: 'home' }] });
    store.apply({ ops: [{ op: 'data.set', key: 'schedule', path: [0, 'time'], value: '14:30' }] });
    const html = renderPage(store.doc, store.registry, 'home').html;
    expect(html.match(/14:30 Uhr/g)).toHaveLength(2);
    expect(html).not.toContain('14:00 Uhr');
  });

  it('bad facts are refused with the field that is wrong', () => {
    const store = createEventSite(DEMO.de);
    const result = store.apply({
      ops: [
        {
          op: 'data.set',
          key: 'gifts',
          path: ['links', 0, 'url'],
          value: 'http://insecure.example',
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors[0]?.message).toMatch(/gifts\.links\.0\.url must be an https/);
  });

  it('empty bound sections are hidden on the published page and explained in the editor', () => {
    const store = createEventSite(DEMO.de);
    store.apply({ ops: [{ op: 'data.set', key: 'faq', value: null }] });
    const published = renderPage(store.doc, store.registry, 'home').html;
    expect(published).toMatch(/<section class="bb-faq[^"]*" id="faq-1" hidden>/);
    const editor = renderPage(store.doc, store.registry, 'home', { mode: 'editor' }).html;
    expect(editor).toContain('data-empty="true"');
    expect(editor).toContain('Noch keine Fragen');
    expect(editor).toContain('data-bb-data="schedule.0.time"');
    // Adding a section to an empty group fills it with starter facts.
    expect(starterFactOps(store, 'faq')).toEqual([
      {
        op: 'data.set',
        key: 'faq',
        value: [{ q: 'Dürfen Kinder mitkommen?', a: 'Ja, sehr gerne.' }],
      },
    ]);
  });

  it('designs: readable text everywhere, and an accent that stays readable', () => {
    for (const d of DESIGNS) {
      const t = d.tokens;
      const pairs: [string, string][] = [
        ['color.on-surface', 'color.surface'],
        ['color.on-surface', 'color.surface-subtle'],
        ['color.muted', 'color.surface'],
        ['color.muted', 'color.surface-subtle'],
        ['color.accent', 'color.surface'],
        ['color.on-accent', 'color.accent'],
        ['color.on-inverse', 'color.inverse'],
        ['color.on-inverse-muted', 'color.inverse'],
      ];
      for (const [fg, bg] of pairs)
        expect(contrast(t[fg]!, t[bg]!), `${d.id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const wanted of ['#ffff00', '#ffffff', '#000000', '#ff69b4', '#12172b', '#7fffd4']) {
        const a = readableAccent(wanted, d);
        expect(contrast(a.accent, t['color.surface']!), `${d.id} ${wanted}`).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrast(a.onAccent, a.accent),
          `${d.id} ${wanted} on-accent`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('picking a design restyles tokens and sections in one step', () => {
    const store = createEventSite(DEMO.de);
    const result = store.apply({
      ops: styleOps(
        store.view,
        { design: 'midnight', accent: null, corners: 'round', spacing: 'airy' },
        store.view.data('style') as never,
      ),
    });
    expect(result.ok).toBe(true);
    expect(store.view.node('hero-1')?.section?.variant.layout).toBe('fullscreen');
    expect(store.view.node('schedule-1')?.section?.variant).toEqual({
      layout: 'spine',
      background: 'subtle',
    });
    store.undo();
    expect(store.view.node('hero-1')?.section?.variant.layout).toBe('centered');
  });

  it('the published page has a menu from the sections’ headings and no third-party requests', () => {
    const store = createEventSite(DEMO.en);
    const html = renderSite(store.doc, store.registry);
    expect(html).toContain('<a href="#schedule-1">Schedule</a>');
    expect(html).toContain('<html lang="en">');
    // No scripts, no external resources: images are inline, links only navigate.
    expect(html).not.toMatch(/<script|<link|@import|url\(https?:/);
    expect(html.match(/src="https?:/g)).toBeNull();
  });

  it('small helpers', () => {
    expect(monogram('Lena & Jonas')).toBe('L & J');
    expect(monogram('Ada und Grace')).toBe('A & G');
    expect(monogram('Sommerfest')).toBe('S');
    expect(daysUntil('2027-06-12', new Date(2027, 5, 10))).toBe(2);
    expect(eventRegistry('de')).toBe(eventRegistry('de'));
    expect(createStore).toBeTypeOf('function');
  });
});

describe('structured editing policy', () => {
  it('whole sections move and go; parts stay; gallery photos are the exception', async () => {
    const { eventPolicy, MAX_GALLERY } = await import('../src/site/policy.js');
    const store = createEventSite(DEMO.de);
    store.setPolicy(eventPolicy());
    const host = { kind: 'user' as const, id: 'host' };
    const run = (op: Record<string, unknown>) => store.apply({ actor: host, ops: [op] });
    expect(run({ op: 'node.remove', id: 'hero-1/heading' }).ok).toBe(false);
    expect(run({ op: 'node.move', id: 'hero-1/heading', after: 'hero-1/tagline' }).ok).toBe(false);
    expect(run({ op: 'node.duplicate', id: 'story-1/text' }).ok).toBe(false);
    expect(run({ op: 'style.set', id: 'hero-1/heading', css: 'color: red' }).ok).toBe(false);
    expect(
      run({
        op: 'node.insert',
        parent: 'hero-1/content',
        node: { type: 'text', props: { text: 'x' } },
      }).ok,
    ).toBe(false);
    const moved = run({ op: 'node.move', id: 'faq-1', before: 'hero-1' });
    expect(moved.ok, !moved.ok ? moved.errors[0]?.message : '').toBe(true);
    expect(run({ op: 'node.duplicate', id: 'story-1' }).ok).toBe(true);
    expect(run({ op: 'node.remove', id: 'countdown-1' }).ok).toBe(true);
    expect(run({ op: 'section.insert', section: 'quote', parent: 'story-1' }).ok).toBe(false);
    // Gallery photos can be added, duplicated, reordered and removed, up to the limit.
    expect(run({ op: 'section.insert', section: 'gallery', page: 'home' }).ok).toBe(true);
    expect(run({ op: 'node.duplicate', id: 'gallery-1/photo-1' }).ok).toBe(true);
    expect(run({ op: 'node.move', id: 'gallery-1/photo-2', before: 'gallery-1/photo-1' }).ok).toBe(
      true,
    );
    expect(run({ op: 'node.remove', id: 'gallery-1/photo-3' }).ok).toBe(true);
    for (let i = store.view.children('gallery-1/images').length; i < MAX_GALLERY; i++)
      expect(run({ op: 'node.duplicate', id: 'gallery-1/photo-1' }).ok).toBe(true);
    const full = run({ op: 'node.duplicate', id: 'gallery-1/photo-1' });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.errors[0]?.message).toMatch(/up to 24 photos/);
    // Facts stay editable.
    expect(run({ op: 'data.set', key: 'faq', path: [0, 'a'], value: 'Ja.' }).ok).toBe(true);
  });
});
