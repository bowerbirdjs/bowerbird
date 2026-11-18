import {
  type Actor,
  createEmptyDoc,
  createRegistry,
  createStore,
  DocIndex,
  type Registry,
  type SiteDoc,
  type Store,
} from '@bowerbirdjs/core';
import { escapeAttr, escapeHtml, renderPage } from '@bowerbirdjs/html';
import { BLOCKS, blockInfo, createBlocks } from './blocks.js';
import { COMPONENTS } from './components.js';
import { COPY } from './copy.js';
import { BASE_TOKENS, DEFAULT_STYLE, STYLE, styleOps } from './designs.js';
import { type EventFacts, FACTS, type FactGroup, type SiteLocale } from './facts.js';

export const SETUP: Actor = { kind: 'system', id: 'setup', name: 'Setup' };

/** Registries are per event language: starter text in new sections is written in it. */
const registries = new Map<SiteLocale, Registry>();
export function eventRegistry(locale: SiteLocale): Registry {
  let registry = registries.get(locale);
  if (!registry) {
    registry = createRegistry({
      components: COMPONENTS,
      sections: createBlocks(locale),
      data: [...FACTS, STYLE],
    });
    registries.set(locale, registry);
  }
  return registry;
}

/** The demo event, in each language. */
export const DEMO: Record<SiteLocale, EventFacts> = {
  de: {
    event: { title: 'Lena & Jonas', date: '2027-06-12', locale: 'de', occasion: 'wedding' },
    venues: [
      {
        id: 'rathaus',
        role: 'Trauung',
        name: 'Altes Rathaus Sonnenfeld',
        address: 'Marktplatz 1\n12345 Sonnenfeld',
      },
      {
        id: 'lindenhof',
        role: 'Feier',
        name: 'Gut Lindenhof',
        address: 'Am Mühlenteich 3\n12345 Sonnenfeld',
        note: 'Der Hof liegt am Ende der Allee. Folgt den Lichterketten.',
      },
    ],
    schedule: [
      {
        time: '14:00',
        title: 'Trauung',
        venue: 'rathaus',
        text: 'Bitte seid eine Viertelstunde vorher da.',
      },
      { time: '15:30', title: 'Sektempfang', venue: 'lindenhof' },
      { time: '18:00', title: 'Abendessen', venue: 'lindenhof' },
      { time: '21:00', title: 'Tanz', venue: 'lindenhof', text: 'Bis die Kerzen aus sind.' },
    ],
    travel: {
      text: 'Mit dem Zug bis Sonnenfeld, von dort sind es zehn Minuten zu Fuß. Ab 23 Uhr fährt ein Shuttle zurück zum Bahnhof.',
      parking: 'Auf dem Hof gibt es genug Parkplätze.',
    },
    stays: [
      {
        name: 'Landgasthof Zur Linde',
        address: 'Dorfstraße 8, 12345 Sonnenfeld',
        url: 'https://example.com/linde',
        note: 'Stichwort Lena & Jonas, bis zum 1. April.',
      },
      { name: 'Pension Am See', address: 'Seeweg 2, 12345 Sonnenfeld' },
    ],
    dresscode: {
      style: 'Sommerlich festlich',
      text: 'Bequeme Schuhe sind eine gute Idee, der Hof hat Kies und Wiese.',
      colors: [
        { hex: '#c9a27e', name: 'Sand' },
        { hex: '#8fa58c', name: 'Salbei' },
        { hex: '#d9b8c4', name: 'Altrosa' },
      ],
    },
    gifts: {
      text: 'Das größte Geschenk ist, dass ihr da seid. Wer uns trotzdem etwas schenken möchte: Wir sparen auf eine Reise nach Portugal.',
      links: [{ label: 'Zur Reisekasse', url: 'https://example.com/reisekasse' }],
    },
    faq: [
      {
        q: 'Dürfen Kinder mitkommen?',
        a: 'Ja, sehr gerne. Für die Kleinen gibt es eine Spielecke.',
      },
      { q: 'Gibt es vegetarisches Essen?', a: 'Ja. Sagt uns bei der Zusage, was ihr nicht esst.' },
      { q: 'Bis wann sollen wir zusagen?', a: 'Bis zum 1. Mai.' },
    ],
  },
  en: {
    event: { title: 'Maya & Sam', date: '2027-09-04', locale: 'en', occasion: 'wedding' },
    venues: [
      {
        id: 'chapel',
        role: 'Ceremony',
        name: 'St Anne’s Chapel',
        address: '1 Church Lane\nLittle Hollow',
      },
      {
        id: 'barn',
        role: 'Reception',
        name: 'Hollow Farm Barn',
        address: 'Mill Road\nLittle Hollow',
        note: 'Follow the lanterns up the lane.',
      },
    ],
    schedule: [
      {
        time: '13:30',
        title: 'Ceremony',
        venue: 'chapel',
        text: 'Please arrive fifteen minutes early.',
      },
      { time: '15:00', title: 'Drinks and canapés', venue: 'barn' },
      { time: '18:00', title: 'Dinner', venue: 'barn' },
      { time: '20:30', title: 'Dancing', venue: 'barn' },
    ],
    travel: {
      text: 'The nearest station is Hollow Junction, a ten-minute taxi ride away. A shuttle leaves for the station at 23:30.',
      parking: 'There is plenty of parking at the farm.',
    },
    stays: [
      {
        name: 'The Swan Inn',
        address: 'High Street, Little Hollow',
        url: 'https://example.com/swan',
        note: 'Mention Maya & Sam by 1 June.',
      },
    ],
    dresscode: {
      style: 'Garden formal',
      text: 'Flat shoes are a good idea: the barn sits on a meadow.',
      colors: [
        { hex: '#c9a27e', name: 'Sand' },
        { hex: '#8fa58c', name: 'Sage' },
      ],
    },
    gifts: {
      text: 'Having you there is the best gift. If you’d like to give something anyway, we’re saving for a trip to Portugal.',
      links: [{ label: 'Our travel fund', url: 'https://example.com/travel-fund' }],
    },
    faq: [
      { q: 'Can we bring our children?', a: 'Yes, please do. There will be a play corner.' },
      { q: 'Is there vegetarian food?', a: 'Yes. Tell us what you don’t eat when you reply.' },
    ],
  },
};

/** What a new event's page starts with, by occasion (the wedding set is the full one). */
export const STARTER_SECTIONS = [
  'hero',
  'countdown',
  'story',
  'schedule',
  'location',
  'travel',
  'dresscode',
  'faq',
  'registry-links',
  'rsvp',
  'footer',
];

/** Facts a bound section fills an empty group with when it is added (never a fake address). */
export const STARTER_FACTS: Record<SiteLocale, Partial<Omit<EventFacts, 'event'>>> = {
  de: {
    schedule: [
      { time: '14:00', title: 'Trauung' },
      { time: '16:00', title: 'Kaffee und Kuchen' },
      { time: '19:00', title: 'Abendessen' },
    ],
    faq: [{ q: 'Dürfen Kinder mitkommen?', a: 'Ja, sehr gerne.' }],
    dresscode: { style: 'Festlich', colors: [] },
    gifts: { text: 'Das größte Geschenk ist, dass ihr da seid.', links: [] },
  },
  en: {
    schedule: [
      { time: '14:00', title: 'Ceremony' },
      { time: '16:00', title: 'Tea and cake' },
      { time: '19:00', title: 'Dinner' },
    ],
    faq: [{ q: 'Can we bring our children?', a: 'Yes, please do.' }],
    dresscode: { style: 'Formal', colors: [] },
    gifts: { text: 'Having you there is the best gift.', links: [] },
  },
};

/** A complete event site: tokens, the starter page and the event details, all written through ops. */
export function createEventSite(facts: EventFacts = DEMO.de): Store {
  const locale = facts.event.locale;
  const registry = eventRegistry(locale);
  const tokens: Record<string, unknown> = {};
  const store = createStore({ registry, doc: createEmptyDoc({ tokens }) });
  const set = (ops: unknown[]) => {
    const result = store.apply({ actor: SETUP, ops });
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('\n'));
  };
  set(Object.entries(BASE_TOKENS).map(([path, value]) => ({ op: 'token.set', path, value })));
  set(Object.entries(facts).map(([key, value]) => ({ op: 'data.set', key, value })));
  set([
    { op: 'page.create', id: 'home', path: '/', title: facts.event.title },
    ...STARTER_SECTIONS.map((section) => ({
      op: 'section.insert',
      section,
      page: 'home',
      ...(section === 'hero' ? { content: { heading: { text: facts.event.title } } } : {}),
    })),
  ]);
  set(styleOps(store.view, DEFAULT_STYLE));
  // A fresh site starts with an empty history: setup isn't something to undo.
  return createStore({ registry, doc: store.doc });
}

/** The section's heading text, for the site menu. */
function headingOf(doc: SiteDoc, sectionId: string): string | undefined {
  const text = doc.nodes[`${sectionId}/heading`]?.props.text;
  return typeof text === 'string' && text.trim() ? text.trim() : undefined;
}

/** The published page: the rendered sections with a site menu built from them. */
export function renderSite(doc: SiteDoc, registry: Registry): string {
  const view = new DocIndex(doc);
  const page = view.pages()[0];
  if (!page) return '<!doctype html><title>No page</title>';
  const facts = view.data('event') as EventFacts['event'] | undefined;
  const locale: SiteLocale = facts?.locale ?? 'en';
  const { html, css } = renderPage(doc, registry, page.id);
  const sections = view.children(page.rootId);
  const menu = sections
    .filter((s) => s.section && blockInfo(s.section.name)?.menu && headingOf(doc, s.id))
    .map((s) => `<a href="#${escapeAttr(s.id)}">${escapeHtml(headingOf(doc, s.id)!)}</a>`);
  return [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(facts?.title ?? page.title)}</title>`,
    `<style>${css.replace(/<\/style/gi, '<\\/style')}
html { scroll-behavior: smooth; }
body { margin: 0; }
.site-menu { position: sticky; top: 0; z-index: 10; display: flex; gap: 1.25rem; justify-content: safe center; overflow-x: auto; white-space: nowrap; padding: .8rem 1rem; font: 500 .875rem/1.4 var(--font-body, system-ui); background: var(--color-surface); color: var(--color-on-surface); border-bottom: 1px solid var(--color-line); }
.site-menu a { color: inherit; text-decoration: none; }
.site-menu a:hover { color: var(--color-accent); }
</style>`,
    '</head>',
    '<body>',
    menu.length
      ? `<nav class="site-menu bb-page" aria-label="${escapeAttr(COPY[locale].menu)}">${menu.join('')}</nav>`
      : '',
    html,
    '</body>',
    '</html>',
  ].join('\n');
}

/** Block types a section of `type` shows facts for, with their starter values if empty. */
export function starterFactOps(store: Store, type: string): unknown[] {
  const locale = ((store.view.data('event') as EventFacts['event'] | undefined)?.locale ??
    'en') as SiteLocale;
  const ops: unknown[] = [];
  for (const group of blockInfo(type)?.facts ?? []) {
    const current = store.view.data(group);
    const empty = current === undefined || (Array.isArray(current) && current.length === 0);
    const starter = STARTER_FACTS[locale][group as FactGroup];
    if (empty && starter !== undefined) ops.push({ op: 'data.set', key: group, value: starter });
  }
  return ops;
}

export const EVENT_BLOCK_TYPES = BLOCKS.map((b) => b.type);
