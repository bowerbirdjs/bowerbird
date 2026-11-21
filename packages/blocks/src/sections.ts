import { defineSection, t } from '@bowerbirdjs/core';
import {
  cards,
  content,
  gallery,
  pageHeader,
  schedule,
  split,
  stats,
  steps,
  team,
} from './sections-content.js';
import { banner, contact, faq, logos, newsletter, testimonials } from './sections-more.js';
import { GUTTER, MUTED, PLACEHOLDER_IMAGE, primaryButton, secondaryButton } from './shared.js';

export const nav = defineSection({
  name: 'nav',
  version: 1,
  title: 'Navigation bar',
  category: 'navigation',
  description:
    'Top bar with the brand name, a few links and a call to action. Put it first on the page.',
  variants: { tone: ['light', 'dark'] },
  vars: {
    '--nav-bg': { type: 'color', default: 'var(--color-surface)', description: 'Bar background.' },
    '--nav-fg': {
      type: 'color',
      default: 'var(--color-on-surface)',
      description: 'Bar text colour.',
    },
  },
  css: `.bb-nav {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-lg);
  padding-block: var(--space-md); ${GUTTER}
  background: var(--nav-bg); color: var(--nav-fg);
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.bb-nav--tone-dark { --nav-bg: var(--color-surface-inverse); --nav-fg: var(--color-on-inverse); }
.bb-nav__brand { font-size: var(--text-lg); font-weight: var(--weight-bold); letter-spacing: -0.01em; text-decoration: none; }
.bb-nav__links { display: none; gap: var(--space-xl); }
.bb-nav__link { font-size: var(--text-sm); font-weight: var(--weight-medium); text-decoration: none; ${MUTED} }
.bb-nav__link:hover { color: inherit; }
${primaryButton('.bb-nav__cta')}
@container bb-page (min-width: 768px) { .bb-nav__links { display: flex; } }`,
  template: () =>
    t.box({ tag: 'header' }, [
      t.link({ part: 'brand', href: '/', text: 'Acme' }),
      t.box(
        { part: 'links', tag: 'nav', label: 'Main' },
        ['Features', 'Pricing', 'About'].map((label, i) =>
          t.link({
            part: 'link',
            key: String(i + 1),
            href: `#${label.toLowerCase()}`,
            text: label,
          }),
        ),
      ),
      t.link({ part: 'cta', href: '#', text: 'Get started' }),
    ]),
});

export const hero = defineSection({
  name: 'hero',
  version: 1,
  title: 'Hero',
  category: 'header',
  description:
    'Top-of-page introduction: eyebrow, headline, supporting text and two calls to action. "split" adds an image beside the text.',
  variants: { layout: ['centered', 'split'] },
  vars: {
    '--hero-bg': {
      type: 'color',
      default: 'var(--color-surface)',
      description: 'Section background.',
    },
    '--hero-fg': { type: 'color', default: 'var(--color-on-surface)', description: 'Text colour.' },
    '--hero-pad-block': {
      type: 'space',
      default: 'var(--space-4xl)',
      description: 'Vertical padding.',
    },
  },
  css: `.bb-hero {
  display: grid; gap: var(--space-2xl); align-items: center;
  padding-block: var(--hero-pad-block); ${GUTTER}
  background: var(--hero-bg); color: var(--hero-fg);
}
.bb-hero__content { display: grid; gap: var(--space-lg); max-width: var(--size-prose); }
.bb-hero--layout-centered { justify-items: center; text-align: center; }
.bb-hero--layout-centered .bb-hero__content { justify-items: center; }
.bb-hero__eyebrow {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-accent);
}
.bb-hero__heading { font-size: var(--text-4xl); font-weight: var(--weight-bold); letter-spacing: -0.025em; }
.bb-hero__subheading { font-size: var(--text-lg); ${MUTED} }
.bb-hero__actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
.bb-hero--layout-centered .bb-hero__actions { justify-content: center; }
${primaryButton('.bb-hero__primary')}
${secondaryButton('.bb-hero__secondary')}
.bb-hero__media { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
@container bb-page (min-width: 768px) { .bb-hero__heading { font-size: var(--text-6xl); } }
@container bb-page (min-width: 1024px) { .bb-hero--layout-split { grid-template-columns: 1.1fr 1fr; } }`,
  template: ({ variant }) =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'content' }, [
        t.text({ part: 'eyebrow', tag: 'p', text: 'New release' }),
        t.text({ part: 'heading', tag: 'h1', text: 'Build pages with your team and your agents' }),
        t.text({
          part: 'subheading',
          text: 'A visual editor where people and AI agents work on the same page, with every change validated, attributed and undoable.',
        }),
        t.box({ part: 'actions' }, [
          t.link({ part: 'primary', href: '#', text: 'Get started' }),
          t.link({ part: 'secondary', href: '#', text: 'Learn more' }),
        ]),
      ]),
      variant.layout === 'split' &&
        t.image({ part: 'media', src: PLACEHOLDER_IMAGE, alt: 'Product screenshot' }),
    ]),
});

const FEATURES: [string, string, string][] = [
  [
    '✦',
    'Sections you can open',
    'Start from complete sections, then change any heading, link or style inside them.',
  ],
  [
    '◎',
    'On-brand by default',
    'Styles use your design tokens, so every change stays consistent with your brand.',
  ],
  [
    '↺',
    'Undo the agent, keep yours',
    'Every change is attributed. Undo an agent’s work without losing your own edits.',
  ],
  [
    '⌘',
    'Any framework',
    'Embed the editor in React, Vue, Svelte or plain HTML. The output is clean HTML and CSS.',
  ],
  [
    '⚡',
    'Agent-ready API',
    'Agents read a compact outline and edit through validated operations or MCP.',
  ],
  ['◇', 'Open source', 'MIT licensed. Self-host it, extend it, and bring your own components.'],
];

export const features = defineSection({
  name: 'features',
  version: 1,
  title: 'Feature grid',
  category: 'content',
  description:
    'Heading, intro and a responsive grid of feature cards (icon, title, text). Items are keyed item-1, item-2, …',
  variants: { columns: ['3', '2'] },
  vars: {
    '--features-bg': {
      type: 'color',
      default: 'var(--color-surface-muted)',
      description: 'Section background.',
    },
  },
  css: `.bb-features { display: grid; gap: var(--space-2xl); padding-block: var(--space-4xl); ${GUTTER} background: var(--features-bg); }
.bb-features__header { display: grid; gap: var(--space-md); max-width: var(--size-prose); }
.bb-features__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-features__intro { font-size: var(--text-lg); ${MUTED} }
.bb-features__grid { display: grid; gap: var(--space-lg); }
.bb-features__item {
  display: grid; gap: var(--space-xs); align-content: start; padding: var(--space-lg);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);
}
.bb-features__icon {
  display: inline-grid; place-items: center; width: var(--space-2xl); height: var(--space-2xl); margin-bottom: var(--space-xs);
  border-radius: var(--radius-md); background: var(--color-accent-subtle); color: var(--color-accent); font-size: var(--text-lg);
}
.bb-features__title { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.bb-features__body { ${MUTED} }
@container bb-page (min-width: 768px) { .bb-features__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container bb-page (min-width: 1024px) { .bb-features--columns-3 .bb-features__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }`,
  template: ({ variant }) =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Everything you need to ship great pages' }),
        t.text({
          part: 'intro',
          text: 'Big building blocks when you want speed, fine control when you need precision.',
        }),
      ]),
      t.box(
        { part: 'grid', tag: 'ul' },
        FEATURES.slice(0, variant.columns === '2' ? 4 : 6).map(([icon, title, body], i) =>
          t.box({ part: 'item', key: String(i + 1), tag: 'li' }, [
            t.text({ part: 'icon', tag: 'span', text: icon }),
            t.text({ part: 'title', tag: 'h3', text: title }),
            t.text({ part: 'body', text: body }),
          ]),
        ),
      ),
    ]),
});

interface Tier {
  key: string;
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  featured?: boolean;
}

const TIERS: Tier[] = [
  {
    key: 'starter',
    name: 'Starter',
    price: '$0',
    description: 'For personal projects.',
    features: ['1 site', 'Community support', 'All sections'],
    cta: 'Start for free',
  },
  {
    key: 'pro',
    name: 'Pro',
    price: '$29',
    description: 'For growing teams.',
    features: [
      'Unlimited sites',
      'Agent access (MCP)',
      'Custom tokens and themes',
      'Priority support',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    key: 'team',
    name: 'Team',
    price: '$99',
    description: 'For organisations.',
    features: ['Everything in Pro', 'Roles and locks', 'Audit history'],
    cta: 'Contact sales',
  },
];

export const pricing = defineSection({
  name: 'pricing',
  version: 1,
  title: 'Pricing tiers',
  category: 'commerce',
  description:
    'Heading plus three pricing tiers (tier-starter, tier-pro, tier-team). Each tier has name, price, period, description, feature-1…n and cta; the tier with a badge is highlighted.',
  vars: {
    '--pricing-bg': {
      type: 'color',
      default: 'var(--color-surface)',
      description: 'Section background.',
    },
  },
  css: `.bb-pricing { display: grid; gap: var(--space-2xl); padding-block: var(--space-4xl); ${GUTTER} background: var(--pricing-bg); }
.bb-pricing__header { display: grid; gap: var(--space-md); justify-items: center; text-align: center; max-width: var(--size-prose); margin-inline: auto; }
.bb-pricing__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-pricing__intro { font-size: var(--text-lg); ${MUTED} }
.bb-pricing__tiers { display: grid; gap: var(--space-lg); }
.bb-pricing__tier {
  position: relative; display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-xl);
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);
}
.bb-pricing__tier:has(.bb-pricing__badge) { border-color: var(--color-accent); box-shadow: var(--shadow-lg); }
.bb-pricing__badge {
  position: absolute; top: 0; left: 50%; translate: -50% -50%; white-space: nowrap;
  padding: var(--space-2xs) var(--space-sm); border-radius: var(--radius-full);
  background: var(--color-accent); color: var(--color-on-accent); font-size: var(--text-xs); font-weight: var(--weight-semibold);
}
.bb-pricing__name { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.bb-pricing__price-row { display: flex; align-items: baseline; gap: var(--space-2xs); }
.bb-pricing__price { font-size: var(--text-5xl); font-weight: var(--weight-bold); letter-spacing: -0.03em; }
.bb-pricing__period, .bb-pricing__description { ${MUTED} }
.bb-pricing__features { display: grid; gap: var(--space-xs); flex: 1; align-content: start; font-size: var(--text-sm); }
.bb-pricing__feature::before { content: "✓"; margin-inline-end: var(--space-xs); color: var(--color-accent); font-weight: var(--weight-bold); }
${secondaryButton('.bb-pricing__cta')}
${primaryButton('.bb-pricing__tier:has(.bb-pricing__badge) .bb-pricing__cta')}
@container bb-page (min-width: 1024px) { .bb-pricing__tiers { grid-template-columns: repeat(3, minmax(0, 1fr)); } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Simple, transparent pricing' }),
        t.text({ part: 'intro', text: 'Start free. Upgrade when your team grows.' }),
      ]),
      t.box(
        { part: 'tiers', tag: 'ul' },
        TIERS.map((tier) =>
          t.box({ part: 'tier', key: tier.key, tag: 'li' }, [
            tier.featured && t.text({ part: 'badge', tag: 'span', text: 'Most popular' }),
            t.text({ part: 'name', tag: 'h3', text: tier.name }),
            t.box({ part: 'price-row' }, [
              t.text({ part: 'price', tag: 'span', text: tier.price }),
              t.text({ part: 'period', tag: 'span', text: '/month' }),
            ]),
            t.text({ part: 'description', text: tier.description }),
            t.box(
              { part: 'features', tag: 'ul' },
              tier.features.map((f, i) =>
                t.text({ part: 'feature', key: String(i + 1), tag: 'li', text: f }),
              ),
            ),
            t.link({ part: 'cta', href: '#', text: tier.cta }),
          ]),
        ),
      ),
    ]),
});

export const cta = defineSection({
  name: 'cta',
  version: 1,
  title: 'Call to action',
  category: 'conversion',
  description:
    'A bold banner with a heading, one line of text and a button. Good near the end of a page.',
  variants: { tone: ['brand', 'dark'] },
  vars: {
    '--cta-bg': { type: 'color', default: 'var(--color-accent)', description: 'Panel background.' },
    '--cta-fg': {
      type: 'color',
      default: 'var(--color-on-accent)',
      description: 'Panel text colour.',
    },
  },
  css: `.bb-cta { padding-block: var(--space-3xl); ${GUTTER} }
.bb-cta--tone-dark { --cta-bg: var(--color-surface-inverse); --cta-fg: var(--color-on-inverse); }
.bb-cta__panel {
  display: grid; gap: var(--space-md); justify-items: center; text-align: center;
  padding: var(--space-3xl) var(--space-xl); border-radius: var(--radius-lg);
  background: var(--cta-bg); color: var(--cta-fg);
}
.bb-cta__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-cta__text { font-size: var(--text-lg); }
.bb-cta__button {
  display: inline-flex; margin-top: var(--space-xs); padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md);
  background: var(--cta-fg); color: var(--cta-bg); font-weight: var(--weight-semibold); text-decoration: none;
}
.bb-cta__button:hover { opacity: 0.9; }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'panel' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Ready to build your next page?' }),
        t.text({ part: 'text', text: 'Invite your team, connect your agent, and publish today.' }),
        t.link({ part: 'button', href: '#', text: 'Get started for free' }),
      ]),
    ]),
});

const FOOTER_COLUMNS: [string, string[]][] = [
  ['Product', ['Features', 'Pricing', 'Changelog']],
  ['Company', ['About', 'Careers', 'Contact']],
  ['Resources', ['Docs', 'Blog', 'Community']],
];

export const footer = defineSection({
  name: 'footer',
  version: 1,
  title: 'Footer',
  category: 'navigation',
  description:
    'Brand and tagline, columns of links (column-product, column-company, column-resources) and a legal line.',
  vars: {
    '--footer-bg': {
      type: 'color',
      default: 'var(--color-surface-inverse)',
      description: 'Footer background.',
    },
    '--footer-fg': {
      type: 'color',
      default: 'var(--color-on-inverse)',
      description: 'Footer text colour.',
    },
  },
  css: `.bb-footer { display: grid; gap: var(--space-2xl); padding-block: var(--space-3xl) var(--space-xl); ${GUTTER} background: var(--footer-bg); color: var(--footer-fg); }
.bb-footer__top { display: grid; gap: var(--space-xl); }
.bb-footer__about { display: grid; gap: var(--space-xs); max-width: 28ch; }
.bb-footer__brand { font-size: var(--text-lg); font-weight: var(--weight-bold); }
.bb-footer__tagline, .bb-footer__legal { font-size: var(--text-sm); ${MUTED} }
.bb-footer__column { display: grid; gap: var(--space-xs); align-content: start; }
.bb-footer__title { font-size: var(--text-sm); font-weight: var(--weight-semibold); }
.bb-footer__link { font-size: var(--text-sm); text-decoration: none; ${MUTED} }
.bb-footer__link:hover { color: inherit; }
.bb-footer__legal { padding-top: var(--space-lg); border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
@container bb-page (min-width: 768px) { .bb-footer__top { grid-template-columns: 2fr repeat(3, 1fr); } }`,
  template: () =>
    t.box({ tag: 'footer' }, [
      t.box({ part: 'top' }, [
        t.box({ part: 'about' }, [
          t.text({ part: 'brand', text: 'Acme' }),
          t.text({ part: 'tagline', text: 'Pages built by people and agents, together.' }),
        ]),
        ...FOOTER_COLUMNS.map(([title, links]) =>
          t.box({ part: 'column', key: title.toLowerCase(), tag: 'nav', label: title }, [
            t.text({ part: 'title', text: title }),
            ...links.map((l, i) =>
              t.link({ part: 'link', key: String(i + 1), href: '#', text: l }),
            ),
          ]),
        ),
      ]),
      t.text({ part: 'legal', tag: 'small', text: '© 2026 Acme, Inc. All rights reserved.' }),
    ]),
});

/** Every starter section, in the order a page tends to use them. */
export const SECTIONS = [
  banner,
  nav,
  hero,
  pageHeader,
  logos,
  features,
  split,
  steps,
  stats,
  cards,
  gallery,
  team,
  schedule,
  testimonials,
  pricing,
  faq,
  content,
  newsletter,
  contact,
  cta,
  footer,
];
