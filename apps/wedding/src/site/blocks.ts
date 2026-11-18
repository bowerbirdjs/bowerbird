import { defineSection, type NodeInput, type SectionDef, t } from '@bowerbirdjs/core';
import type { FactGroup, SiteLocale } from './facts.js';

/**
 * The event blocks. Each is a Bowerbird section: a template of parts (heading, text, image…) the
 * page owns, a `layout` variant and a `background` variant. Sections that show facts hold only
 * presentation; the fact components inside them read the event details.
 */

export const BACKGROUNDS = ['plain', 'subtle', 'inverse', 'accent'] as const;
export type Background = (typeof BACKGROUNDS)[number];

export interface BlockInfo {
  type: string;
  label: Record<SiteLocale, string>;
  description: Record<SiteLocale, string>;
  layouts: string[];
  /** Fact groups the section shows. */
  facts: FactGroup[];
  /** Linked from the site menu, named by its heading. */
  menu: boolean;
}

const info = (
  type: string,
  label: [string, string],
  description: [string, string],
  layouts: string[] = [],
  facts: FactGroup[] = [],
  menu = false,
): BlockInfo => ({
  type,
  label: { de: label[0], en: label[1] },
  description: { de: description[0], en: description[1] },
  layouts,
  facts,
  menu,
});

export const BLOCKS: BlockInfo[] = [
  info(
    'hero',
    ['Titelbild', 'Hero'],
    ['Eure Namen, ein Satz, das Datum und ein Foto.', 'Your names, a line, the date and a photo.'],
    ['centered', 'split', 'banner', 'fullscreen', 'frame'],
  ),
  info('countdown', ['Countdown', 'Countdown'], ['Die Tage bis zum Fest.', 'Days until the day.']),
  info(
    'story',
    ['Geschichte', 'Story'],
    ['Ein Text, auf Wunsch mit Foto.', 'A text, with a photo if you like.'],
    ['single', 'side', 'photo'],
    [],
    true,
  ),
  info(
    'text-image',
    ['Text und Bild', 'Text and image'],
    ['Text mit einem Foto daneben.', 'Text with a photo beside it.'],
    ['image-left', 'image-right'],
    [],
    true,
  ),
  info(
    'gallery',
    ['Galerie', 'Gallery'],
    ['Bis zu 24 eurer Fotos.', 'Up to 24 of your photos.'],
    ['grid', 'mosaic', 'strip'],
    [],
    true,
  ),
  info(
    'photo',
    ['Foto', 'Photo'],
    ['Ein Foto zwischen zwei Abschnitten.', 'One photo between sections.'],
    ['full', 'inset'],
  ),
  info(
    'quote',
    ['Zitat', 'Quote'],
    ['Ein Zitat, das euch etwas bedeutet.', 'A quote that means something to you.'],
  ),
  info(
    'schedule',
    ['Ablauf', 'Schedule'],
    ['Der Ablauf des Tages.', 'The day’s program.'],
    ['rail', 'spine', 'list', 'menu', 'cards'],
    ['schedule', 'venues'],
    true,
  ),
  info(
    'location',
    ['Orte', 'Location'],
    ['Jeder Ort als Karte mit Route.', 'Every venue as a card with directions.'],
    ['centered', 'side'],
    ['venues'],
    true,
  ),
  info(
    'travel',
    ['Anreise', 'Travel'],
    ['Anreise, Parken und Übernachten.', 'Getting there, parking and places to stay.'],
    ['centered', 'side'],
    ['travel', 'stays'],
    true,
  ),
  info(
    'dresscode',
    ['Dresscode', 'Dress code'],
    ['Stil, Text und bis zu 8 Farben.', 'Style, a text and up to 8 colours.'],
    ['dots', 'chips'],
    ['dresscode'],
    true,
  ),
  info(
    'faq',
    ['Fragen', 'Questions'],
    ['Fragen und Antworten für eure Gäste.', 'Questions and answers for your guests.'],
    ['stacked', 'side', 'open'],
    ['faq'],
    true,
  ),
  info(
    'registry-links',
    ['Wünsche', 'Gifts'],
    ['Ein Text und Links zu euren Wünschen.', 'A text and links to your wishes.'],
    ['pills', 'cards'],
    ['gifts'],
    true,
  ),
  info(
    'photo-wall',
    ['Fotowand', 'Photo wall'],
    ['Die Fotos eurer Gäste.', 'Your guests’ photos.'],
    [],
    [],
    true,
  ),
  info(
    'guestbook-cta',
    ['Gästebuch', 'Guestbook'],
    ['Ein Aufruf, ins Gästebuch zu schreiben.', 'A call to write in your guestbook.'],
  ),
  info('rsvp', ['Zusage', 'RSVP'], ['Das Antwortformular.', 'The reply form.']),
  info(
    'divider',
    ['Trenner', 'Divider'],
    ['Eine Linie, Punkte oder ein Ornament.', 'A line, dots or an ornament.'],
  ),
  info(
    'footer',
    ['Abschluss', 'Footer'],
    ['Ein letzter Satz und euer Monogramm.', 'A closing line and your monogram.'],
  ),
];

export const blockInfo = (type: string) => BLOCKS.find((b) => b.type === type);

// ---------------------------------------------------------------------------------------------
// Placeholder photos: inline SVG, so a page makes no third-party requests.

const PALETTES = {
  dawn: ['#f6e7dc', '#e7b9a2', '#a86a55'],
  sage: ['#e7eee4', '#b0c6ab', '#5e7b60'],
  dusk: ['#e2e1f1', '#a6a9d4', '#4f5289'],
  sand: ['#f3ecdf', '#d9c3a1', '#8f7350'],
} as const;
export type Palette = keyof typeof PALETTES;

export function placeholder(palette: Palette, w = 1200, h = 800): string {
  const [a, b, c] = PALETTES[palette];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.34}" r="${h * 0.11}" fill="${a}"/><path d="M0 ${h * 0.76} Q${w * 0.3} ${h * 0.6} ${w * 0.55} ${h * 0.74} T${w} ${h * 0.66} V${h} H0Z" fill="${c}" opacity=".5"/><path d="M0 ${h * 0.88} Q${w * 0.45} ${h * 0.74} ${w} ${h * 0.86} V${h} H0Z" fill="${c}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------------------------------------
// CSS shared by every block, scoped to it (a page only carries the CSS of blocks it uses).

const WIDE = '@container bb-page (min-width: 48rem)';

function shell(type: string, css: string): string {
  const s = `.bb-${type}`;
  return `${s} { padding: var(--space-section) var(--space-gutter); }
${s}__inner { max-width: var(--size-container); margin-inline: auto; display: grid; gap: var(--space-lg); }
${s}__heading { font-family: var(--font-heading); font-weight: var(--weight-heading); font-size: var(--text-3xl); line-height: var(--leading-tight); text-align: center; text-wrap: balance; }
${WIDE} { ${s}__heading { font-size: var(--text-4xl); } }
${s}--background-subtle { background: var(--color-surface-subtle); }
${s}--background-inverse { background: var(--color-inverse); color: var(--color-on-inverse); --color-muted: var(--color-on-inverse-muted); --color-line: var(--color-inverse-line); --color-card: var(--color-inverse-card); }
${s}--background-accent { background: var(--color-accent); color: var(--color-on-accent); --color-muted: var(--color-on-accent); --color-line: var(--color-on-accent); --color-card: transparent; --color-accent: var(--color-on-accent); --color-on-accent-button: var(--color-accent-deep); }
${s} :where(.ev-text, [class*="__text"]) { white-space: pre-line; }
${s} .ev-muted { color: var(--color-muted); }
${s} .ev-eyebrow { font-size: var(--text-sm); letter-spacing: .12em; text-transform: uppercase; color: var(--color-muted); }
${s} .ev-subheading { font-family: var(--font-heading); font-weight: var(--weight-heading); font-size: var(--text-xl); }
${s} .ev-button { display: inline-flex; align-self: start; justify-self: start; padding: .55em 1.2em; border-radius: var(--radius-button); background: var(--color-accent); color: var(--color-on-accent-button, var(--color-on-accent)); text-decoration: none; font-weight: 600; font-size: var(--text-sm); }
${s} .ev-card { display: grid; gap: var(--space-xs); align-content: start; padding: var(--space-lg); border-radius: var(--radius-card); background: var(--color-card); border: 1px solid var(--color-line); }
${s} .ev-hint { padding: var(--space-md); border: 1px dashed var(--color-line); border-radius: var(--radius-card); color: var(--color-muted); text-align: center; font-size: var(--text-sm); }
${s}[data-empty] { opacity: .75; }
${css}`;
}

// ---------------------------------------------------------------------------------------------
// Templates

const root = (children: (NodeInput | null | false)[]) =>
  t.component('ev-section', {}, [t.box({ part: 'inner' }, children)]);
const heading = (text: string, tag = 'h2') => t.text({ part: 'heading', tag, text });
const body = (text: string, part = 'text') => t.text({ part, text });
const factsPart = (type: string, part = 'items') => t.component(type, { part });

const variants = (layouts: string[]) => ({
  ...(layouts.length ? { layout: layouts } : {}),
  background: [...BACKGROUNDS],
});

/** Starter content for a block, in the event's language. */
type Starter = Record<SiteLocale, Record<string, string>>;

const STARTER: Record<string, Starter> = {
  hero: {
    de: { heading: 'Wir heiraten', tagline: 'Und wir möchten diesen Tag mit euch feiern.' },
    en: {
      heading: 'We’re getting married',
      tagline: 'And we’d love to celebrate the day with you.',
    },
  },
  countdown: { de: { heading: 'Bis zum großen Tag' }, en: { heading: 'Until the big day' } },
  story: {
    de: {
      heading: 'Unsere Geschichte',
      text: 'Wir haben uns an einem verregneten Sommerabend kennengelernt. Seitdem gab es kein Jahr, in dem wir nicht zusammen gelacht haben.',
    },
    en: {
      heading: 'Our story',
      text: 'We met on a rainy summer evening. There hasn’t been a year since that we didn’t spend laughing together.',
    },
  },
  'text-image': {
    de: {
      heading: 'Gut zu wissen',
      text: 'Hier ist Platz für alles, was eure Gäste vorher wissen sollten.',
    },
    en: { heading: 'Good to know', text: 'Room for anything your guests should know beforehand.' },
  },
  gallery: { de: { heading: 'Momente', text: '' }, en: { heading: 'Moments', text: '' } },
  photo: { de: { caption: '' }, en: { caption: '' } },
  quote: {
    de: { text: 'Wo du hingehst, da will auch ich hingehen.', attribution: 'Rut 1,16' },
    en: { text: 'Where you go, I will go.', attribution: 'Ruth 1:16' },
  },
  schedule: { de: { heading: 'Ablauf' }, en: { heading: 'Schedule' } },
  location: { de: { heading: 'Wo wir feiern' }, en: { heading: 'Where we celebrate' } },
  travel: { de: { heading: 'Anreise und Übernachtung' }, en: { heading: 'Travel and stay' } },
  dresscode: { de: { heading: 'Dresscode' }, en: { heading: 'Dress code' } },
  faq: { de: { heading: 'Fragen und Antworten' }, en: { heading: 'Questions and answers' } },
  'registry-links': { de: { heading: 'Wünsche' }, en: { heading: 'Gifts' } },
  'photo-wall': { de: { heading: 'Eure Fotos' }, en: { heading: 'Your photos' } },
  'guestbook-cta': {
    de: {
      heading: 'Gästebuch',
      text: 'Schreibt uns ein paar Zeilen. Wir lesen jede davon.',
      buttonLabel: 'Ins Gästebuch schreiben',
    },
    en: {
      heading: 'Guestbook',
      text: 'Leave us a few lines. We read every one.',
      buttonLabel: 'Write in the guestbook',
    },
  },
  rsvp: {
    de: { heading: 'Zu- oder Absage', text: 'Sagt uns bitte bis zum 1. Mai, ob ihr dabei seid.' },
    en: { heading: 'RSVP', text: 'Please let us know by 1 May whether you can make it.' },
  },
  footer: { de: { note: 'Wir freuen uns auf euch.' }, en: { note: 'We can’t wait to see you.' } },
};

/** The blocks with starter content in `locale`. */
export function createBlocks(locale: SiteLocale): SectionDef[] {
  const s = (type: string) => STARTER[type]?.[locale] ?? {};
  const def = (
    type: string,
    template: () => NodeInput,
    css: string,
    extraVariants: Record<string, string[]> = {},
  ): SectionDef => {
    const b = blockInfo(type)!;
    return defineSection({
      name: type,
      version: 1,
      title: b.label[locale],
      description: b.description[locale],
      category: 'event',
      variants: { ...extraVariants, ...variants(b.layouts) },
      css: shell(type, css),
      template,
    });
  };

  return [
    def(
      'hero',
      () =>
        root([
          t.image({ part: 'media', src: placeholder('dawn'), alt: '', loading: 'eager' }),
          t.box({ part: 'content' }, [
            t.component('monogram', { part: 'monogram' }),
            heading(s('hero').heading!, 'h1'),
            body(s('hero').tagline!, 'tagline'),
            t.component('event-date', { part: 'date', props: { date: '' } }),
          ]),
        ]),
      `.bb-hero__inner { align-items: center; }
.bb-hero__content { display: grid; gap: var(--space-sm); justify-items: center; text-align: center; }
.bb-hero__monogram { font-family: var(--font-accent); font-size: var(--text-2xl); color: var(--color-accent); }
.bb-hero__heading { font-size: var(--text-4xl); }
.bb-hero__tagline { font-size: var(--text-lg); color: var(--color-muted); max-width: var(--size-prose); }
.bb-hero__date { font-size: var(--text-sm); letter-spacing: .14em; text-transform: uppercase; }
.bb-hero__media { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: var(--radius-card); }
${WIDE} { .bb-hero__heading { font-size: var(--text-6xl); } }
.bb-hero--layout-centered .bb-hero__media { order: 2; max-width: 44rem; justify-self: center; }
${WIDE} {
  .bb-hero--layout-split .bb-hero__inner { grid-template-columns: 1fr 1fr; gap: var(--space-2xl); }
  .bb-hero--layout-split .bb-hero__media { order: 2; aspect-ratio: 4 / 5; }
  .bb-hero--layout-split .bb-hero__content { justify-items: start; text-align: left; }
}
.bb-hero--layout-banner { padding-top: 0; padding-inline: 0; }
.bb-hero--layout-banner .bb-hero__inner { max-width: none; }
.bb-hero--layout-banner .bb-hero__media { aspect-ratio: 21 / 9; border-radius: 0; }
.bb-hero--layout-banner .bb-hero__content { padding-inline: var(--space-gutter); }
.bb-hero--layout-fullscreen { padding: 0; }
.bb-hero--layout-fullscreen .bb-hero__inner { max-width: none; min-height: 34rem; position: relative; place-items: center; }
.bb-hero--layout-fullscreen .bb-hero__media { position: absolute; inset: 0; height: 100%; aspect-ratio: auto; border-radius: 0; filter: brightness(.62); }
.bb-hero--layout-fullscreen .bb-hero__content { position: relative; color: #fff; padding: var(--space-3xl) var(--space-gutter); }
.bb-hero--layout-fullscreen .bb-hero__tagline, .bb-hero--layout-fullscreen .bb-hero__monogram { color: #fff; }
.bb-hero--layout-frame .bb-hero__media { order: 2; max-width: 36rem; justify-self: center; padding: var(--space-sm); border: 1px solid var(--color-line); background: var(--color-card); }`,
    ),
    def(
      'countdown',
      () =>
        root([heading(s('countdown').heading!), t.component('countdown-days', { part: 'days' })]),
      `.bb-countdown__days { text-align: center; font-family: var(--font-heading); font-size: var(--text-4xl); color: var(--color-accent); }
${WIDE} { .bb-countdown__days { font-size: var(--text-5xl); } }`,
    ),
    def(
      'story',
      () =>
        root([
          heading(s('story').heading!),
          body(s('story').text!),
          t.image({ part: 'media', src: placeholder('sage'), alt: '' }),
        ]),
      `.bb-story__inner { max-width: var(--size-prose); }
.bb-story__text { font-size: var(--text-lg); text-align: center; }
.bb-story__media { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-card); }
.bb-story--layout-single .bb-story__media { display: none; }
.bb-story--layout-photo .bb-story__media { order: -1; }
.bb-story--layout-photo .bb-story__inner { max-width: var(--size-container); }
.bb-story--layout-photo .bb-story__text { max-width: var(--size-prose); justify-self: center; }
${WIDE} {
  .bb-story--layout-side .bb-story__inner { max-width: var(--size-container); grid-template-columns: 1fr 1fr; column-gap: var(--space-2xl); align-items: center; }
  .bb-story--layout-side .bb-story__heading, .bb-story--layout-side .bb-story__text { grid-column: 1; text-align: left; }
  .bb-story--layout-side .bb-story__media { grid-column: 2; grid-row: 1 / span 2; }
}`,
    ),
    def(
      'text-image',
      () =>
        root([
          t.image({ part: 'media', src: placeholder('sand'), alt: '' }),
          t.box({ part: 'content' }, [
            heading(s('text-image').heading!),
            body(s('text-image').text!),
          ]),
        ]),
      `.bb-text-image__content { display: grid; gap: var(--space-md); align-content: center; }
.bb-text-image__heading { text-align: left; }
.bb-text-image__media { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-card); }
${WIDE} {
  .bb-text-image__inner { grid-template-columns: 1fr 1fr; gap: var(--space-2xl); }
  .bb-text-image--layout-image-right .bb-text-image__media { order: 2; }
}`,
    ),
    def(
      'gallery',
      () =>
        root([
          heading(s('gallery').heading!),
          body(s('gallery').text!),
          t.box(
            { part: 'images' },
            (['dawn', 'sage', 'dusk', 'sand', 'sage', 'dawn'] as const).map((p, i) =>
              t.image({
                part: 'photo',
                key: String(i + 1),
                src: placeholder(p, 900, 900),
                alt: '',
              }),
            ),
          ),
        ]),
      `.bb-gallery__text { text-align: center; color: var(--color-muted); }
.bb-gallery__text:empty { display: none; }
.bb-gallery__images { display: grid; gap: var(--space-sm); grid-template-columns: repeat(2, 1fr); }
.bb-gallery__photo { width: 100%; height: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); }
${WIDE} { .bb-gallery__images { grid-template-columns: repeat(3, 1fr); } }
.bb-gallery--layout-mosaic .bb-gallery__images { grid-auto-flow: dense; }
.bb-gallery--layout-mosaic .bb-gallery__photo:nth-child(3n + 1) { grid-row: span 2; aspect-ratio: auto; }
.bb-gallery--layout-strip .bb-gallery__images { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: var(--space-xs); }
.bb-gallery--layout-strip .bb-gallery__photo { flex: 0 0 min(70%, 22rem); scroll-snap-align: start; }`,
    ),
    def(
      'photo',
      () =>
        root([
          t.image({ part: 'media', src: placeholder('dusk', 1600, 900), alt: '' }),
          body(s('photo').caption!, 'caption'),
        ]),
      `.bb-photo__media { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.bb-photo__caption { text-align: center; color: var(--color-muted); font-size: var(--text-sm); }
.bb-photo__caption:empty { display: none; }
.bb-photo--layout-full { padding-inline: 0; }
.bb-photo--layout-full .bb-photo__inner { max-width: none; }
.bb-photo--layout-inset .bb-photo__media { border-radius: var(--radius-card); }`,
    ),
    def(
      'quote',
      () =>
        root([
          t.text({ part: 'text', tag: 'blockquote', text: s('quote').text! }),
          t.text({ part: 'attribution', tag: 'cite', text: s('quote').attribution! }),
        ]),
      `.bb-quote__inner { max-width: var(--size-prose); justify-items: center; text-align: center; }
.bb-quote__text { margin: 0; font-family: var(--font-heading); font-size: var(--text-2xl); line-height: var(--leading-snug); }
.bb-quote__text::before { content: "“"; display: block; color: var(--color-accent); font-size: 3em; line-height: .6; }
.bb-quote__attribution { font-style: normal; color: var(--color-muted); font-size: var(--text-sm); letter-spacing: .1em; text-transform: uppercase; }`,
    ),
    def(
      'schedule',
      () => root([heading(s('schedule').heading!), factsPart('schedule-items')]),
      `.bb-schedule .ev-schedule { display: grid; gap: var(--space-lg); max-width: 40rem; margin-inline: auto; width: 100%; }
.bb-schedule .ev-schedule__item { display: grid; grid-template-columns: 5.5rem 1fr; gap: var(--space-md); }
.bb-schedule .ev-schedule__time { font-family: var(--font-heading); font-size: var(--text-xl); color: var(--color-accent); }
.bb-schedule .ev-schedule__title { font-size: var(--text-lg); font-weight: 600; }
.bb-schedule .ev-schedule__body { display: grid; gap: var(--space-2xs); }
.bb-schedule--layout-rail .ev-schedule__item { padding-left: var(--space-lg); border-left: 2px solid var(--color-line); position: relative; }
.bb-schedule--layout-rail .ev-schedule__item::before { content: ""; position: absolute; left: -7px; top: .45em; width: 12px; height: 12px; border-radius: 50%; background: var(--color-accent); }
.bb-schedule--layout-list .ev-schedule { gap: 0; }
.bb-schedule--layout-list .ev-schedule__item { padding-block: var(--space-md); border-bottom: 1px solid var(--color-line); }
.bb-schedule--layout-menu .ev-schedule__item { grid-template-columns: 1fr; text-align: center; justify-items: center; gap: var(--space-2xs); }
.bb-schedule--layout-menu .ev-schedule__time { font-size: var(--text-sm); letter-spacing: .14em; }
.bb-schedule--layout-cards .ev-schedule { max-width: none; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); }
.bb-schedule--layout-cards .ev-schedule__item { grid-template-columns: 1fr; padding: var(--space-lg); border-radius: var(--radius-card); background: var(--color-card); border: 1px solid var(--color-line); }
${WIDE} {
  .bb-schedule--layout-spine .ev-schedule { max-width: 52rem; position: relative; }
  .bb-schedule--layout-spine .ev-schedule::before { content: ""; position: absolute; left: 50%; top: 0; bottom: 0; border-left: 2px solid var(--color-line); }
  .bb-schedule--layout-spine .ev-schedule__item { grid-template-columns: 1fr 1fr; gap: var(--space-2xl); }
  .bb-schedule--layout-spine .ev-schedule__time { text-align: right; }
  .bb-schedule--layout-spine .ev-schedule__item:nth-child(even) .ev-schedule__time { order: 2; text-align: left; }
  .bb-schedule--layout-spine .ev-schedule__item:nth-child(even) .ev-schedule__body { text-align: right; }
}`,
    ),
    def(
      'location',
      () => root([heading(s('location').heading!), factsPart('venue-cards', 'venues')]),
      `.bb-location .ev-cards { display: grid; gap: var(--space-md); grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.bb-location--layout-centered .ev-card { text-align: center; justify-items: center; }
.bb-location--layout-centered .ev-button { justify-self: center; }
${WIDE} {
  .bb-location--layout-side .bb-location__inner { grid-template-columns: 1fr 2fr; align-items: start; }
  .bb-location--layout-side .bb-location__heading { text-align: left; }
}`,
    ),
    def(
      'travel',
      () => root([heading(s('travel').heading!), factsPart('travel-info', 'info')]),
      `.bb-travel .ev-travel { display: grid; gap: var(--space-xl); max-width: var(--size-prose); margin-inline: auto; width: 100%; }
.bb-travel .ev-travel__block { display: grid; gap: var(--space-xs); }
.bb-travel .ev-stays { display: grid; gap: var(--space-md); }
.bb-travel .ev-stay { display: grid; gap: 2px; }
.bb-travel .ev-stay__name { font-weight: 600; color: inherit; }
.bb-travel--layout-centered .ev-travel { text-align: center; }
${WIDE} {
  .bb-travel--layout-side .ev-travel { max-width: none; grid-template-columns: 1fr 1fr; }
  .bb-travel--layout-side .ev-travel__stays { grid-column: 2; grid-row: 1 / span 2; }
}`,
    ),
    def(
      'dresscode',
      () => root([heading(s('dresscode').heading!), factsPart('dresscode-info', 'info')]),
      `.bb-dresscode .ev-dress { display: grid; gap: var(--space-md); justify-items: center; text-align: center; max-width: var(--size-prose); margin-inline: auto; }
.bb-dresscode .ev-dress__style { font-family: var(--font-heading); font-size: var(--text-2xl); }
.bb-dresscode .ev-swatches { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-md); }
.bb-dresscode--layout-dots .ev-swatch { display: grid; justify-items: center; gap: var(--space-2xs); font-size: var(--text-sm); }
.bb-dresscode--layout-dots .ev-swatch::before { content: ""; width: 3rem; height: 3rem; border-radius: 50%; background: var(--swatch); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
.bb-dresscode--layout-chips .ev-swatches { gap: var(--space-xs); }
.bb-dresscode--layout-chips .ev-swatch { display: inline-flex; align-items: center; gap: .5em; padding: .35em .9em .35em .4em; border-radius: 999px; border: 1px solid var(--color-line); font-size: var(--text-sm); }
.bb-dresscode--layout-chips .ev-swatch::before { content: ""; width: 1.25rem; height: 1.25rem; border-radius: 50%; background: var(--swatch); }`,
    ),
    def(
      'faq',
      () => root([heading(s('faq').heading!), factsPart('faq-items')]),
      `.bb-faq .ev-faq { display: grid; max-width: var(--size-prose); margin-inline: auto; width: 100%; }
.bb-faq .ev-faq__item { border-bottom: 1px solid var(--color-line); padding-block: var(--space-md); }
.bb-faq .ev-faq__q { cursor: pointer; font-weight: 600; font-size: var(--text-lg); }
.bb-faq .ev-faq__item > p { margin-top: var(--space-xs); color: var(--color-muted); }
.bb-faq--layout-open .ev-faq__q { list-style: none; cursor: default; }
.bb-faq--layout-open .ev-faq__q::-webkit-details-marker { display: none; }
${WIDE} {
  .bb-faq--layout-side .bb-faq__inner { grid-template-columns: 1fr 2fr; align-items: start; }
  .bb-faq--layout-side .bb-faq__heading { text-align: left; }
}`,
    ),
    def(
      'registry-links',
      () => root([heading(s('registry-links').heading!), factsPart('gift-links', 'links')]),
      `.bb-registry-links .ev-gifts { display: grid; gap: var(--space-lg); justify-items: center; text-align: center; max-width: var(--size-prose); margin-inline: auto; }
.bb-registry-links .ev-links { display: flex; flex-wrap: wrap; gap: var(--space-sm); justify-content: center; }
.bb-registry-links--layout-pills .ev-button { border-radius: 999px; }
.bb-registry-links--layout-cards .ev-links { display: grid; width: 100%; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
.bb-registry-links--layout-cards .ev-button { justify-content: center; justify-self: stretch; padding: var(--space-lg); border-radius: var(--radius-card); background: var(--color-card); color: inherit; border: 1px solid var(--color-line); font-size: var(--text-md); }`,
    ),
    def(
      'photo-wall',
      () =>
        root([
          heading(s('photo-wall').heading!),
          t.component('slot-note', { part: 'slot', props: { slot: 'photo-wall' } }),
        ]),
      SLOT_CSS('photo-wall'),
    ),
    def(
      'guestbook-cta',
      () =>
        root([
          heading(s('guestbook-cta').heading!),
          body(s('guestbook-cta').text!),
          t.link({ part: 'button', href: '#guestbook', text: s('guestbook-cta').buttonLabel! }),
        ]),
      `.bb-guestbook-cta__inner { justify-items: center; text-align: center; max-width: var(--size-prose); }
.bb-guestbook-cta__button { display: inline-flex; padding: .7em 1.5em; border-radius: var(--radius-button); background: var(--color-accent); color: var(--color-on-accent-button, var(--color-on-accent)); text-decoration: none; font-weight: 600; }`,
    ),
    def(
      'rsvp',
      () =>
        root([
          heading(s('rsvp').heading!),
          body(s('rsvp').text!),
          t.component('slot-note', { part: 'slot', props: { slot: 'rsvp' } }),
        ]),
      `.bb-rsvp__inner { max-width: var(--size-prose); text-align: center; }
${SLOT_CSS('rsvp')}`,
    ),
    def(
      'divider',
      () => root([t.box({ part: 'rule' })]),
      `.bb-divider { padding-block: var(--space-xl); }
.bb-divider__rule { justify-self: center; color: var(--color-accent); }
.bb-divider--style-line .bb-divider__rule { width: min(12rem, 60%); border-top: 1px solid var(--color-line); }
.bb-divider--style-dots .bb-divider__rule::before { content: "• • •"; letter-spacing: .6em; }
.bb-divider--style-ornament .bb-divider__rule::before { content: "❦"; font-size: var(--text-3xl); }`,
      { style: ['line', 'dots', 'ornament'] },
    ),
    def(
      'footer',
      () =>
        root([
          t.component('monogram', { part: 'monogram' }),
          body(s('footer').note!, 'note'),
          t.component('credit', { part: 'credit' }),
        ]),
      `.bb-footer__inner { justify-items: center; text-align: center; gap: var(--space-sm); }
.bb-footer__monogram { font-family: var(--font-accent); font-size: var(--text-3xl); color: var(--color-accent); }
.bb-footer__note { font-family: var(--font-heading); font-size: var(--text-xl); }
.bb-footer__credit { color: var(--color-muted); font-size: var(--text-xs); }`,
    ),
  ];
}

function SLOT_CSS(type: string): string {
  return `.bb-${type} .ev-slot { padding: var(--space-xl); border: 1px dashed var(--color-line); border-radius: var(--radius-card); color: var(--color-muted); text-align: center; }`;
}

/** Block types in their library order. */
export const BLOCK_TYPES = BLOCKS.map((b) => b.type);
