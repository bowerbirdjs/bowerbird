import type { BNode, Locales, PropValue } from './types.js';

/** `{ de: { text: 'Hallo' } }` → `{ 'de|text': 'Hallo' }` (for per-field merges). */
export function flattenL10n(l10n: BNode['l10n']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [locale, props] of Object.entries(l10n ?? {}))
    for (const [k, v] of Object.entries(props)) out[`${locale}|${k}`] = v;
  return out;
}

export function unflattenL10n(flat: Record<string, unknown>): BNode['l10n'] {
  const out: NonNullable<BNode['l10n']> = {};
  for (const [key, v] of Object.entries(flat)) {
    const [locale, prop] = key.split('|') as [string, string];
    (out[locale] ??= {})[prop] = v as PropValue;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A node's props as shown in `locale`: translations over the default-language props. */
export function localizedProps(node: BNode, locale?: string): BNode['props'] {
  const t = locale ? node.l10n?.[locale] : undefined;
  return t ? { ...node.props, ...t } : node.props;
}

/** All locales of a site, default first (`['en']` for a one-language site). */
export function siteLocales(locales: Locales | undefined): string[] {
  return locales ? [locales.default, ...locales.others] : ['en'];
}
