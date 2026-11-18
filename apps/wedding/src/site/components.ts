import {
  type AddData,
  type BNode,
  type ComponentDef,
  defineComponent,
  type EditField,
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
 * page alike. Every piece of fact text says which data it shows (`edit`), so it can be edited
 * right on the page; list entries say which item they are (`item`), so they can be moved, copied
 * and removed there too.
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
/** An editor-only button that adds what's missing (see `ElementSpec.add`). */
interface Adder {
  label: string;
  add: AddData;
}
const addRow = (ctx: RenderContext, adds: Adder[]): ElementSpec[] =>
  ctx.mode === 'editor' && adds.length
    ? [
        {
          tag: 'p',
          attrs: { class: 'ev-add-row' },
          children: adds.map((a) => ({
            tag: 'span',
            attrs: { class: 'ev-add' },
            add: a.add,
            text: `+ ${a.label}`,
          })),
        },
      ]
    : [];
/** What a section shows with no facts: nothing when published; in the editor, buttons to add them. */
const emptyState = (ctx: RenderContext, text: string, adds: Adder[]): ElementSpec =>
  ctx.mode === 'editor'
    ? {
        tag: 'div',
        attrs: { class: 'ev-hint' },
        children: [{ tag: 'p', text }, ...addRow(ctx, adds)],
      }
    : { tag: 'div' };
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

/** Site data an element shows, editable on the page (see `ElementSpec.edit`). */
const field = (
  path: string,
  label: string,
  value: string | undefined,
  more: Omit<EditField, 'path' | 'label' | 'value'> = {},
): EditField => ({ path, label, value: value ?? '', ...more });

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
    const date = own ?? event(ctx).date ?? null;
    return {
      tag: 'p',
      ...(own ? {} : { edit: field('event.date', 'Event date', date ?? '', { kind: 'date' }) }),
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
    attrs: { 'aria-hidden': 'true' },
    edit: field('event.title', 'Names', event(ctx).title, { required: true }),
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
    const date = event(ctx).date ?? null;
    const days = date ? daysUntil(date) : -1;
    return {
      tag: 'p',
      edit: field('event.date', 'Event date', date ?? '', { kind: 'date' }),
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
    const c = copy(ctx);
    if (!items.length)
      return emptyState(ctx, c.empty.schedule, [
        {
          label: c.add.schedule,
          add: { path: 'schedule', value: { time: '12:00', title: c.starter.item }, edit: 'title' },
        },
      ]);
    const places: [string, string][] = [
      ['', '—'],
      ...venues.map((v) => [v.id, v.name] as [string, string]),
    ];
    return {
      tag: 'ol',
      attrs: { class: 'ev-schedule' },
      children: items.map((item, i) => {
        const venue = item.venue ? venues.find((v) => v.id === item.venue) : undefined;
        const at = `schedule.${i}`;
        return {
          tag: 'li',
          attrs: { class: 'ev-schedule__item' },
          item: { path: at },
          children: [
            {
              tag: 'time',
              attrs: { class: 'ev-schedule__time' },
              edit: field(`${at}.time`, 'Time', item.time, { kind: 'time', required: true }),
              text: copy(ctx).oclock(item.time),
            },
            {
              tag: 'div',
              attrs: { class: 'ev-schedule__body' },
              children: [
                {
                  tag: 'h3',
                  attrs: { class: 'ev-schedule__title' },
                  edit: field(`${at}.title`, 'What', item.title, { required: true }),
                  text: item.title,
                },
                ...(item.text
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-text' },
                        edit: field(`${at}.text`, 'Details', item.text, { kind: 'multiline' }),
                        text: item.text,
                      },
                    ]
                  : []),
                ...(venue || (ctx.mode === 'editor' && venues.length)
                  ? [
                      {
                        tag: 'p',
                        attrs: { class: 'ev-muted' },
                        edit: field(`${at}.venue`, 'Where', item.venue, {
                          kind: 'select',
                          options: places,
                        }),
                        // In the editor an item without a venue still offers one to pick.
                        text: venue?.name ?? '—',
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
    const c = copy(ctx);
    if (!venues.length)
      return emptyState(ctx, c.empty.venues, [
        {
          label: c.add.venue,
          add: { path: 'venues', value: { id: 'venue-1', name: c.starter.venue }, edit: 'name' },
        },
      ]);
    return {
      tag: 'div',
      attrs: { class: 'ev-cards' },
      children: venues.map((v, i) => {
        const at = `venues.${i}`;
        // A pasted map link wins; an address gets a maps search; no address, no link.
        const href = v.mapUrl ?? (v.address ? directionsUrl(v.name, v.address) : undefined);
        return {
          tag: 'article',
          attrs: { class: 'ev-card' },
          // Schedule items name venues by id, so a copy gets a new one.
          item: { path: at, unique: ['id'] },
          children: [
            ...(v.role
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-eyebrow' },
                    edit: field(`${at}.role`, 'Role', v.role),
                    text: v.role,
                  },
                ]
              : []),
            {
              tag: 'h3',
              attrs: { class: 'ev-card__title' },
              edit: field(`${at}.name`, 'Name', v.name, { required: true }),
              text: v.name,
            },
            ...(v.address
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-text' },
                    edit: field(`${at}.address`, 'Address', v.address, { kind: 'multiline' }),
                    text: v.address,
                  },
                ]
              : []),
            ...(v.note
              ? [
                  {
                    tag: 'p',
                    attrs: { class: 'ev-text ev-muted' },
                    edit: field(`${at}.note`, 'Note', v.note, { kind: 'multiline' }),
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
                    edit: field(
                      `${at}.mapUrl`,
                      'Map link (empty: directions from the address)',
                      v.mapUrl,
                      { kind: 'url' },
                    ),
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
    const block = (title: string, path: string, value: string) => ({
      tag: 'div',
      attrs: { class: 'ev-travel__block' },
      children: [
        { tag: 'h3', attrs: { class: 'ev-subheading' }, text: title },
        {
          tag: 'p',
          attrs: { class: 'ev-text' },
          edit: field(path, title, value, { kind: 'multiline' }),
          text: value,
        },
      ],
    });
    if (travel.text) blocks.push(block(c.gettingThere, 'travel.text', travel.text));
    if (travel.parking) blocks.push(block(c.parking, 'travel.parking', travel.parking));
    if (stays.length)
      blocks.push({
        tag: 'div',
        attrs: { class: 'ev-travel__block ev-travel__stays' },
        children: [
          { tag: 'h3', attrs: { class: 'ev-subheading' }, text: c.stays },
          {
            tag: 'ul',
            attrs: { class: 'ev-stays' },
            children: stays.map((s, i) => {
              const at = `stays.${i}`;
              const name = [
                field(`${at}.name`, 'Name', s.name, { required: true }),
                field(`${at}.url`, 'Website', s.url, { kind: 'url' }),
              ];
              return {
                tag: 'li',
                attrs: { class: 'ev-stay' },
                item: { path: at },
                children: [
                  s.url
                    ? {
                        tag: 'a',
                        attrs: {
                          href: s.url,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          class: 'ev-stay__name',
                        },
                        edit: name,
                        text: s.name,
                      }
                    : { tag: 'p', attrs: { class: 'ev-stay__name' }, edit: name, text: s.name },
                  ...(s.address
                    ? [
                        {
                          tag: 'p',
                          attrs: { class: 'ev-muted' },
                          edit: field(`${at}.address`, 'Address', s.address),
                          text: s.address,
                        },
                      ]
                    : []),
                  ...(s.note
                    ? [
                        {
                          tag: 'p',
                          attrs: { class: 'ev-text' },
                          edit: field(`${at}.note`, 'Note', s.note, { kind: 'multiline' }),
                          text: s.note,
                        },
                      ]
                    : []),
                ],
              };
            }),
          },
        ],
      });
    const adds: Adder[] = [
      ...(travel.text
        ? []
        : [
            {
              label: c.add.travel,
              add: { path: 'travel.text', value: c.starter.travel, edit: '' },
            },
          ]),
      ...(travel.parking
        ? []
        : [
            {
              label: c.add.parking,
              add: { path: 'travel.parking', value: c.starter.parking, edit: '' },
            },
          ]),
      ...(stays.length
        ? []
        : [
            {
              label: c.add.stay,
              add: { path: 'stays', value: { name: c.starter.stay }, edit: 'name' },
            },
          ]),
    ];
    if (!blocks.length) return emptyState(ctx, c.empty.travel, adds);
    return {
      tag: 'div',
      attrs: { class: 'ev-travel' },
      children: [...blocks, ...addRow(ctx, adds)],
    };
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
    const c = copy(ctx);
    const adds: Adder[] = [
      ...(d?.style
        ? []
        : [
            {
              label: c.add.style,
              add: { path: 'dresscode.style', value: c.starter.style, edit: '' },
            },
          ]),
      ...(d?.text
        ? []
        : [
            { label: c.add.text, add: { path: 'dresscode.text', value: c.starter.text, edit: '' } },
          ]),
      ...(d?.colors.length
        ? []
        : [
            {
              label: c.add.colour,
              add: {
                path: 'dresscode.colors',
                value: { hex: '#c9a27e', name: c.starter.colour },
                edit: 'name',
              },
            },
          ]),
    ];
    if (!d || (!d.style && !d.text && !d.colors.length))
      return emptyState(ctx, c.empty.dresscode, adds);
    return {
      tag: 'div',
      attrs: { class: 'ev-dress' },
      children: [
        ...(d.style
          ? [
              {
                tag: 'p',
                attrs: { class: 'ev-dress__style' },
                edit: field('dresscode.style', 'Style', d.style),
                text: d.style,
              },
            ]
          : []),
        ...(d.text
          ? [
              {
                tag: 'p',
                attrs: { class: 'ev-text' },
                edit: field('dresscode.text', 'Text', d.text, { kind: 'multiline' }),
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
                  attrs: { class: 'ev-swatch' },
                  item: { path: `dresscode.colors.${i}` },
                  edit: [
                    field(`dresscode.colors.${i}.name`, 'Name', col.name, { required: true }),
                    field(`dresscode.colors.${i}.hex`, 'Colour', col.hex, {
                      kind: 'color',
                      required: true,
                    }),
                  ],
                  // The colour reaches CSS only as a validated custom property.
                  vars: { '--swatch': col.hex },
                  text: col.name,
                })),
              },
            ]
          : []),
        ...addRow(ctx, adds),
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
    const c = copy(ctx);
    if (!items.length)
      return emptyState(ctx, c.empty.faq, [
        {
          label: c.add.faq,
          add: { path: 'faq', value: { q: c.starter.q, a: c.starter.a }, edit: 'q' },
        },
      ]);
    const open = layoutOf(node, ctx) === 'open';
    return {
      tag: 'div',
      attrs: { class: 'ev-faq' },
      children: items.map((item, i) => ({
        tag: 'details',
        attrs: { class: 'ev-faq__item', open },
        item: { path: `faq.${i}` },
        children: [
          {
            tag: 'summary',
            attrs: { class: 'ev-faq__q' },
            // The question is a span, so editing it doesn't toggle the answer.
            children: [
              {
                tag: 'span',
                edit: field(`faq.${i}.q`, 'Question', item.q, { required: true }),
                text: item.q,
              },
            ],
          },
          {
            tag: 'p',
            attrs: { class: 'ev-text' },
            edit: field(`faq.${i}.a`, 'Answer', item.a, { kind: 'multiline', required: true }),
            text: item.a,
          },
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
    const c = copy(ctx);
    const adds: Adder[] = [
      ...(g?.text
        ? []
        : [{ label: c.add.text, add: { path: 'gifts.text', value: c.starter.text, edit: '' } }]),
      ...(g?.links.length
        ? []
        : [
            {
              label: c.add.link,
              add: {
                path: 'gifts.links',
                value: { label: c.starter.link, url: 'https://example.com' },
                edit: 'label',
              },
            },
          ]),
    ];
    if (!g || (!g.text && !g.links.length)) return emptyState(ctx, c.empty.gifts, adds);
    return {
      tag: 'div',
      attrs: { class: 'ev-gifts' },
      children: [
        ...(g.text
          ? [
              {
                tag: 'p',
                attrs: { class: 'ev-text' },
                edit: field('gifts.text', 'Text', g.text, { kind: 'multiline' }),
                text: g.text,
              },
            ]
          : []),
        ...(g.links.length
          ? [
              {
                tag: 'ul',
                attrs: { class: 'ev-links' },
                children: g.links.map((l, i) => ({
                  tag: 'li',
                  item: { path: `gifts.links.${i}` },
                  children: [
                    {
                      tag: 'a',
                      attrs: {
                        class: 'ev-button',
                        href: l.url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      edit: [
                        field(`gifts.links.${i}.label`, 'Label', l.label, { required: true }),
                        field(`gifts.links.${i}.url`, 'Link', l.url, {
                          kind: 'url',
                          required: true,
                        }),
                      ],
                      text: l.label,
                    },
                  ],
                })),
              },
            ]
          : []),
        ...addRow(ctx, adds),
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
