/** Horizontal padding that centres content within `--size-content` without a wrapper element. */
export const GUTTER = 'padding-inline: max(var(--space-lg), (100% - var(--size-content)) / 2);';

/** Muted text that adapts to whatever colour the section uses. */
export const MUTED = 'color: color-mix(in srgb, currentColor 70%, transparent);';

export function primaryButton(selector: string): string {
  return `${selector} {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md);
  background: var(--color-accent); color: var(--color-on-accent);
  font-size: var(--text-sm); font-weight: var(--weight-semibold); text-decoration: none;
  transition: background-color 0.15s ease;
}
${selector}:hover { background: var(--color-accent-hover); }`;
}

export function secondaryButton(selector: string): string {
  return `${selector} {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); color: inherit;
  font-size: var(--text-sm); font-weight: var(--weight-semibold); text-decoration: none;
  transition: background-color 0.15s ease;
}
${selector}:hover { background: color-mix(in srgb, currentColor 8%, transparent); }`;
}

/** A soft illustrated placeholder for media slots (inline SVG, no network needed). */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23e0e7ff'/%3E%3Cstop offset='1' stop-color='%23c7d2fe'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='600' fill='url(%23g)'/%3E%3Crect x='80' y='90' width='640' height='420' rx='24' fill='%23fff' opacity='.9'/%3E%3Crect x='120' y='140' width='240' height='28' rx='8' fill='%234f46e5'/%3E%3Crect x='120' y='190' width='420' height='16' rx='8' fill='%23c7d2fe'/%3E%3Crect x='120' y='222' width='360' height='16' rx='8' fill='%23c7d2fe'/%3E%3Crect x='120' y='290' width='260' height='170' rx='16' fill='%23eef2ff'/%3E%3Crect x='410' y='290' width='270' height='170' rx='16' fill='%23e0e7ff'/%3E%3C/svg%3E";

/** An inline SVG as a data URI (no network needed, safe to store in a document). */
function svgUri(svg: string): string {
  return `data:image/svg+xml,${svg
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/\s+/g, ' ')}`;
}

/** Soft palettes for placeholder pictures: sky, far and near ground, accent. */
const PALETTES: [string, string, string, string][] = [
  ['#e0e7ff', '#c7d2fe', '#a5b4fc', '#eef2ff'],
  ['#dbeafe', '#bfdbfe', '#93c5fd', '#eff6ff'],
  ['#ede9fe', '#ddd6fe', '#c4b5fd', '#f5f3ff'],
  ['#e2e8f0', '#cbd5e1', '#94a3b8', '#f8fafc'],
];

/** A placeholder photo: a quiet landscape. `index` picks one of a few palettes. */
export function placeholderPhoto(index = 0): string {
  const [sky, far, near, sun] = PALETTES[index % PALETTES.length]!;
  const flip = index % 2 === 1;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
      <rect width="800" height="600" fill="${sky}"/>
      <circle cx="${flip ? 230 : 580}" cy="190" r="64" fill="${sun}"/>
      <path d="M0 ${flip ? 380 : 430}C160 ${flip ? 330 : 350} 320 ${flip ? 440 : 400} 480 ${flip ? 400 : 370}S720 ${flip ? 320 : 420} 800 ${flip ? 350 : 390}V600H0Z" fill="${far}"/>
      <path d="M0 ${flip ? 500 : 470}C200 ${flip ? 430 : 520} 380 ${flip ? 540 : 440} 560 ${flip ? 480 : 500}S740 ${flip ? 520 : 450} 800 ${flip ? 470 : 480}V600H0Z" fill="${near}"/>
    </svg>`,
  );
}

/** A placeholder portrait: head and shoulders. `index` picks one of a few palettes. */
export function placeholderPortrait(index = 0): string {
  const [bg, , figure] = PALETTES[index % PALETTES.length]!;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="${bg}"/>
      <circle cx="200" cy="160" r="70" fill="${figure}"/>
      <path d="M60 400c0-80 62-140 140-140s140 60 140 140Z" fill="${figure}"/>
    </svg>`,
  );
}

/**
 * The heading block most sections start with: eyebrow, heading and intro, as
 * `.bb-<name>__header|eyebrow|heading|intro`.
 */
export function headerCss(name: string, align: 'start' | 'center' = 'start'): string {
  const el = `.bb-${name}__`;
  return `${el}header { display: grid; gap: var(--space-md); max-width: var(--size-prose);${
    align === 'center' ? ' justify-items: center; text-align: center; margin-inline: auto;' : ''
  } }
${el}eyebrow {
  font-size: var(--text-sm); font-weight: var(--weight-semibold); letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--color-accent);
}
${el}heading { font-size: var(--text-3xl); font-weight: var(--weight-bold); letter-spacing: -0.02em; }
${el}intro { font-size: var(--text-lg); ${MUTED} }`;
}

/** The outer box of a section: vertical rhythm, gutters and its background variable. */
export function sectionCss(name: string, pad = 'var(--space-4xl)'): string {
  return `.bb-${name} { display: grid; gap: var(--space-2xl); padding-block: ${pad}; ${GUTTER} background: var(--${name}-bg); }`;
}

/** A card on the page's surface colour, whatever the section's background. */
export const CARD =
  'background: var(--color-surface); color: var(--color-on-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg);';
