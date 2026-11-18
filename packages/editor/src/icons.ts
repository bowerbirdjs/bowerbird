/**
 * The editor's icons: simple outline drawings on a 24-unit grid, stroked with `currentColor` so
 * they take the colour of their text. Drawn for Bowerbird (no icon library, no licence to carry).
 * Markup strings, so the Lit panels and the plain-DOM canvas chrome share them.
 */

/** Dots drawn as tiny circles whose stroke fills them (icons are stroke-only, see `iconMarkup`). */
const dots = (points: [number, number][]) =>
  points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" stroke-width="2.2"/>`).join('');

const PATHS = {
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14.5 4v16"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  desktop: '<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8.5 21h7M12 17v4"/>',
  tablet: '<rect x="5" y="2.5" width="14" height="19" rx="2.5"/><path d="M11 18h2"/>',
  mobile: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  grip: dots([
    [9, 6],
    [15, 6],
    [9, 12],
    [15, 12],
    [9, 18],
    [15, 18],
  ]),
  parent: '<path d="M20 20h-7a5 5 0 0 1-5-5V4"/><path d="m4 8 4-4 4 4"/>',
  'arrow-up': '<path d="M12 19V5M6 11l6-6 6 6"/>',
  'arrow-down': '<path d="M12 5v14M6 13l6 6 6-6"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  trash:
    '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5h6V7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  section:
    '<rect x="3" y="3.5" width="18" height="7" rx="1.5"/><rect x="3" y="13.5" width="18" height="7" rx="1.5"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2.5"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  paragraph: '<path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h10"/>',
  image:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  button: '<rect x="3" y="7" width="18" height="10" rx="5"/><path d="M9 12h6"/>',
  component:
    '<path d="m12 3 4 4-4 4-4-4 4-4ZM12 13l4 4-4 4-4-4 4-4ZM7 8l4 4-4 4-4-4 4-4ZM17 8l4 4-4 4-4-4 4-4Z"/>',
  blocks:
    '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.6 5.7 3.6 9s-1.1 6.3-3.6 9c-2.5-2.7-3.6-5.7-3.6-9S9.5 5.7 12 3Z"/>',
  page: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>',
  warning: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  unlink:
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7"/><path d="M4 4l16 16"/>',
  reset: '<path d="M4 4v5h5"/><path d="M4.5 13a7.5 7.5 0 1 0 2-6.5L4 9"/>',
} as const;

export type IconName = keyof typeof PATHS;

/**
 * The icon as SVG markup, sized by CSS (`.bb-icon` in the panels, `.bbx-icon` on the canvas).
 * Stroke-only: the canvas chrome sets the stroke in CSS too, since its reset reverts attributes.
 */
export function iconMarkup(name: IconName, className = 'bb-icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** The icon for a node type in the layers tree and the inspector. */
export function iconForType(
  type: string,
  opts: { section?: boolean; linked?: boolean; tag?: unknown } = {},
): IconName {
  if (opts.linked) return 'component';
  if (opts.section) return 'section';
  switch (type) {
    case 'box':
      return 'box';
    case 'text':
      return typeof opts.tag === 'string' && /^h[1-6]$/.test(opts.tag) ? 'heading' : 'text';
    case 'rich-text':
      return 'paragraph';
    case 'image':
      return 'image';
    case 'link':
      return 'link';
    case 'button':
      return 'button';
    default:
      return 'blocks';
  }
}
