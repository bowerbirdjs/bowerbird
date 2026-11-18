import {
  type BNode,
  type ComponentDef,
  defineComponent,
  type ElementSpec,
  type RenderContext,
  sectionRootOf,
} from '@bowerbirdjs/core';
import { z } from 'zod';
import { COPY, daysUntil, directionsUrl, formatDate, monogram } from './copy.js';
import type {
  Dresscode,
  EventInfo,
  FaqItem,
  Gifts,
  ScheduleItem,
  SiteLocale,
  Stay,
  Travel,
  Venue,
} from './facts.js';

/**
 * Components that show facts. They are pure: they read site data through the render context, so
 * one change to a fact reaches every section that shows it, in the editor and in the published
 * page alike. In the editor, every piece of fact text carries `data-bb-data` so a click can open
 * its field.
 */

export const event = (ctx: RenderContext): EventInfo =>
  (ctx.data('event') as EventInfo | undefined) ?? {
    title: '',
    date: null,
    locale: 'en',
    occasion: 'wedding',
  };
const locale = (ctx: RenderContext): SiteLocale => event(ctx).locale;
const copy = (ctx: RenderContext) => COPY[locale(ctx)];
/** An editor mark: which fact this element shows. */
const mark = (ctx: RenderContext, path: string) =>
  ctx.mode === 'editor' ? { 'data-bb-data': path } : {};
const hint = (text: string): ElementSpec => ({
  tag: 'p',
  attrs: { class: 'ev-hint' },
  text,
});
const layoutOf = (node: BNode, ctx: RenderContext): string | undefined =>
  sectionRootOf(ctx.view, node.id)?.section?.variant.layout;

const facts = <T>(ctx: RenderContext, key: string): T | undefined => ctx.data(key) as T | undefined;

/** Whether a section has nothing to show (published pages hide it; the editor says why). */
export function isSectionEmpty(node: BNode, ctx: RenderContext): boolean {
  const type = node.section?.name;
  switch (type) {
    case 'countdown': {
      const date = event(ctx).date;
      return !date || daysUntil(date) < 0;
    }
    case 'gallery':
      return !ctx.view
        .nodeIds()
        .some((id) => id.startsWith(`${node.id}/`) && ctx.view.node(id)?.type === 'image');
    case 'schedule':
      return !facts<ScheduleItem[]>(ctx, 'schedule')?.length;
    case 'location':
      return !facts<Venue[]>(ctx, 'venues')?.length;
    case 'travel': {
      const t = facts<Travel>(ctx, 'travel');
      return !t?.text && !t?.parking && !facts<Stay[]>(ctx, 'stays')?.length;
    }
    case 'dresscode': {
      const d = facts<Dresscode>(ctx, 'dresscode');
      return !d?.style && !d?.text && !d?.colors.length;
    }
    case 'faq':
      return !facts<FaqItem[]>(ctx, 'faq')?.length;
    case 'registry-links': {
      const g = facts<Gifts>(ctx, 'gifts');
      return !g?.text && !g?.links.length;
    }
    default:
      return false;
  }
}

const none = z.object({});

/** A section's root: an anchor for the site menu; hidden when it has nothing to show. */
const eventSection = defineComponent({
  name: 'ev-section',
  kind: 'primitive',
  description: 'The root of an event section.',
  props: none,
  children: true,
  insertable: false,
  render: (node, ctx) => {
    const empty = isSectionEmpty(node, ctx);
    return {
      tag: 'section',
      attrs: {
        id: node.id,
        hidden: empty && ctx.mode === 'published',
        'data-empty': empty && ctx.mode === 'editor' ? 'true' : undefined,
      },
    };
  },
});

const eventDate = defineComponent({
  name: 'event-date',
  kind: 'primitive',
  description: 'A date; empty shows the event’s date, so a change in the details reaches it.',
  props: z.object({
    date: z
      .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .default('')
      .describe('YYYY-MM-DD, or empty for the event date'),
  }),
  children: false,
  insertable: false,
  contentProps: ['date'],
  render: (node, ctx) => {
    const own = typeof node.props.date === 'string' && node.props.date ? node.props.date : null;
    const date = own ?? event(ctx).date;
    return {
      tag: 'p',
      ...(own ? {} : { attrs: mark(ctx, 'event.date') }),
      text: date ? formatDate(date, locale(ctx)) : '',
    };
  },
});

const monogramMark = defineComponent({
  name: 'monogram',
  kind: 'primitive',
  description: 'The initials of the two names in the event title.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => ({
    tag: 'p',
    attrs: { 'aria-hidden': 'true', ...mark(ctx, 'event.title') },
    text: monogram(event(ctx).title),
  }),
});

const countdownDays = defineComponent({
  name: 'countdown-days',
  kind: 'primitive',
  description: 'Days until the event.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const date = event(ctx).date;
    const days = date ? daysUntil(date) : -1;
    return {
      tag: 'p',
      attrs: mark(ctx, 'event.date'),
      text: days > 0 ? copy(ctx).daysLeft(days) : days === 0 ? copy(ctx).today : '',
    };
  },
});

const scheduleItems = defineComponent({
  name: 'schedule-items',
  kind: 'primitive',
  description: 'The schedule from the event details.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const items = facts<ScheduleItem[]>(ctx, 'schedule') ?? [];
    const venues = facts<Venue[]>(ctx, 'venues') ?? [];
    if (!items.length)
      return ctx.mode === 'editor' ? hint(copy(ctx).empty.schedule) : { tag: 'div' };
    return {
      tag: 'ol',
      attrs: { class: 'ev-schedule' },
      children: items.map((item, i) => {
        const venue = item.venue ? venues.find((v) => v.id === item.venue) : undefined;
        return {
          tag: 'li',
          attrs: { class: 'ev-schedule__item' },
          children: [
            {
              tag: 'time',
              attrs: { class: 'ev-schedule__time', ...mark(ctx, `schedule.${i}.time`) },
              text: copy(ctx).oclock(item.time),
            },
            {
              tag: 'div',
              attrs: { class: 'ev-schedule__body' },
              children: [
                {
                  tag: 'h3',
                  attrs: { class: 'ev-schedule__title', ...mark(ctx, `schedule.${i}.title`) },
                  text: item.title,
                },
                ...(item.text
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-text', ...mark(ctx, `schedule.${i}.text`) },
                        text: item.text,
                      },
                    ]
                  : []),
                ...(venue
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-muted', ...mark(ctx, `schedule.${i}.venue`) },
                        text: venue.name,
                      },
                    ]
                  : []),
              ],
            },
          ],
        };
      }),
    };
  },
});

const venueCards = defineComponent({
  name: 'venue-cards',
  kind: 'primitive',
  description: 'Every venue as a card with directions.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const venues = facts<Venue[]>(ctx, 'venues') ?? [];
    if (!venues.length)
      return ctx.mode === 'editor' ? hint(copy(ctx).empty.venues) : { tag: 'div' };
    return {
      tag: 'div',
      attrs: { class: 'ev-cards' },
      children: venues.map((v, i) => {
        // A pasted map link wins; an address gets a maps search; no address, no link.
        const href = v.mapUrl ?? (v.address ? directionsUrl(v.name, v.address) : undefined);
        return {
          tag: 'article',
          attrs: { class: 'ev-card' },
          children: [
            ...(v.role
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-eyebrow', ...mark(ctx, `venues.${i}.role`) },
                    text: v.role,
                  },
                ]
              : []),
            {
              tag: 'h3',
              attrs: { class: 'ev-card__title', ...mark(ctx, `venues.${i}.name`) },
              text: v.name,
            },
            ...(v.address
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-text', ...mark(ctx, `venues.${i}.address`) },
                    text: v.address,
                  },
                ]
              : []),
            ...(v.note
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-text ev-muted', ...mark(ctx, `venues.${i}.note`) },
                    text: v.note,
                  },
                ]
              : []),
            ...(href
              ? [
                  {
                    tag: 'a',
                    attrs: {
                      class: 'ev-button',
                      href,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    },
                    text: copy(ctx).directions,
                  },
                ]
              : []),
          ],
        };
      }),
    };
  },
});

const travelInfo = defineComponent({
  name: 'travel-info',
  kind: 'primitive',
  description: 'Getting there, parking and places to stay.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const travel = facts<Travel>(ctx, 'travel') ?? {};
    const stays = facts<Stay[]>(ctx, 'stays') ?? [];
    const c = copy(ctx);
    const blocks: ElementSpec[] = [];
    if (travel.text)
      blocks.push({
        tag: 'div',
        attrs: { class: 'ev-travel__block' },
        children: [
          { tag: 'h3', attrs: { class: 'ev-subheading' }, text: c.gettingThere },
          { tag: 'p', attrs: { class: 'ev-text', ...mark(ctx, 'travel.text') }, text: travel.text },
        ],
      });
    if (travel.parking)
      blocks.push({
        tag: 'div',
        attrs: { class: 'ev-travel__block' },
        children: [
          { tag: 'h3', attrs: { class: 'ev-subheading' }, text: c.parking },
          {
            tag: 'p',
            attrs: { class: 'ev-text', ...mark(ctx, 'travel.parking') },
            text: travel.parking,
          },
        ],
      });
    if (stays.length)
      blocks.push({
        tag: 'div',
        attrs: { class: 'ev-travel__block ev-travel__stays' },
        children: [
          { tag: 'h3', attrs: { class: 'ev-subheading' }, text: c.stays },
          {
            tag: 'ul',
            attrs: { class: 'ev-stays' },
            children: stays.map((s, i) => ({
              tag: 'li',
              attrs: { class: 'ev-stay' },
              children: [
                s.url
                  ? {
                      tag: 'a',
                      attrs: {
                        href: s.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        class: 'ev-stay__name',
                        ...mark(ctx, `stays.${i}.name`),
                      },
                      text: s.name,
                    }
                  : {
                      tag: 'p',
                      attrs: { class: 'ev-stay__name', ...mark(ctx, `stays.${i}.name`) },
                      text: s.name,
                    },
                ...(s.address
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-muted', ...mark(ctx, `stays.${i}.address`) },
                        text: s.address,
                      },
                    ]
                  : []),
                ...(s.note
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-text', ...mark(ctx, `stays.${i}.note`) },
                        text: s.note,
                      },
                    ]
                  : []),
              ],
            })),
          },
        ],
      });
    if (!blocks.length) return ctx.mode === 'editor' ? hint(c.empty.travel) : { tag: 'div' };
    return { tag: 'div', attrs: { class: 'ev-travel' }, children: blocks };
  },
});

const dresscodeInfo = defineComponent({
  name: 'dresscode-info',
  kind: 'primitive',
  description: 'The dress code: a style line, a text and named colours.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const d = facts<Dresscode>(ctx, 'dresscode');
    if (!d || (!d.style && !d.text && !d.colors.length))
      return ctx.mode === 'editor' ? hint(copy(ctx).empty.dresscode) : { tag: 'div' };
    return {
      tag: 'div',
      attrs: { class: 'ev-dress' },
      children: [
        ...(d.style
          ? [
              {
                tag: 'p',
                attrs: { class: 'ev-dress__style', ...mark(ctx, 'dresscode.style') },
                text: d.style,
              },
            ]
          : []),
        ...(d.text
          ? [
              {
                tag: 'p',
                attrs: { class: 'ev-text', ...mark(ctx, 'dresscode.text') },
                text: d.text,
              },
            ]
          : []),
        ...(d.colors.length
          ? [
              {
                tag: 'ul',
                attrs: { class: 'ev-swatches', 'aria-label': copy(ctx).colours },
                children: d.colors.map((col, i) => ({
                  tag: 'li',
                  attrs: { class: 'ev-swatch', ...mark(ctx, `dresscode.colors.${i}.name`) },
                  // The colour reaches CSS only as a validated custom property.
                  vars: { '--swatch': col.hex },
                  text: col.name,
                })),
              },
            ]
          : []),
      ],
    };
  },
});

const faqItems = defineComponent({
  name: 'faq-items',
  kind: 'primitive',
  description: 'Questions and answers from the event details.',
  props: none,
  children: false,
  insertable: false,
  render: (node, ctx) => {
    const items = facts<FaqItem[]>(ctx, 'faq') ?? [];
    if (!items.length) return ctx.mode === 'editor' ? hint(copy(ctx).empty.faq) : { tag: 'div' };
    const open = layoutOf(node, ctx) === 'open';
    return {
      tag: 'div',
      attrs: { class: 'ev-faq' },
      children: items.map((item, i) => ({
        tag: 'details',
        attrs: { class: 'ev-faq__item', open },
        children: [
          {
            tag: 'summary',
            attrs: { class: 'ev-faq__q', ...mark(ctx, `faq.${i}.q`) },
            text: item.q,
          },
          { tag: 'p', attrs: { class: 'ev-text', ...mark(ctx, `faq.${i}.a`) }, text: item.a },
        ],
      })),
    };
  },
});

const giftLinks = defineComponent({
  name: 'gift-links',
  kind: 'primitive',
  description: 'The gift text and links from the event details.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => {
    const g = facts<Gifts>(ctx, 'gifts');
    if (!g || (!g.text && !g.links.length))
      return ctx.mode === 'editor' ? hint(copy(ctx).empty.gifts) : { tag: 'div' };
    return {
      tag: 'div',
      attrs: { class: 'ev-gifts' },
      children: [
        ...(g.text
          ? [{ tag: 'p', attrs: { class: 'ev-text', ...mark(ctx, 'gifts.text') }, text: g.text }]
          : []),
        ...(g.links.length
          ? [
              {
                tag: 'ul',
                attrs: { class: 'ev-links' },
                children: g.links.map((l, i) => ({
                  tag: 'li',
                  children: [
                    {
                      tag: 'a',
                      attrs: {
                        class: 'ev-button',
                        href: l.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        ...mark(ctx, `gifts.links.${i}.label`),
                      },
                      text: l.label,
                    },
                  ],
                })),
              },
            ]
          : []),
      ],
    };
  },
});

/** Live content the host app renders (the RSVP form, the guests' photo wall). */
const slotNote = defineComponent({
  name: 'slot-note',
  kind: 'primitive',
  description: 'Where the host app shows live content.',
  props: z.object({ slot: z.enum(['rsvp', 'photo-wall']) }),
  children: false,
  insertable: false,
  // Published: an empty box the host app fills with the live form or photos.
  render: (node, ctx) =>
    ctx.mode === 'editor'
      ? {
          tag: 'div',
          attrs: { class: 'ev-slot', 'data-slot': String(node.props.slot) },
          text: node.props.slot === 'rsvp' ? copy(ctx).rsvpNote : copy(ctx).photoWallNote,
        }
      : { tag: 'div', attrs: { 'data-slot': String(node.props.slot) } },
});

const credit = defineComponent({
  name: 'credit',
  kind: 'primitive',
  description: 'The footer credit.',
  props: none,
  children: false,
  insertable: false,
  render: (_node, ctx) => ({ tag: 'p', text: copy(ctx).credit }),
});

export const COMPONENTS: ComponentDef[] = [
  eventSection,
  eventDate,
  monogramMark,
  countdownDays,
  scheduleItems,
  venueCards,
  travelInfo,
  dresscodeInfo,
  faqItems,
  giftLinks,
  slotNote,
  credit,
];
