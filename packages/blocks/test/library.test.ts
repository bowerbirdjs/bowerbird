import {
  createDefaultRegistry,
  createStarterDoc,
  ICONS,
  placeholderPhoto,
  placeholderPortrait,
  SECTIONS,
} from '@bowerbirdjs/blocks';
import {
  createStore,
  ICON_NAME,
  isUnsafeUrl,
  lintPage,
  parseIcon,
  templateParts,
} from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

const insertAlone = (section: string, variant?: Record<string, string>) => {
  const registry = createDefaultRegistry();
  const store = createStore({ registry, doc: createStarterDoc() });
  const res = store.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section, ...(variant ? { variant } : {}) },
    ],
  });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
  return store;
};

describe('the starter library', () => {
  it('offers the sections a marketing or event site needs, in page order', () => {
    expect(SECTIONS.map((s) => s.name)).toEqual([
      'banner',
      'nav',
      'hero',
      'page-header',
      'logos',
      'features',
      'split',
      'steps',
      'stats',
      'cards',
      'gallery',
      'team',
      'schedule',
      'testimonials',
      'pricing',
      'faq',
      'content',
      'newsletter',
      'contact',
      'cta',
      'footer',
    ]);
    for (const s of SECTIONS) {
      expect(s.category, s.name).toMatch(
        /^(navigation|header|content|media|social-proof|commerce|conversion)$/,
      );
      // What agents and the Insert panel show.
      expect(s.title.length, s.name).toBeGreaterThan(2);
      expect(s.description.length, s.name).toBeGreaterThan(40);
      expect(s.description.length, s.name).toBeLessThan(260);
      // Its own background variable, so any section can be recoloured the same way.
      if (!['nav', 'cta', 'footer', 'banner'].includes(s.name))
        expect(Object.keys(s.vars ?? {}), s.name).toContain(`--${s.name}-bg`);
    }
  });

  it('every section is accessible as inserted: no lint errors, no warnings of its own', () => {
    for (const s of SECTIONS) {
      const axes = Object.entries(s.variants ?? {});
      const variants: (Record<string, string> | undefined)[] = [
        undefined,
        ...axes.flatMap(([axis, values]) => values.slice(1).map((v) => ({ [axis]: v }))),
      ];
      for (const variant of variants) {
        const store = insertAlone(s.name, variant);
        const found = lintPage(store.view, store.registry, 'home')
          // A page of one section has no h1 unless that section brings it.
          .filter((i) => i.severity !== 'info' && i.rule !== 'single-h1')
          .map((i) => `${i.rule} ${i.nodeId}`);
        expect(found, `${s.name} ${JSON.stringify(variant ?? {})}`).toEqual([]);
      }
    }
  });

  it('part paths are unique and steady across variants where a part exists in both', () => {
    for (const s of SECTIONS) {
      const paths = templateParts(s).map((p) => p.path);
      expect(new Set(paths).size, s.name).toBe(paths.length);
    }
    // Repeated items are keyed, so agents address and duplicate them by name.
    const faq = insertAlone('faq');
    expect(faq.doc.nodes['faq-1/item-2/question']?.props).toMatchObject({ tag: 'summary' });
    expect(faq.doc.nodes['faq-1/item-1']?.props.open).toBe(true);
    expect(faq.doc.nodes['faq-1/item-2']?.props.open).toBeUndefined();
    const contact = insertAlone('contact');
    expect(contact.doc.nodes['contact-1/detail-email/value']?.props.href).toBe(
      'mailto:hello@example.com',
    );
    expect(contact.doc.nodes['contact-1/email']?.props).toMatchObject({
      type: 'email',
      name: 'email',
      required: true,
    });
    expect(contact.doc.nodes['contact-1/submit']?.props.type).toBe('submit');
    const single = insertAlone('testimonials', { layout: 'single' });
    expect(single.view.children('testimonials-1/list')).toHaveLength(1);
    const wide = insertAlone('gallery', { columns: '4' });
    expect(wide.view.children('gallery-1/grid')).toHaveLength(8);
  });

  it('placeholder pictures are inline, safe and varied', () => {
    const photos = [0, 1, 2, 3].map((i) => placeholderPhoto(i));
    const portraits = [0, 1, 2, 3].map((i) => placeholderPortrait(i));
    for (const uri of [...photos, ...portraits]) {
      expect(uri.startsWith('data:image/svg+xml,%3Csvg')).toBe(true);
      expect(isUnsafeUrl(uri, 'src')).toBe(false);
      // Encoded so it survives inside an attribute and a CSS url().
      expect(uri).not.toMatch(/[<>"#]/);
    }
    expect(new Set(photos).size).toBe(4);
    expect(placeholderPhoto(4)).toBe(placeholderPhoto(0));
  });
});

describe('the starter icon set', () => {
  it('holds plain drawings under kebab-case names', () => {
    const names = Object.keys(ICONS);
    expect(names.length).toBeGreaterThanOrEqual(80);
    for (const name of names) {
      expect(name, name).toMatch(ICON_NAME);
      const icon = parseIcon(ICONS[name]!);
      expect(icon, name).toBeDefined();
      expect(icon).toMatchObject({ viewBox: '0 0 24 24', style: 'stroke', strokeWidth: 2 });
    }
    expect(createDefaultRegistry().listIcons()).toEqual(names);
  });

  it('a host adds icons or replaces a starter one', () => {
    const registry = createDefaultRegistry({
      icons: {
        heart: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="6"/></svg>',
        'acme-mark': '<path d="M4 20 12 4l8 16"/>',
      },
    });
    expect(registry.icon('heart')).toMatchObject({ viewBox: '0 0 16 16', style: 'fill' });
    expect(registry.listIcons()).toContain('acme-mark');
    expect(registry.listIcons().length).toBe(Object.keys(ICONS).length + 1);
  });
});
