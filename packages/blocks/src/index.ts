import {
  type ComponentDef,
  createEmptyDoc,
  createRegistry,
  type IconDef,
  type Registry,
  type SectionDef,
  type SiteDoc,
} from '@bowerbirdjs/core';
import { ICONS } from './icons.js';
import { SECTIONS } from './sections.js';
import { darkTheme, defaultTokens } from './theme.js';

export { ICONS } from './icons.js';
export { cta, features, footer, hero, nav, pricing, SECTIONS } from './sections.js';
export { PLACEHOLDER_IMAGE, primaryButton, secondaryButton } from './shared.js';
export { darkTheme, defaultTokens } from './theme.js';

/**
 * A registry with the primitives, the starter sections and icons, and any extra components,
 * sections or icons (an icon with a starter icon's name replaces it).
 */
export function createDefaultRegistry(
  extra: {
    components?: ComponentDef[];
    sections?: SectionDef[];
    icons?: Record<string, string | IconDef>;
  } = {},
): Registry {
  return createRegistry({
    components: extra.components ?? [],
    sections: [...SECTIONS, ...(extra.sections ?? [])],
    icons: { ...ICONS, ...(extra.icons ?? {}) },
  });
}

/** An empty site using the default tokens and dark theme. Add pages with `page.create`. */
export function createStarterDoc(): SiteDoc {
  return createEmptyDoc({
    tokens: structuredClone(defaultTokens),
    themes: { dark: { ...darkTheme } },
  });
}
