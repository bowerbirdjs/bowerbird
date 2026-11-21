import { defineSection, t } from '@bowerbirdjs/core';
import { CARD, GUTTER, headerCss, MUTED, primaryButton, sectionCss } from './shared.js';

const bg = (name: string, token = 'surface') => ({
  [`--${name}-bg`]: {
    type: 'color' as const,
    default: `var(--color-${token})`,
    description: 'Section background.',
  },
});

export const banner = defineSection({
  name: 'banner',
  version: 1,
  title: 'Announcement bar',
  category: 'navigation',
  description: 'A thin strip with one line of news and a link. Put it above the navigation bar.',
  variants: { tone: ['brand', 'dark', 'subtle'] },
  vars: {
    '--banner-bg': { type: 'color', default: 'var(--color-accent)', description: 'Background.' },
    '--banner-fg': {
      type: 'color',
      default: 'var(--color-on-accent)',
      description: 'Text colour.',
    },
  },
  css: `.bb-banner {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-2xs) var(--space-md);
  padding-block: var(--space-xs); ${GUTTER}
  background: var(--banner-bg); color: var(--banner-fg); font-size: var(--text-sm); text-align: center;
}
.bb-banner--tone-dark { --banner-bg: var(--color-surface-inverse); --banner-fg: var(--color-on-inverse); }
.bb-banner--tone-subtle { --banner-bg: var(--color-accent-subtle); --banner-fg: var(--color-on-surface); }
.bb-banner__text { font-weight: var(--weight-medium); }
.bb-banner__link { padding-block: var(--space-2xs); font-weight: var(--weight-semibold); text-underline-offset: 0.2em; }`,
  template: () =>
    t.box({ tag: 'aside', label: 'Announcement' }, [
      t.text({ part: 'text', text: 'New: reviewable changes from your agents.' }),
      t.link({ part: 'link', href: '#', text: 'See what changed' }),
    ]),
});

export const logos = defineSection({
  name: 'logos',
  version: 1,
  title: 'Logo cloud',
  category: 'social-proof',
  description:
    'A line such as "Trusted by" over a row of customer names (logo-1, logo-2, …). The names are text; replace one with an image node to show a real logo.',
  vars: bg('logos'),
  css: `.bb-logos {
  display: grid; gap: var(--space-lg); justify-items: center;
  padding-block: var(--space-2xl); ${GUTTER} background: var(--logos-bg);
}
.bb-logos__label { font-size: var(--text-sm); font-weight: var(--weight-medium); text-align: center; ${MUTED} }
.bb-logos__list { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: var(--space-md) var(--space-2xl); }
.bb-logos__logo { font-size: var(--text-xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; ${MUTED} }`,
  template: () =>
    t.box({ tag: 'section', label: 'Customers' }, [
      t.text({ part: 'label', text: 'Trusted by teams at' }),
      t.box(
        { part: 'list', tag: 'ul' },
        ['Arvo', 'Brightlane', 'Corvid Labs', 'Dunmore', 'Ellery', 'Fernhill'].map((name, i) =>
          t.text({ part: 'logo', key: String(i + 1), tag: 'li', text: name }),
        ),
      ),
    ]),
});

const QUOTES = [
  [
    'We replaced three tools with one, and our marketers stopped asking engineering for every headline change.',
    'Lena Hoffmann',
    'Head of Marketing, Brightlane',
  ],
  [
    'The agent drafts the page, we review the changes one by one. Nothing of ours gets overwritten.',
    'Daniel Mbeki',
    'Product Lead, Arvo',
  ],
  [
    'It fits inside our product as if we had built it. Our customers think we did.',
    'Sofia Lindqvist',
    'CTO, Fernhill',
  ],
] as const;

export const testimonials = defineSection({
  name: 'testimonials',
  version: 1,
  title: 'Testimonials',
  category: 'social-proof',
  description:
    'What customers say: quote cards (quote-1, quote-2, …; each a quote, a name and a role). "single" shows one large quote instead of a grid.',
  variants: { layout: ['grid', 'single'] },
  vars: bg('testimonials', 'surface-muted'),
  css: `${sectionCss('testimonials')}
${headerCss('testimonials', 'center')}
.bb-testimonials__list { display: grid; gap: var(--space-lg); }
.bb-testimonials__quote { display: flex; flex-direction: column; gap: var(--space-md); padding: var(--space-xl); ${CARD} }
.bb-testimonials__mark { color: var(--color-accent); font-size: var(--text-3xl); }
.bb-testimonials__text { flex: 1; font-size: var(--text-lg); }
.bb-testimonials__author { display: grid; }
.bb-testimonials__name { font-weight: var(--weight-semibold); }
.bb-testimonials__role { font-size: var(--text-sm); ${MUTED} }
.bb-testimonials--layout-single .bb-testimonials__list { max-width: var(--size-prose); margin-inline: auto; }
.bb-testimonials--layout-single .bb-testimonials__quote {
  align-items: center; padding: 0; border: 0; background: none; color: inherit; text-align: center;
}
.bb-testimonials--layout-single .bb-testimonials__text { font-size: var(--text-2xl); font-weight: var(--weight-medium); letter-spacing: -0.01em; }
@container bb-page (min-width: 1024px) {
  .bb-testimonials--layout-grid .bb-testimonials__list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}`,
  template: ({ variant }) =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'What our customers say' }),
      ]),
      t.box(
        { part: 'list' },
        QUOTES.slice(0, variant.layout === 'single' ? 1 : 3).map(([text, name, role], i) =>
          t.box({ part: 'quote', key: String(i + 1), tag: 'figure' }, [
            t.icon({ part: 'mark', icon: 'quote' }),
            t.text({ part: 'text', tag: 'blockquote', text }),
            t.box({ part: 'author' }, [
              t.text({ part: 'name', text: name }),
              t.text({ part: 'role', text: role }),
            ]),
          ]),
        ),
      ),
    ]),
});

const QUESTIONS = [
  [
    'Can I try it before I pay?',
    'Yes. The starter plan is free for as long as you like, with every section included.',
  ],
  [
    'Do I need a developer to make changes?',
    'No. Text, images and whole sections can be changed on the page; a developer only sets it up once.',
  ],
  [
    'What happens to my pages if I leave?',
    'They are yours. Export them as plain HTML and CSS, or as React components, at any time.',
  ],
  [
    'Can agents edit my pages?',
    'Only as far as you allow. You decide what they may change, and you can review every change first.',
  ],
] as const;

export const faq = defineSection({
  name: 'faq',
  version: 1,
  title: 'Questions and answers',
  category: 'content',
  description:
    'Frequently asked questions as an accordion: items (item-1, item-2, …) each hold a question (a summary) and an answer. Duplicate an item to add one. "side" puts the heading beside the list on wide screens.',
  variants: { layout: ['centered', 'side'] },
  vars: bg('faq'),
  css: `${sectionCss('faq')}
${headerCss('faq')}
.bb-faq__list { display: grid; width: 100%; max-width: var(--size-prose); }
.bb-faq--layout-centered .bb-faq__header { justify-items: center; margin-inline: auto; text-align: center; }
.bb-faq--layout-centered .bb-faq__list { margin-inline: auto; }
.bb-faq__item { border-bottom: 1px solid var(--color-border); }
.bb-faq__item:first-child { border-top: 1px solid var(--color-border); }
.bb-faq__question {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-md);
  padding-block: var(--space-md); font-size: var(--text-lg); font-weight: var(--weight-semibold); list-style: none;
}
.bb-faq__question::-webkit-details-marker { display: none; }
.bb-faq__question::after {
  content: "+"; flex: none; color: var(--color-accent);
  font-size: var(--text-2xl); font-weight: var(--weight-regular); line-height: 1;
}
.bb-faq__item[open] > .bb-faq__question::after { content: "\\2212"; }
.bb-faq__answer { padding-bottom: var(--space-md); ${MUTED} }
@container bb-page (min-width: 1024px) {
  .bb-faq--layout-side { grid-template-columns: 1fr 1.6fr; align-items: start; }
}`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Questions, answered' }),
        t.text({ part: 'intro', text: 'The things people ask us most.' }),
      ]),
      t.box(
        { part: 'list' },
        QUESTIONS.map(([question, answer], i) =>
          t.details({ part: 'item', key: String(i + 1), open: i === 0 }, [
            t.text({ part: 'question', tag: 'summary', text: question }),
            t.text({ part: 'answer', text: answer }),
          ]),
        ),
      ),
    ]),
});

/** A submit button: the section's own colours, so it stands out on brand and dark bands too. */
const submitCss = (selector: string) => `${primaryButton(selector)}
${selector} { min-height: 2.75rem; border: 0; cursor: pointer; }`;

export const newsletter = defineSection({
  name: 'newsletter',
  version: 1,
  title: 'Newsletter signup',
  category: 'conversion',
  description:
    'Heading, one line of text and a one-field form (email, submit) with a note below. Set the form\'s "action" to the URL that receives signups. "tone" sets a brand or dark band.',
  variants: { tone: ['subtle', 'brand', 'dark'] },
  vars: {
    ...bg('newsletter', 'surface-muted'),
    '--newsletter-fg': {
      type: 'color',
      default: 'var(--color-on-surface)',
      description: 'Text colour.',
    },
  },
  css: `.bb-newsletter {
  padding-block: var(--space-3xl); ${GUTTER}
  background: var(--newsletter-bg); color: var(--newsletter-fg);
}
.bb-newsletter--tone-brand { --newsletter-bg: var(--color-accent); --newsletter-fg: var(--color-on-accent); }
.bb-newsletter--tone-dark { --newsletter-bg: var(--color-surface-inverse); --newsletter-fg: var(--color-on-inverse); }
.bb-newsletter__inner { display: grid; gap: var(--space-xl); align-items: center; }
.bb-newsletter__copy { display: grid; gap: var(--space-xs); max-width: var(--size-prose); }
.bb-newsletter__heading { font-size: var(--text-2xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-newsletter__text { font-size: var(--text-lg); }
.bb-newsletter__form { display: grid; gap: var(--space-sm); align-items: end; }
.bb-newsletter__note { font-size: var(--text-sm); }
${submitCss('.bb-newsletter__submit')}
.bb-newsletter--tone-brand .bb-newsletter__submit, .bb-newsletter--tone-dark .bb-newsletter__submit {
  background: var(--newsletter-fg); color: var(--newsletter-bg);
}
.bb-newsletter--tone-brand .bb-newsletter__submit:hover, .bb-newsletter--tone-dark .bb-newsletter__submit:hover { opacity: 0.9; }
@container bb-page (min-width: 768px) {
  .bb-newsletter__form { grid-template-columns: minmax(0, 1fr) auto; }
  .bb-newsletter__note { grid-column: 1 / -1; }
}
@container bb-page (min-width: 1024px) { .bb-newsletter__inner { grid-template-columns: 1fr 1fr; } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'inner' }, [
        t.box({ part: 'copy' }, [
          t.text({ part: 'heading', tag: 'h2', text: 'Stay in the loop' }),
          t.text({ part: 'text', text: 'One short email a month with what is new. No noise.' }),
        ]),
        t.form({ part: 'form', label: 'Newsletter signup' }, [
          t.field({
            part: 'email',
            type: 'email',
            field: 'email',
            label: 'Email address',
            placeholder: 'you@example.com',
            required: true,
          }),
          t.button({ part: 'submit', type: 'submit', text: 'Subscribe' }),
          t.text({ part: 'note', text: 'Unsubscribe with one click, any time.' }),
        ]),
      ]),
    ]),
});

export const contact = defineSection({
  name: 'contact',
  version: 1,
  title: 'Contact',
  category: 'conversion',
  description:
    'Ways to reach you (detail-email, detail-phone, detail-address; each an icon and a link or text) beside a contact form (name, email, message, submit). Set the form\'s "action" to the URL that receives messages.',
  vars: bg('contact', 'surface-muted'),
  css: `.bb-contact {
  display: grid; gap: var(--space-2xl); padding-block: var(--space-4xl); ${GUTTER}
  background: var(--contact-bg);
}
.bb-contact__info { display: grid; gap: var(--space-lg); align-content: start; max-width: var(--size-prose); }
.bb-contact__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-contact__intro { font-size: var(--text-lg); ${MUTED} }
.bb-contact__details { display: grid; gap: var(--space-md); }
.bb-contact__detail { display: flex; align-items: center; gap: var(--space-sm); }
.bb-contact__icon {
  display: inline-grid; place-items: center; flex: none; width: var(--space-2xl); height: var(--space-2xl);
  border-radius: var(--radius-md); background: var(--color-accent-subtle); color: var(--color-accent); font-size: var(--text-xl);
}
.bb-contact__value { padding-block: var(--space-2xs); font-weight: var(--weight-medium); text-decoration: none; }
a.bb-contact__value:hover { text-decoration: underline; }
.bb-contact__form { padding: var(--space-xl); box-shadow: var(--shadow-sm); ${CARD} }
${submitCss('.bb-contact__submit')}
@container bb-page (min-width: 1024px) { .bb-contact { grid-template-columns: 1fr 1.2fr; align-items: start; } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'info' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Talk to us' }),
        t.text({
          part: 'intro',
          text: 'Questions, ideas or a project in mind? We answer within one working day.',
        }),
        t.box({ part: 'details', tag: 'ul' }, [
          t.box({ part: 'detail', key: 'email', tag: 'li' }, [
            t.icon({ part: 'icon', icon: 'mail' }),
            t.link({ part: 'value', href: 'mailto:hello@example.com', text: 'hello@example.com' }),
          ]),
          t.box({ part: 'detail', key: 'phone', tag: 'li' }, [
            t.icon({ part: 'icon', icon: 'phone' }),
            t.link({ part: 'value', href: 'tel:+15550100', text: '+1 555 0100' }),
          ]),
          t.box({ part: 'detail', key: 'address', tag: 'li' }, [
            t.icon({ part: 'icon', icon: 'map-pin' }),
            t.text({ part: 'value', tag: 'span', text: '12 Example Street, Springfield' }),
          ]),
        ]),
      ]),
      t.form({ part: 'form', label: 'Contact' }, [
        t.field({ part: 'name', field: 'name', label: 'Name', required: true }),
        t.field({ part: 'email', type: 'email', field: 'email', label: 'Email', required: true }),
        t.field({
          part: 'message',
          type: 'textarea',
          field: 'message',
          label: 'How can we help?',
          required: true,
        }),
        t.button({ part: 'submit', type: 'submit', text: 'Send message' }),
      ]),
    ]),
});
