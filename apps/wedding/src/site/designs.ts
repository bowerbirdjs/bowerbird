import { type DataDef, type DocView, defineData } from '@bowerbirdjs/core';
import { z } from 'zod';
import { type Background, BLOCKS } from './blocks.js';
import { hexColor, type SiteLocale } from './facts.js';

/**
 * Designs: a complete set of colour and type tokens plus the layout and background each block
 * starts with. Picking a design writes all of it through ops (one undo step). Corners and spacing
 * are separate knobs and survive a design switch; the accent can be changed, but never so far
 * that text stops being readable.
 */

export interface Design {
  id: string;
  name: string;
  description: Record<SiteLocale, string>;
  /** Token path → CSS value. */
  tokens: Record<string, string>;
  /** Per block type: what a section gets when the design is picked. */
  sections: Record<string, { layout?: string; background?: Background }>;
}

const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
const DIDONE = "Didot, 'Bodoni 72', 'Bodoni MT', 'Times New Roman', serif";
const SANS = "'Avenir Next', Avenir, 'Segoe UI', ui-sans-serif, system-ui, sans-serif";
const SYSTEM = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
const SCRIPT = "'Snell Roundhand', 'Apple Chancery', 'URW Chancery L', 'Segoe Script', cursive";

export const DESIGNS: Design[] = [
  {
    id: 'linen',
    name: 'Linen',
    description: {
      de: 'Warm und klassisch, mit Serifenschrift.',
      en: 'Warm and classic, with a serif face.',
    },
    tokens: {
      'color.surface': '#faf7f2',
      'color.surface-subtle': '#f1ebe2',
      'color.on-surface': '#2b2622',
      'color.muted': '#6a6058',
      'color.line': '#ddd3c6',
      'color.card': '#fffdf9',
      'color.accent': '#9a4f39',
      'color.on-accent': '#ffffff',
      'color.accent-deep': '#5c2e20',
      'color.inverse': '#2f2924',
      'color.on-inverse': '#f6f0e8',
      'color.on-inverse-muted': '#cfc3b6',
      'color.inverse-line': '#5a4f46',
      'color.inverse-card': '#3a332d',
      'font.heading': SERIF,
      'font.body': SYSTEM,
      'font.accent': SCRIPT,
      'weight.heading': '400',
    },
    sections: {
      hero: { layout: 'centered', background: 'plain' },
      countdown: { background: 'subtle' },
      story: { layout: 'single', background: 'plain' },
      'text-image': { layout: 'image-left', background: 'plain' },
      gallery: { layout: 'grid', background: 'plain' },
      photo: { layout: 'inset', background: 'plain' },
      quote: { background: 'subtle' },
      schedule: { layout: 'rail', background: 'subtle' },
      location: { layout: 'centered', background: 'plain' },
      travel: { layout: 'centered', background: 'subtle' },
      dresscode: { layout: 'dots', background: 'plain' },
      faq: { layout: 'stacked', background: 'subtle' },
      'registry-links': { layout: 'pills', background: 'plain' },
      rsvp: { background: 'subtle' },
      footer: { background: 'inverse' },
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: { de: 'Dunkel und festlich, mit Gold.', en: 'Dark and festive, with gold.' },
    tokens: {
      'color.surface': '#12172b',
      'color.surface-subtle': '#1a2140',
      'color.on-surface': '#f2efe8',
      'color.muted': '#b9b5cb',
      'color.line': '#39416a',
      'color.card': '#1d2546',
      'color.accent': '#d8b56a',
      'color.on-accent': '#12172b',
      'color.accent-deep': '#3d3216',
      'color.inverse': '#f2efe8',
      'color.on-inverse': '#12172b',
      'color.on-inverse-muted': '#4a4f68',
      'color.inverse-line': '#cfcbdc',
      'color.inverse-card': '#ffffff',
      'font.heading': DIDONE,
      'font.body': SYSTEM,
      'font.accent': SCRIPT,
      'weight.heading': '400',
    },
    sections: {
      hero: { layout: 'fullscreen', background: 'plain' },
      countdown: { background: 'accent' },
      story: { layout: 'side', background: 'plain' },
      'text-image': { layout: 'image-right', background: 'subtle' },
      gallery: { layout: 'mosaic', background: 'plain' },
      photo: { layout: 'full', background: 'plain' },
      quote: { background: 'plain' },
      schedule: { layout: 'spine', background: 'subtle' },
      location: { layout: 'side', background: 'plain' },
      travel: { layout: 'side', background: 'subtle' },
      dresscode: { layout: 'chips', background: 'plain' },
      faq: { layout: 'side', background: 'subtle' },
      'registry-links': { layout: 'cards', background: 'plain' },
      rsvp: { background: 'inverse' },
      footer: { background: 'subtle' },
    },
  },
  {
    id: 'meadow',
    name: 'Meadow',
    description: { de: 'Hell und luftig, in Salbeigrün.', en: 'Light and airy, in sage green.' },
    tokens: {
      'color.surface': '#fbfcf8',
      'color.surface-subtle': '#eef3ea',
      'color.on-surface': '#23302a',
      'color.muted': '#56645c',
      'color.line': '#d5dfd2',
      'color.card': '#ffffff',
      'color.accent': '#46704f',
      'color.on-accent': '#ffffff',
      'color.accent-deep': '#203626',
      'color.inverse': '#23302a',
      'color.on-inverse': '#f1f5ee',
      'color.on-inverse-muted': '#c3d0c5',
      'color.inverse-line': '#4b5a51',
      'color.inverse-card': '#2d3c34',
      'font.heading': SANS,
      'font.body': "Georgia, 'Times New Roman', serif",
      'font.accent': SCRIPT,
      'weight.heading': '600',
    },
    sections: {
      hero: { layout: 'split', background: 'subtle' },
      countdown: { background: 'plain' },
      story: { layout: 'photo', background: 'plain' },
      'text-image': { layout: 'image-left', background: 'subtle' },
      gallery: { layout: 'strip', background: 'plain' },
      photo: { layout: 'inset', background: 'subtle' },
      quote: { background: 'accent' },
      schedule: { layout: 'cards', background: 'plain' },
      location: { layout: 'centered', background: 'subtle' },
      travel: { layout: 'centered', background: 'plain' },
      dresscode: { layout: 'chips', background: 'subtle' },
      faq: { layout: 'open', background: 'plain' },
      'registry-links': { layout: 'pills', background: 'subtle' },
      rsvp: { background: 'accent' },
      footer: { background: 'inverse' },
    },
  },
];

export const DEFAULT_DESIGN = DESIGNS[0]!;
export const designById = (id: string) => DESIGNS.find((d) => d.id === id) ?? DEFAULT_DESIGN;

export const CORNERS = {
  sharp: { 'radius.sm': '0px', 'radius.card': '0px', 'radius.button': '0px' },
  soft: { 'radius.sm': '4px', 'radius.card': '10px', 'radius.button': '6px' },
  round: { 'radius.sm': '10px', 'radius.card': '22px', 'radius.button': '999px' },
} as const;
export type Corners = keyof typeof CORNERS;

export const SPACING = {
  compact: { 'space.section': '3.5rem' },
  regular: { 'space.section': '5rem' },
  airy: { 'space.section': '7rem' },
} as const;
export type Spacing = keyof typeof SPACING;

/** The host's style choices (the tokens hold the resulting values). */
export const styleSchema = z.object({
  design: z.string().max(40),
  accent: hexColor.nullable(),
  corners: z.enum(['sharp', 'soft', 'round']),
  spacing: z.enum(['compact', 'regular', 'airy']),
});
export type SiteStyle = z.infer<typeof styleSchema>;

export const STYLE: DataDef = defineData({
  key: 'style',
  title: 'Style',
  description: 'The design (linen|midnight|meadow), accent colour, corners and spacing.',
  schema: styleSchema,
});

export const DEFAULT_STYLE: SiteStyle = {
  design: DEFAULT_DESIGN.id,
  accent: null,
  corners: 'soft',
  spacing: 'regular',
};

/** Tokens every design shares (sizes, scale). */
export const BASE_TOKENS: Record<string, string> = {
  'space.2xs': '0.25rem',
  'space.xs': '0.5rem',
  'space.sm': '0.75rem',
  'space.md': '1rem',
  'space.lg': '1.5rem',
  'space.xl': '2rem',
  'space.2xl': '3rem',
  'space.3xl': '4.5rem',
  'space.gutter': '1.25rem',
  'size.container': '68rem',
  'size.prose': '40rem',
  'text.xs': '0.75rem',
  'text.sm': '0.875rem',
  'text.md': '1rem',
  'text.lg': '1.125rem',
  'text.xl': '1.3rem',
  'text.2xl': '1.6rem',
  'text.3xl': '2rem',
  'text.4xl': '2.6rem',
  'text.5xl': '3.4rem',
  'text.6xl': '4.4rem',
  'leading.tight': '1.15',
  'leading.snug': '1.35',
  'leading.normal': '1.65',
};

// ---------------------------------------------------------------------------------------------
// Contrast

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
}

/**
 * The accent colour as used: moved toward the text colour until it reads (4.5:1) on the page and
 * subtle backgrounds, plus the text colour that reads on it.
 */
export function readableAccent(
  wanted: string,
  design: Design,
): { accent: string; onAccent: string; deep: string } {
  const surface = design.tokens['color.surface']!;
  const subtle = design.tokens['color.surface-subtle']!;
  const text = design.tokens['color.on-surface']!;
  let accent = wanted;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    accent = mix(wanted, text, t);
    if (contrast(accent, surface) >= 4.5 && contrast(accent, subtle) >= 4.5) break;
  }
  const onAccent = ['#ffffff', design.tokens['color.surface']!, text, '#000000'].sort(
    (a, b) => contrast(b, accent) - contrast(a, accent),
  )[0]!;
  return { accent, onAccent, deep: mix(accent, '#000000', 0.55) };
}

/** Token values for a style: the design's, then corners, spacing and the accent. */
export function styleTokens(style: SiteStyle): Record<string, string> {
  const design = designById(style.design);
  const tokens: Record<string, string> = {
    ...design.tokens,
    ...CORNERS[style.corners],
    ...SPACING[style.spacing],
  };
  if (style.accent) {
    const a = readableAccent(style.accent, design);
    tokens['color.accent'] = a.accent;
    tokens['color.on-accent'] = a.onAccent;
    tokens['color.accent-deep'] = a.deep;
  }
  return tokens;
}

/**
 * Ops that apply a style. Picking a new design also gives every section the design's layout and
 * background for its block; other changes (accent, corners, spacing) only change tokens.
 */
export function styleOps(view: DocView, next: SiteStyle, previous?: SiteStyle): unknown[] {
  const ops: unknown[] = Object.entries(styleTokens(next)).map(([path, value]) => ({
    op: 'token.set',
    path,
    value,
  }));
  if (next.design !== previous?.design) {
    const design = designById(next.design);
    for (const id of view.nodeIds()) {
      const node = view.node(id);
      const section = node?.section;
      if (!section || !BLOCKS.some((b) => b.type === section.name)) continue;
      const wanted = design.sections[section.name];
      if (!wanted) continue;
      const variant = { ...section.variant, ...wanted };
      if (JSON.stringify(variant) !== JSON.stringify(section.variant))
        ops.push({ op: 'section.variant', id, variant });
    }
  }
  ops.push({ op: 'data.set', key: 'style', value: next });
  return ops;
}
