import type { BNode, Locales, Page, PropValue } from './types.js';

/** A page's title and description in `locale` (falling back to the default language). */
export function localizedPage(
  page: Page,
  locale?: string,
): { title: string; description?: string } {
  const t = locale ? page.l10n?.[locale] : undefined;
  const description = t?.description ?? page.description;
  return { title: t?.title ?? page.title, ...(description !== undefined ? { description } : {}) };
}

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
    const values = out[locale] ?? {};
    values[prop] = v as PropValue;
    out[locale] = values;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A node's props as shown in `locale`: translations over the default-language props. */
export function localizedProps(node: BNode, locale?: string): BNode['props'] {
  const t = locale ? node.l10n?.[locale] : undefined;
  return t ? { ...node.props, ...t } : node.props;
}

/**
 * Content props that have text in the default language but no translation into `locale`. URLs
 * (`href`, `src`) are left out: they usually stay the same in every language.
 */
export function untranslatedProps(
  node: BNode,
  contentProps: readonly string[],
  locale: string,
): string[] {
  const has = node.l10n?.[locale] ?? {};
  return contentProps.filter(
    (k) =>
      k !== 'href' &&
      k !== 'src' &&
      typeof node.props[k] === 'string' &&
      (node.props[k] as string).trim() !== '' &&
      !(k in has),
  );
}

/**
 * Checks a locale for reading translations: `undefined` means the default language (the props
 * themselves), a string is one of the site's other languages, and an issue explains anything else.
 */
export function checkReadLocale(
  locales: Locales | undefined,
  locale: string,
): { locale?: string; note?: string; error?: string } {
  const all = siteLocales(locales);
  if (locale === all[0]) {
    return { note: `"${locale}" is the default language: showing the content itself.` };
  }
  if (all.includes(locale)) return { locale };
  return {
    error: `The site has no language "${locale}". Languages: ${all.join(', ')} (default ${all[0]}).`,
  };
}

/** All locales of a site, default first (`['en']` for a one-language site). */
export function siteLocales(locales: Locales | undefined): string[] {
  return locales ? [locales.default, ...locales.others] : ['en'];
}
