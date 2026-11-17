import {
  type ComponentDef,
  createEmptyDoc,
  createRegistry,
  type Registry,
  type SectionDef,
  type SiteDoc,
} from '@bowerbirdjs/core';
import { SECTIONS } from './sections.js';
import { darkTheme, defaultTokens } from './theme.js';

export { cta, features, footer, hero, nav, pricing, SECTIONS } from './sections.js';
export { PLACEHOLDER_IMAGE, primaryButton, secondaryButton } from './shared.js';
export { darkTheme, defaultTokens } from './theme.js';

/** A registry with the primitives, the starter sections and any extra components or sections. */
export function createDefaultRegistry(
  extra: { components?: ComponentDef[]; sections?: SectionDef[] } = {},
): Registry {
  return createRegistry({
    components: extra.components ?? [],
    sections: [...SECTIONS, ...(extra.sections ?? [])],
  });
}

/** An empty site using the default tokens and dark theme. Add pages with `page.create`. */
export function createStarterDoc(): SiteDoc {
  return createEmptyDoc({
    tokens: structuredClone(defaultTokens),
    themes: { dark: { ...darkTheme } },
  });
}
