import { createStore, normalizeDoc, type SiteDoc, type Store } from '@bowerbirdjs/core';
import type { AssetAdapter } from '@bowerbirdjs/editor';
import type { EventInfo, SiteLocale } from './site/facts.js';
import { eventPolicy } from './site/policy.js';
import { createEventSite, DEMO, eventRegistry } from './site/site.js';

/**
 * The POC keeps everything in this browser: the draft, and the last published version. A real
 * host saves drafts to its server with a revision (see the brief's adapter).
 */
const KEY = 'bowerbird-wedding/v1';

interface Saved {
  draft: SiteDoc;
  published: SiteDoc | null;
}

export const localeOf = (doc: SiteDoc): SiteLocale =>
  (doc.data?.event as EventInfo | undefined)?.locale ?? 'en';

/** A store for an event site, with the event registry (in its language) and the event policy. */
export function openSite(doc: SiteDoc): Store {
  return createStore({ registry: eventRegistry(localeOf(doc)), doc, policy: eventPolicy() });
}

export function load(): { store: Store; published: SiteDoc | null } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      const draft = normalizeDoc(saved.draft);
      if (draft?.data?.event) {
        const published = saved.published ? (normalizeDoc(saved.published) ?? null) : null;
        return { store: openSite(draft), published };
      }
    }
  } catch {
    // Unreadable storage: start with the demo.
  }
  return { store: openSite(createEventSite(DEMO.de).doc), published: null };
}

export function save(draft: SiteDoc, published: SiteDoc | null): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ draft, published } satisfies Saved));
    return true;
  } catch {
    return false;
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

/** Largest data URL the image component takes (with room to spare). */
const MAX_SRC = 95_000;

/**
 * Photos are shrunk in the browser and stored inline, because the POC has no storage service.
 * A host uploads to its own storage instead and returns the URL.
 */
export const inlineAssets: AssetAdapter = {
  async upload(file) {
    const bitmap = await createImageBitmap(file);
    let size = 1400;
    let quality = 0.82;
    for (let i = 0; i < 10; i++) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/jpeg', quality);
      if (src.length <= MAX_SRC) return { src, width: canvas.width, height: canvas.height };
      size *= 0.8;
      quality = Math.max(0.5, quality - 0.06);
    }
    throw new Error('This photo is too large, even after shrinking it.');
  },
};
