import type { SiteLocale } from './facts.js';

/** Every word a section shows that isn't the hosts' own content, in the event's language. */
export interface SiteCopy {
  directions: string;
  daysLeft: (n: number) => string;
  today: string;
  oclock: (time: string) => string;
  gettingThere: string;
  parking: string;
  stays: string;
  colours: string;
  rsvpNote: string;
  photoWallNote: string;
  credit: string;
  menu: string;
  /** Editor-only hints on sections that show facts but have none yet (they address the host). */
  empty: Record<
    'schedule' | 'venues' | 'travel' | 'dresscode' | 'gifts' | 'faq' | 'photos',
    string
  >;
  /** Editor-only buttons that add what's missing (they address the host). */
  add: Record<
    | 'schedule'
    | 'venue'
    | 'travel'
    | 'parking'
    | 'stay'
    | 'style'
    | 'text'
    | 'colour'
    | 'link'
    | 'faq',
    string
  >;
  /** Starter values for what the buttons add. */
  starter: {
    item: string;
    venue: string;
    stay: string;
    travel: string;
    parking: string;
    style: string;
    text: string;
    colour: string;
    link: string;
    q: string;
    a: string;
  };
}

const de: SiteCopy = {
  directions: 'Route planen',
  daysLeft: (n) => (n === 1 ? 'Noch 1 Tag' : `Noch ${n} Tage`),
  today: 'Heute ist es so weit',
  oclock: (time) => `${time} Uhr`,
  gettingThere: 'Anreise',
  parking: 'Parken',
  stays: 'Übernachten',
  colours: 'Farben',
  rsvpNote: 'Hier erscheint das Antwortformular für eure Gäste.',
  photoWallNote: 'Hier erscheinen die Fotos eurer Gäste, sobald ihr sie freigebt.',
  credit: 'Gemacht mit Bowerbird',
  menu: 'Menü',
  empty: {
    schedule: 'Noch kein Ablauf.',
    venues: 'Noch kein Ort.',
    travel: 'Noch keine Infos zur Anreise.',
    dresscode: 'Noch kein Dresscode.',
    gifts: 'Noch keine Wünsche.',
    faq: 'Noch keine Fragen.',
    photos: 'Noch keine Fotos. Wähl ein Foto aus und lade ein eigenes hoch.',
  },
  add: {
    schedule: 'Ersten Programmpunkt anlegen',
    venue: 'Ersten Ort anlegen',
    travel: 'Anreise beschreiben',
    parking: 'Parken beschreiben',
    stay: 'Unterkunft hinzufügen',
    style: 'Stil angeben',
    text: 'Text hinzufügen',
    colour: 'Farbe hinzufügen',
    link: 'Link hinzufügen',
    faq: 'Erste Frage anlegen',
  },
  starter: {
    item: 'Neuer Programmpunkt',
    venue: 'Neuer Ort',
    stay: 'Neue Unterkunft',
    travel: 'So kommt ihr hin.',
    parking: 'Hier könnt ihr parken.',
    style: 'Festlich',
    text: 'Ein paar Worte dazu.',
    colour: 'Farbe',
    link: 'Link',
    q: 'Neue Frage',
    a: 'Antwort',
  },
};

const en: SiteCopy = {
  directions: 'Directions',
  daysLeft: (n) => (n === 1 ? '1 day to go' : `${n} days to go`),
  today: 'Today is the day',
  oclock: (time) => time,
  gettingThere: 'Getting there',
  parking: 'Parking',
  stays: 'Places to stay',
  colours: 'Colours',
  rsvpNote: 'Your guests’ reply form appears here.',
  photoWallNote: 'Your guests’ photos appear here once you approve them.',
  credit: 'Made with Bowerbird',
  menu: 'Menu',
  empty: {
    schedule: 'No schedule yet.',
    venues: 'No venue yet.',
    travel: 'No travel details yet.',
    dresscode: 'No dress code yet.',
    gifts: 'No gift details yet.',
    faq: 'No questions yet.',
    photos: 'No photos yet. Select a photo and upload your own.',
  },
  add: {
    schedule: 'Add the first schedule item',
    venue: 'Add the first venue',
    travel: 'Describe how to get there',
    parking: 'Add parking',
    stay: 'Add a place to stay',
    style: 'Add a style',
    text: 'Add a text',
    colour: 'Add a colour',
    link: 'Add a link',
    faq: 'Add the first question',
  },
  starter: {
    item: 'New item',
    venue: 'New venue',
    stay: 'New place to stay',
    travel: 'How to get here.',
    parking: 'Where to park.',
    style: 'Formal',
    text: 'A few words about it.',
    colour: 'Colour',
    link: 'Link',
    q: 'New question',
    a: 'Answer',
  },
};

export const COPY: Record<SiteLocale, SiteCopy> = { de, en };

/** "2027-06-12" in the event's language, e.g. "12. Juni 2027". */
export function formatDate(iso: string, locale: SiteLocale): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  // English sites use day-month-year ("20 May 2028").
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(date);
}

/** Whole days from today until `iso` (negative once it has passed). */
export function daysUntil(iso: string, now = new Date()): number {
  const target = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

/** Initials of two names joined by "&", "und" or "and": "Lena & Jonas" → "L & J". */
export function monogram(title: string): string {
  const parts = title
    .split(/\s+(?:&|und|and|\+)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length !== 2) return title.trim().slice(0, 1).toUpperCase();
  return `${parts[0]!.slice(0, 1).toUpperCase()} & ${parts[1]!.slice(0, 1).toUpperCase()}`;
}

/** A maps search for a venue (a link guests follow; the page itself loads nothing). */
export function directionsUrl(name: string, address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`;
}
