import {
  createEmptyDoc,
  createStore,
  type Registry,
  type SectionDef,
  type SiteDoc,
} from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { renderPage } from '@bowerbirdjs/html';

/** Width (px) a section is laid out at for its thumbnail: a desktop layout, scaled down. */
export const THUMB_WIDTH = 1120;

export interface SectionThumbs {
  /** One stylesheet for every thumbnail, scoped to `scope`. */
  css: string;
  /** Section name → its markup as published (a page root holding the section). */
  html: Map<string, string>;
}

/**
 * Small live previews of section templates: each section as it would be inserted, rendered with
 * the site's own tokens, themes, breakpoints and data, so the catalog shows the site's brand, not
 * a stock picture. The markup is what would be published (no editor marks, accordions closed);
 * the CSS is the canvas kind: scoped to `scope`, tokens on that element, and reset against the CSS
 * around it (the editor's panels). Sections that can't be built are left out.
 */
export function buildSectionThumbs(
  registry: Registry,
  doc: SiteDoc,
  sections: readonly SectionDef[],
  scope: string,
): SectionThumbs {
  const base: SiteDoc = {
    ...createEmptyDoc({ tokens: doc.tokens, themes: doc.themes, breakpoints: doc.breakpoints }),
    ...(doc.data ? { data: doc.data } : {}),
  };
  const store = createStore({ registry, doc: base });
  const actor = { kind: 'system', id: 'bowerbird' } as const;
  const html = new Map<string, string>();
  sections.forEach((section, i) => {
    // Ids of their own (`thumb-3`), so nothing in a preview can be mistaken for a node of the page.
    const page = `thumb-${i + 1}`;
    const made = store.apply({
      actor,
      ops: [
        { op: 'page.create', id: page, path: `/${page}`, title: section.title || section.name },
        { op: 'section.insert', section: section.name, page, id: `${page}-section` },
      ],
    });
    if (!made.ok) return;
    try {
      html.set(section.name, renderPage(store.doc, registry, page, { nodeIds: 'styled' }).html);
    } catch {
      // A component that can't render leaves its card without a picture.
    }
  });
  const css = html.size
    ? compileCss(store.doc, registry, { mode: 'editor', canvasSelector: scope })
    : '';
  return { css, html };
}

const CATEGORY_LABELS: Record<string, string> = {
  navigation: 'Navigation',
  header: 'Headers',
  content: 'Content',
  media: 'Media and people',
  'social-proof': 'Social proof',
  commerce: 'Pricing',
  conversion: 'Forms and calls to action',
};

/** A category as a heading: the known ones in words, others capitalised (`case-study` → "Case study"). */
export function categoryLabel(category: string | undefined): string {
  if (!category) return 'Other';
  const known = Object.hasOwn(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : undefined;
  if (known) return known;
  const words = category.replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Other';
}

/** Sections by category, categories in the order they first appear. */
export function groupSections(sections: readonly SectionDef[]): [string, SectionDef[]][] {
  const groups = new Map<string, SectionDef[]>();
  for (const section of sections) {
    const label = categoryLabel(section.category);
    const list = groups.get(label);
    if (list) list.push(section);
    else groups.set(label, [section]);
  }
  return [...groups];
}

/** Whether every word of `query` occurs in what a section says about itself. */
export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
