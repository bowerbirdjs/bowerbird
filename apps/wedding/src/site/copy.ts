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
    schedule: 'Noch kein Ablauf. Trag ihn unter Details ein.',
    venues: 'Noch kein Ort. Trag ihn unter Details ein.',
    travel: 'Noch keine Infos zur Anreise. Trag sie unter Details ein.',
    dresscode: 'Noch kein Dresscode. Trag ihn unter Details ein.',
    gifts: 'Noch keine Wünsche. Trag sie unter Details ein.',
    faq: 'Noch keine Fragen. Trag sie unter Details ein.',
    photos: 'Noch keine Fotos. Wähl ein Foto aus und lade ein eigenes hoch.',
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
    schedule: 'No schedule yet. Add it under Details.',
    venues: 'No venue yet. Add it under Details.',
    travel: 'No travel details yet. Add them under Details.',
    dresscode: 'No dress code yet. Add it under Details.',
    gifts: 'No gift details yet. Add them under Details.',
    faq: 'No questions yet. Add them under Details.',
    photos: 'No photos yet. Select a photo and upload your own.',
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
