import type { Store } from '@bowerbirdjs/core';
import { createDefaultStore } from '@bowerbirdjs/react';

export interface EventInfo {
  id: string;
  name: string;
  date: string;
  city: string;
  /** Whether the event already has a page (built by the "system" actor, so nobody's undo removes it). */
  prebuilt: boolean;
}

export const EVENTS: EventInfo[] = [
  {
    id: 'frontend-summit',
    name: 'Frontend Summit 2027',
    date: 'March 18–19, 2027',
    city: 'Lisbon',
    prebuilt: true,
  },
  {
    id: 'design-systems-day',
    name: 'Design Systems Day',
    date: 'May 6, 2027',
    city: 'Berlin',
    prebuilt: false,
  },
];

export function createEventStore(event: EventInfo): Store {
  const store = createDefaultStore();
  if (!event.prebuilt) return store;
  const result = store.apply({
    actor: { kind: 'system', id: 'acme-events', name: 'Acme Events' },
    label: 'Event page template',
    ops: [
      {
        op: 'page.update',
        id: 'home',
        title: event.name,
        description: `${event.name}, ${event.date} in ${event.city}.`,
      },
      {
        op: 'section.insert',
        section: 'nav',
        content: {
          brand: { text: 'Frontend Summit' },
          cta: { text: 'Get tickets', href: '#tickets' },
        },
      },
      {
        op: 'section.insert',
        section: 'hero',
        variant: { layout: 'split' },
        content: {
          eyebrow: { text: `${event.date} · ${event.city}` },
          heading: { text: 'Two days on the future of the web platform' },
          subheading: {
            text: 'Talks, workshops and hallway conversations with the people building browsers, frameworks and design systems.',
          },
          primary: { text: 'Get tickets', href: '#tickets' },
          secondary: { text: 'See the program', href: '#program' },
          media: { alt: 'Conference stage' },
        },
      },
      {
        op: 'section.insert',
        section: 'features',
        variant: { columns: '3' },
        content: {
          heading: { text: 'What to expect' },
          intro: {
            text: 'A single track, so you never miss the talk everyone talks about afterwards.',
          },
          'item-1/title': { text: '24 talks' },
          'item-1/body': { text: 'From CSS architecture to shipping AI features responsibly.' },
          'item-2/title': { text: '6 workshops' },
          'item-2/body': { text: 'Hands-on sessions with small groups and real code.' },
          'item-3/title': { text: 'Community night' },
          'item-3/body': { text: 'Dinner by the river with speakers and attendees.' },
        },
      },
      { op: 'node.remove', id: 'features-1/item-4' },
      { op: 'node.remove', id: 'features-1/item-5' },
      { op: 'node.remove', id: 'features-1/item-6' },
      {
        op: 'section.insert',
        section: 'pricing',
        content: {
          heading: { text: 'Tickets' },
          intro: { text: 'Early-bird prices until January 31.' },
          'tier-starter/name': { text: 'Student' },
          'tier-starter/price': { text: '€99' },
          'tier-starter/period': { text: '' },
          'tier-pro/name': { text: 'Standard' },
          'tier-pro/price': { text: '€399' },
          'tier-pro/period': { text: '' },
          'tier-team/name': { text: 'Team of 5' },
          'tier-team/price': { text: '€1,699' },
          'tier-team/period': { text: '' },
        },
      },
      {
        op: 'section.insert',
        section: 'cta',
        variant: { tone: 'dark' },
        content: { heading: { text: 'Join us in Lisbon' }, button: { text: 'Get your ticket' } },
      },
      {
        op: 'section.insert',
        section: 'footer',
        content: { brand: { text: 'Frontend Summit' }, legal: { text: '© 2027 Acme Events' } },
      },
    ],
  });
  if (!result.ok) console.error('event template failed', result.errors);
  return store;
}
