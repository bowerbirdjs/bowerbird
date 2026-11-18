import { type DataDef, defineData } from '@bowerbirdjs/core';
import { z } from 'zod';

/** The event's facts: answers to what guests ask, stored once and shown by every section. */

const line = (max: number) => z.string().trim().max(max);
const required = (max: number) => line(max).min(1, 'can’t be empty');
/** Links are https only. */
export const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\/[^\s<>"]+$/, 'must be an https:// link');
/** Colours are #rrggbb only; they reach CSS as a custom property, never as free text. */
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a colour like #a1b2c3');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date like 2027-06-12');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a time like 14:30');

export const LOCALES = ['de', 'en'] as const;
export type SiteLocale = (typeof LOCALES)[number];
export const OCCASIONS = ['wedding', 'birthday', 'anniversary', 'party', 'company'] as const;

export const eventSchema = z.object({
  title: required(80),
  date: isoDate.nullable().optional(),
  locale: z.enum(LOCALES),
  occasion: z.enum(OCCASIONS),
});
export const venuesSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z0-9-]{1,40}$/),
      name: required(80),
      role: line(60).optional(),
      address: line(200).optional(),
      mapUrl: httpsUrl.optional(),
      note: line(400).optional(),
    }),
  )
  .max(6);
export const scheduleSchema = z
  .array(
    z.object({
      time,
      title: required(80),
      text: line(400).optional(),
      venue: z.string().max(40).optional(),
    }),
  )
  .max(24);
export const travelSchema = z.object({
  text: line(1200).optional(),
  parking: line(600).optional(),
});
export const staysSchema = z
  .array(
    z.object({
      name: required(80),
      address: line(200).optional(),
      url: httpsUrl.optional(),
      note: line(400).optional(),
    }),
  )
  .max(8);
export const dresscodeSchema = z.object({
  style: line(80).optional(),
  text: line(800).optional(),
  colors: z.array(z.object({ hex: hexColor, name: required(40) })).max(8),
});
export const giftsSchema = z.object({
  text: line(1200).optional(),
  links: z.array(z.object({ label: required(60), url: httpsUrl })).max(6),
});
export const faqSchema = z.array(z.object({ q: required(200), a: required(1200) })).max(20);

export type EventInfo = z.infer<typeof eventSchema>;
export type Venue = z.infer<typeof venuesSchema>[number];
export type ScheduleItem = z.infer<typeof scheduleSchema>[number];
export type Travel = z.infer<typeof travelSchema>;
export type Stay = z.infer<typeof staysSchema>[number];
export type Dresscode = z.infer<typeof dresscodeSchema>;
export type Gifts = z.infer<typeof giftsSchema>;
export type FaqItem = z.infer<typeof faqSchema>[number];

export interface EventFacts {
  event: EventInfo;
  venues?: Venue[];
  schedule?: ScheduleItem[];
  travel?: Travel;
  stays?: Stay[];
  dresscode?: Dresscode;
  gifts?: Gifts;
  faq?: FaqItem[];
}

export type FactGroup = Exclude<keyof EventFacts, 'event'>;

export const FACTS: DataDef[] = [
  defineData({
    key: 'event',
    title: 'Event',
    description: 'Title (the names), date (YYYY-MM-DD), language (de|en) and occasion.',
    schema: eventSchema,
  }),
  defineData({
    key: 'venues',
    title: 'Venues',
    description:
      'Where it happens: name, role (e.g. ceremony), address, optional https map link. Shown by the location section; schedule items name a venue by id.',
    schema: venuesSchema,
  }),
  defineData({
    key: 'schedule',
    title: 'Schedule',
    description: 'The day’s program: time (HH:MM), title, optional text and venue id.',
    schema: scheduleSchema,
  }),
  defineData({
    key: 'travel',
    title: 'Getting there',
    description: 'How to get there, and parking. Shown by the travel section.',
    schema: travelSchema,
  }),
  defineData({
    key: 'stays',
    title: 'Places to stay',
    description: 'Hotels and rooms: name, address, https link, note. Shown by the travel section.',
    schema: staysSchema,
  }),
  defineData({
    key: 'dresscode',
    title: 'Dress code',
    description: 'A style line, a text and up to 8 named colours (#rrggbb).',
    schema: dresscodeSchema,
  }),
  defineData({
    key: 'gifts',
    title: 'Gifts',
    description: 'A gift text and up to 6 https links (registry, honeymoon fund).',
    schema: giftsSchema,
  }),
  defineData({
    key: 'faq',
    title: 'Questions',
    description: 'Questions and answers for guests.',
    schema: faqSchema,
  }),
];
