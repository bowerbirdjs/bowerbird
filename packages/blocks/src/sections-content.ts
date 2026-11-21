import { defineSection, t } from '@bowerbirdjs/core';
import {
  CARD,
  GUTTER,
  headerCss,
  MUTED,
  PLACEHOLDER_IMAGE,
  placeholderPhoto,
  placeholderPortrait,
  primaryButton,
  sectionCss,
} from './shared.js';

const bg = (name: string, token = 'surface') => ({
  [`--${name}-bg`]: {
    type: 'color' as const,
    default: `var(--color-${token})`,
    description: 'Section background.',
  },
});

export const pageHeader = defineSection({
  name: 'page-header',
  version: 1,
  title: 'Page header',
  category: 'header',
  description:
    'Title block for an inner page (About, Pricing, Contact): eyebrow, h1 heading and one line of intro. Use it instead of a hero.',
  variants: { align: ['start', 'center'] },
  vars: bg('page-header', 'surface-muted'),
  css: `.bb-page-header {
  display: grid; gap: var(--space-md); padding-block: var(--space-3xl); ${GUTTER}
  background: var(--page-header-bg);
}
.bb-page-header--align-center { justify-items: center; text-align: center; }
.bb-page-header__eyebrow {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-accent);
}
.bb-page-header__heading { max-width: var(--size-prose); font-size: var(--text-4xl); font-weight: var(--weight-bold); letter-spacing: -0.025em; }
.bb-page-header__intro { max-width: var(--size-prose); font-size: var(--text-lg); ${MUTED} }
@container bb-page (min-width: 768px) { .bb-page-header__heading { font-size: var(--text-5xl); } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.text({ part: 'eyebrow', text: 'About us' }),
      t.text({ part: 'heading', tag: 'h1', text: 'A small team with a clear idea' }),
      t.text({
        part: 'intro',
        text: 'Who we are, what we care about and how we work with the people who use what we build.',
      }),
    ]),
});

export const split = defineSection({
  name: 'split',
  version: 1,
  title: 'Text and image',
  category: 'content',
  description:
    'Heading, text and a short checklist beside an image, with one call to action. "media" picks the side the image is on. Points are keyed point-1, point-2, …',
  variants: { media: ['right', 'left'] },
  vars: bg('split'),
  css: `.bb-split {
  display: grid; gap: var(--space-2xl); align-items: center;
  padding-block: var(--space-4xl); ${GUTTER} background: var(--split-bg);
}
.bb-split__content { display: grid; gap: var(--space-lg); max-width: var(--size-prose); }
.bb-split__eyebrow {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-accent);
}
.bb-split__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-split__text { font-size: var(--text-lg); ${MUTED} }
.bb-split__points { display: grid; gap: var(--space-sm); }
.bb-split__point { display: flex; align-items: flex-start; gap: var(--space-sm); }
.bb-split__check { margin-top: 0.15em; color: var(--color-accent); font-size: var(--text-xl); }
${primaryButton('.bb-split__cta')}
.bb-split__cta { justify-self: start; }
.bb-split__media { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
@container bb-page (min-width: 1024px) {
  .bb-split { grid-template-columns: 1fr 1fr; }
  .bb-split--media-left .bb-split__media { order: -1; }
}`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'content' }, [
        t.text({ part: 'eyebrow', text: 'How it helps' }),
        t.text({ part: 'heading', tag: 'h2', text: 'Change one thing without breaking the rest' }),
        t.text({
          part: 'text',
          text: 'Every edit is small, checked and easy to take back, whether a person or an agent made it.',
        }),
        t.box(
          { part: 'points', tag: 'ul' },
          [
            'Edits are validated before they land',
            'Every change says who made it',
            'Undo one author without losing the others',
          ].map((label, i) =>
            t.box({ part: 'point', key: String(i + 1), tag: 'li' }, [
              t.icon({ part: 'check', icon: 'check-circle' }),
              t.text({ part: 'label', tag: 'span', text: label }),
            ]),
          ),
        ),
        t.link({ part: 'cta', href: '#', text: 'See how it works' }),
      ]),
      t.image({ part: 'media', src: PLACEHOLDER_IMAGE, alt: 'Product screenshot' }),
    ]),
});

export const steps = defineSection({
  name: 'steps',
  version: 1,
  title: 'Steps',
  category: 'content',
  description:
    'How something works, as numbered steps (step-1, step-2, …; each with a title and body). The numbers are drawn from the order, so moving or duplicating a step renumbers them.',
  vars: bg('steps', 'surface-muted'),
  css: `${sectionCss('steps')}
${headerCss('steps')}
.bb-steps__list { display: grid; gap: var(--space-xl); counter-reset: bb-step; }
.bb-steps__step { display: grid; gap: var(--space-xs); align-content: start; counter-increment: bb-step; }
.bb-steps__step::before {
  content: counter(bb-step); display: grid; place-items: center;
  width: var(--space-2xl); height: var(--space-2xl); margin-bottom: var(--space-xs);
  border-radius: var(--radius-full); background: var(--color-accent); color: var(--color-on-accent);
  font-weight: var(--weight-bold);
}
.bb-steps__title { font-size: var(--text-xl); font-weight: var(--weight-semibold); }
.bb-steps__body { ${MUTED} }
@container bb-page (min-width: 768px) { .bb-steps__list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Up and running in three steps' }),
        t.text({ part: 'intro', text: 'No migration project, no training week.' }),
      ]),
      t.box(
        { part: 'list', tag: 'ol' },
        (
          [
            ['Connect', 'Add the editor to your product and point it at a page.'],
            ['Compose', 'Start from complete sections and change whatever you like.'],
            ['Publish', 'Ship plain HTML and CSS that stays on brand.'],
          ] as const
        ).map(([title, body], i) =>
          t.box({ part: 'step', key: String(i + 1), tag: 'li' }, [
            t.text({ part: 'title', tag: 'h3', text: title }),
            t.text({ part: 'body', text: body }),
          ]),
        ),
      ),
    ]),
});

export const stats = defineSection({
  name: 'stats',
  version: 1,
  title: 'Numbers',
  category: 'content',
  description:
    'A row of key figures (stat-1 … stat-4; each a value and a label) under an optional heading. "tone" sets a brand or dark band.',
  variants: { tone: ['light', 'brand', 'dark'] },
  vars: {
    ...bg('stats'),
    '--stats-fg': {
      type: 'color',
      default: 'var(--color-on-surface)',
      description: 'Text colour.',
    },
  },
  css: `.bb-stats {
  display: grid; gap: var(--space-2xl); padding-block: var(--space-3xl); ${GUTTER}
  background: var(--stats-bg); color: var(--stats-fg);
}
.bb-stats--tone-brand { --stats-bg: var(--color-accent); --stats-fg: var(--color-on-accent); }
.bb-stats--tone-dark { --stats-bg: var(--color-surface-inverse); --stats-fg: var(--color-on-inverse); }
.bb-stats__heading { max-width: var(--size-prose); font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-stats__list { display: grid; gap: var(--space-xl) var(--space-lg); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bb-stats__stat {
  display: grid; gap: var(--space-2xs); align-content: start; padding-inline-start: var(--space-md);
  border-inline-start: 2px solid color-mix(in srgb, currentColor 25%, transparent);
}
.bb-stats__value { font-size: var(--text-4xl); font-weight: var(--weight-bold); letter-spacing: -0.03em; line-height: var(--leading-tight); }
.bb-stats__label { font-size: var(--text-sm); }
@container bb-page (min-width: 768px) {
  .bb-stats__list { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .bb-stats__value { font-size: var(--text-5xl); }
}`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.text({ part: 'heading', tag: 'h2', text: 'Trusted where it counts' }),
      t.box(
        { part: 'list', tag: 'ul' },
        (
          [
            ['12k+', 'Pages published'],
            ['99.9%', 'Uptime last year'],
            ['4.8/5', 'Average rating'],
            ['36', 'Countries'],
          ] as const
        ).map(([value, label], i) =>
          t.box({ part: 'stat', key: String(i + 1), tag: 'li' }, [
            t.text({ part: 'value', tag: 'strong', text: value }),
            t.text({ part: 'label', tag: 'span', text: label }),
          ]),
        ),
      ),
    ]),
});

export const cards = defineSection({
  name: 'cards',
  version: 1,
  title: 'Card grid',
  category: 'content',
  description:
    'Heading and a grid of cards (card-1, card-2, …; each an image, tag, title, text and link): articles, case studies, resources.',
  vars: bg('cards', 'surface-muted'),
  css: `${sectionCss('cards')}
${headerCss('cards')}
.bb-cards__grid { display: grid; gap: var(--space-lg); }
.bb-cards__card { display: flex; flex-direction: column; overflow: hidden; ${CARD} }
.bb-cards__image { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.bb-cards__body { display: flex; flex-direction: column; gap: var(--space-xs); flex: 1; padding: var(--space-lg); }
.bb-cards__tag {
  font-size: var(--text-xs); font-weight: var(--weight-semibold); letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--color-accent);
}
.bb-cards__title { font-size: var(--text-xl); font-weight: var(--weight-semibold); }
.bb-cards__text { ${MUTED} }
.bb-cards__link {
  align-self: flex-start; margin-top: auto; padding-block: var(--space-xs) var(--space-2xs);
  color: var(--color-accent); font-weight: var(--weight-semibold); text-decoration: none;
}
.bb-cards__link:hover { text-decoration: underline; }
@container bb-page (min-width: 768px) { .bb-cards__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container bb-page (min-width: 1024px) { .bb-cards__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'From the blog' }),
        t.text({ part: 'intro', text: 'Notes on building pages people can keep editing.' }),
      ]),
      t.box(
        { part: 'grid', tag: 'ul' },
        (
          [
            [
              'Guide',
              'Design tokens in ten minutes',
              'What they are and why your pages need them.',
            ],
            ['Story', 'How one team ships a page a day', 'A small process that keeps quality up.'],
            ['Update', 'What is new this month', 'Three changes worth knowing about.'],
          ] as const
        ).map(([tag, title, text], i) =>
          t.box({ part: 'card', key: String(i + 1), tag: 'li' }, [
            t.image({ part: 'image', src: placeholderPhoto(i), alt: '' }),
            t.box({ part: 'body' }, [
              t.text({ part: 'tag', text: tag }),
              t.text({ part: 'title', tag: 'h3', text: title }),
              t.text({ part: 'text', text }),
              t.link({ part: 'link', href: '#', text: 'Read more' }),
            ]),
          ]),
        ),
      ),
    ]),
});

export const gallery = defineSection({
  name: 'gallery',
  version: 1,
  title: 'Gallery',
  category: 'media',
  description:
    'Heading and a grid of square images (image-1, image-2, …). Add or remove images freely; "columns" sets how many fit side by side on wide screens.',
  variants: { columns: ['3', '4', '2'] },
  vars: bg('gallery'),
  css: `${sectionCss('gallery')}
${headerCss('gallery', 'center')}
.bb-gallery__grid { display: grid; gap: var(--space-md); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bb-gallery__image { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-md); }
@container bb-page (min-width: 768px) {
  .bb-gallery--columns-3 .bb-gallery__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .bb-gallery--columns-4 .bb-gallery__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}`,
  template: ({ variant }) =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'A look around' }),
        t.text({ part: 'intro', text: 'Moments from the last year.' }),
      ]),
      t.box(
        { part: 'grid' },
        Array.from({ length: variant.columns === '4' ? 8 : 6 }, (_, i) =>
          t.image({
            part: 'image',
            key: String(i + 1),
            src: placeholderPhoto(i),
            alt: `Photo ${i + 1}`,
          }),
        ),
      ),
    ]),
});

const PEOPLE = [
  ['Maya Okafor', 'Founder', 'Started the company after a decade of building editors.'],
  ['Jonas Weber', 'Design', 'Keeps every pixel and every token honest.'],
  ['Priya Raman', 'Engineering', 'Makes the hard parts look simple.'],
  ['Tomás Silva', 'Customer success', 'Answers before you finish asking.'],
] as const;

export const team = defineSection({
  name: 'team',
  version: 1,
  title: 'People',
  category: 'media',
  description:
    'Heading and a grid of people (person-1, person-2, …; each a photo, name, role and one line about them): a team, speakers, authors.',
  vars: bg('team'),
  css: `${sectionCss('team')}
${headerCss('team')}
.bb-team__grid { display: grid; gap: var(--space-xl) var(--space-lg); grid-template-columns: repeat(2, minmax(0, 1fr)); }
.bb-team__person { display: grid; gap: var(--space-2xs); align-content: start; }
.bb-team__photo { width: 100%; aspect-ratio: 1; object-fit: cover; margin-bottom: var(--space-xs); border-radius: var(--radius-lg); }
.bb-team__name { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.bb-team__role { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--color-accent); }
.bb-team__bio { font-size: var(--text-sm); ${MUTED} }
@container bb-page (min-width: 768px) { .bb-team__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'The people behind it' }),
        t.text({
          part: 'intro',
          text: 'Small on purpose, so you always talk to someone who knows.',
        }),
      ]),
      t.box(
        { part: 'grid', tag: 'ul' },
        PEOPLE.map(([name, role, bio], i) =>
          t.box({ part: 'person', key: String(i + 1), tag: 'li' }, [
            t.image({ part: 'photo', src: placeholderPortrait(i), alt: `Portrait of ${name}` }),
            t.text({ part: 'name', tag: 'h3', text: name }),
            t.text({ part: 'role', text: role }),
            t.text({ part: 'bio', text: bio }),
          ]),
        ),
      ),
    ]),
});

export const schedule = defineSection({
  name: 'schedule',
  version: 1,
  title: 'Schedule',
  category: 'content',
  description:
    'A timetable: heading and a list of entries (entry-1, entry-2, …; each a time, a title and a detail line). For agendas, programmes, opening hours, changelogs.',
  vars: bg('schedule'),
  css: `${sectionCss('schedule')}
${headerCss('schedule')}
.bb-schedule__list { display: grid; }
.bb-schedule__entry {
  display: grid; gap: var(--space-2xs) var(--space-lg); padding-block: var(--space-md);
  border-top: 1px solid var(--color-border);
}
.bb-schedule__entry:last-child { border-bottom: 1px solid var(--color-border); }
.bb-schedule__time { font-size: var(--text-sm); font-weight: var(--weight-semibold); font-variant-numeric: tabular-nums; color: var(--color-accent); }
.bb-schedule__title { font-size: var(--text-lg); font-weight: var(--weight-semibold); }
.bb-schedule__detail { ${MUTED} }
@container bb-page (min-width: 768px) {
  .bb-schedule__entry { grid-template-columns: 9rem minmax(0, 1fr); }
  .bb-schedule__time { grid-row: span 2; padding-top: 0.3em; }
}`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'header' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'The day at a glance' }),
        t.text({ part: 'intro', text: 'One track, so nobody has to choose.' }),
      ]),
      t.box(
        { part: 'list', tag: 'ol' },
        (
          [
            ['09:00', 'Doors and coffee', 'Pick up your badge and meet the others.'],
            ['10:00', 'Opening talk', 'Where we are and what comes next.'],
            ['12:30', 'Lunch', 'Served in the courtyard.'],
            ['14:00', 'Workshops', 'Hands-on sessions in small groups.'],
          ] as const
        ).map(([time, title, detail], i) =>
          t.box({ part: 'entry', key: String(i + 1), tag: 'li' }, [
            t.text({ part: 'time', text: time }),
            t.text({ part: 'title', tag: 'h3', text: title }),
            t.text({ part: 'detail', text: detail }),
          ]),
        ),
      ),
    ]),
});

export const content = defineSection({
  name: 'content',
  version: 1,
  title: 'Text',
  category: 'content',
  description:
    'Running text in a comfortable reading column: heading, a lead line and paragraphs of rich text (paragraph-1, paragraph-2, …). For about pages, announcements, terms.',
  variants: { align: ['start', 'center'] },
  vars: bg('content'),
  css: `.bb-content { padding-block: var(--space-3xl); ${GUTTER} background: var(--content-bg); }
.bb-content__inner { display: grid; gap: var(--space-lg); max-width: var(--size-prose); }
.bb-content--align-center .bb-content__inner { margin-inline: auto; }
.bb-content__heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
.bb-content__lead { font-size: var(--text-xl); ${MUTED} }
.bb-content__body { display: grid; gap: var(--space-md); font-size: var(--text-lg); }
.bb-content__body a { color: var(--color-accent); text-underline-offset: 0.2em; }`,
  template: () =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'inner' }, [
        t.text({ part: 'heading', tag: 'h2', text: 'Why we built this' }),
        t.text({
          part: 'lead',
          text: 'Pages are never finished, so the tools for changing them matter more than the tools for starting them.',
        }),
        t.box({ part: 'body' }, [
          t.richText({
            part: 'paragraph',
            key: '1',
            html: 'Most page builders are good at the first day. You pick a template, swap the words and publish. The trouble starts on day two, when someone needs to change <strong>one thing</strong> and three others move with it.',
          }),
          t.richText({
            part: 'paragraph',
            key: '2',
            html: 'We think small, checked edits are the answer: a change says exactly what it touches, anyone can see who made it, and taking it back is one step. <a href="#">Read how it works</a>.',
          }),
        ]),
      ]),
    ]),
});
