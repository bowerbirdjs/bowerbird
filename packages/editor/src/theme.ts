/**
 * The editor's look. Every token is a `--bb-editor-<name>` custom property a host can set on
 * `<bowerbird-editor>` (or any ancestor), or pass as `ui.tokens`. Defaults come in light and dark
 * (`ui.appearance`) and some in a compact size (`ui.density`). The page being edited never uses
 * these: it keeps the site's own design tokens.
 *
 * Inside the editor, each token resolves to `--bbe-<name>` (host value or default). The panels
 * (shadow DOM) and the canvas chrome (light DOM under the element) both read those.
 */

export type EditorTokenGroup = 'colour' | 'type' | 'shape' | 'density' | 'layout';

export interface EditorTokenSpec {
  group: EditorTokenGroup;
  /** Default value (light appearance, comfortable density). May use other tokens: `var(--bbe-accent)`. */
  value: string;
  /** Default in the dark appearance, when it differs. */
  dark?: string;
  /** Default with compact density, when it differs. */
  compact?: string;
  description: string;
}

const tok = (
  group: EditorTokenGroup,
  value: string,
  description: string,
  more: { dark?: string; compact?: string } = {},
): EditorTokenSpec => ({ group, value, description, ...more });

export const EDITOR_TOKENS = {
  // Colour
  accent: tok(
    'colour',
    '#4f46e5',
    'Brand colour: selection on the page, focus rings, primary buttons, the active tab.',
    { dark: '#6366f1' },
  ),
  'accent-fg': tok('colour', '#ffffff', 'Text and icons on the accent colour.'),
  'accent-text': tok(
    'colour',
    'var(--bbe-accent)',
    'The accent used as text (links, the active tab, counts), readable on the panels.',
    { dark: 'color-mix(in srgb, var(--bbe-accent) 55%, #ffffff)' },
  ),
  fg: tok('colour', '#18181b', 'Text.', { dark: '#f4f4f5' }),
  muted: tok('colour', '#71717a', 'Secondary text: hints, kinds, times.', { dark: '#a1a1aa' }),
  bg: tok('colour', '#ffffff', 'Top bar and the editor’s background.', { dark: '#18181b' }),
  panel: tok('colour', '#fafafa', 'Side panels.', { dark: '#1c1c1f' }),
  surface: tok('colour', '#ffffff', 'Inputs, cards and the field panel on the page.', {
    dark: '#26262a',
  }),
  border: tok('colour', '#e4e4e7', 'Dividers between areas.', { dark: '#2e2e33' }),
  'border-strong': tok('colour', '#d4d4d8', 'Borders of inputs, buttons and cards.', {
    dark: '#3f3f46',
  }),
  hover: tok(
    'colour',
    'color-mix(in srgb, var(--bbe-fg) 6%, transparent)',
    'Background of hovered rows and buttons.',
    { dark: 'color-mix(in srgb, var(--bbe-fg) 8%, transparent)' },
  ),
  selected: tok(
    'colour',
    'color-mix(in srgb, var(--bbe-accent) 12%, transparent)',
    'Background of the selected layer and pressed buttons.',
    { dark: 'color-mix(in srgb, var(--bbe-accent) 26%, transparent)' },
  ),
  focus: tok('colour', 'var(--bbe-accent)', 'Keyboard focus rings.'),
  danger: tok('colour', '#dc2626', 'Delete buttons and errors.', { dark: '#f87171' }),
  warning: tok('colour', '#b45309', 'Pending review, changed elements, warnings.', {
    dark: '#fbbf24',
  }),
  success: tok('colour', '#15803d', 'Elements an agent added.', { dark: '#4ade80' }),
  linked: tok('colour', '#7c3aed', 'Linked components.', { dark: '#a78bfa' }),
  agent: tok('colour', '#0e7490', 'Agents: their badges in history and review.', {
    dark: '#22d3ee',
  }),
  'floating-bg': tok(
    'colour',
    '#18181b',
    'The toolbar on the selected element, banners and messages.',
    { dark: '#3f3f46' },
  ),
  'floating-fg': tok('colour', '#fafafa', 'Text and icons on `floating-bg`.'),
  'canvas-bg': tok(
    'colour',
    '#ececf0',
    'Around the page: a colour, or any CSS background (a dot grid, a gradient).',
    { dark: '#0e0e10' },
  ),
  selection: tok(
    'colour',
    'var(--bbe-accent)',
    'Outlines on the page: hover, selection, drop targets, text being edited.',
  ),
  // Type
  font: tok(
    'type',
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    'Font of the editor (not of the page).',
  ),
  'font-mono': tok(
    'type',
    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    'Ids, CSS properties and code.',
  ),
  'font-size': tok('type', '13px', 'Base text size; smaller labels scale with it.', {
    compact: '12px',
  }),
  // Shape
  radius: tok('shape', '6px', 'Corners of buttons, inputs and rows.'),
  'radius-lg': tok('shape', '10px', 'Corners of cards, menus and the field panel.'),
  shadow: tok(
    'shape',
    '0 1px 2px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .12)',
    'Shadow of floating things: toolbars on the page, the field panel, messages.',
    { dark: '0 1px 2px rgb(0 0 0 / .5), 0 8px 24px rgb(0 0 0 / .45)' },
  ),
  'shadow-card': tok('shape', '0 1px 2px rgb(0 0 0 / .04)', 'Resting shadow of cards (Insert).', {
    dark: 'none',
  }),
  // Density
  space: tok('density', '4px', 'Spacing unit: paddings and gaps are multiples of it.', {
    compact: '3px',
  }),
  'control-height': tok('density', '30px', 'Height of buttons, inputs and layer rows.', {
    compact: '26px',
  }),
  // Layout
  left: tok('layout', '264px', 'Width of the structure panel (Layers, Insert, History).'),
  right: tok('layout', '300px', 'Width of the inspector.'),
} as const satisfies Record<string, EditorTokenSpec>;

export type EditorToken = keyof typeof EDITOR_TOKENS;
/** Token values to set, e.g. `{ accent: '#0f766e', radius: '0px' }`. */
export type EditorTokens = Partial<Record<EditorToken, string>>;

/** `light` (default), `dark`, or `auto` (follows the system setting). */
export type EditorAppearance = 'light' | 'dark' | 'auto';
/** `comfortable` (default) or `compact` (smaller controls, tighter spacing). */
export type EditorDensity = 'comfortable' | 'compact';

const entries = Object.entries(EDITOR_TOKENS) as [EditorToken, EditorTokenSpec][];

const declarations = (pick: (spec: EditorTokenSpec) => string | undefined): string =>
  entries
    .flatMap(([name, spec]) => {
      const value = pick(spec);
      return value === undefined ? [] : [`--bbe-${name}: var(--bb-editor-${name}, ${value});`];
    })
    .join('\n    ');

function tokenRules(sel: { base: string; compact: string; dark: string; auto: string }): string {
  return `
  ${sel.base} {
    ${declarations((s) => s.value)}
  }
  ${sel.compact} {
    ${declarations((s) => s.compact)}
  }
  ${sel.dark} {
    ${declarations((s) => s.dark)}
  }
  @media (prefers-color-scheme: dark) {
    ${sel.auto} {
      ${declarations((s) => s.dark)}
    }
  }
`;
}

/**
 * The token defaults for the element's shadow root: light and comfortable on `:host`, overridden
 * for `[appearance="dark"]`, `[appearance="auto"]` in a dark system setting, and
 * `[density="compact"]`. Generated from `EDITOR_TOKENS`, so the table is the documentation.
 */
export const TOKEN_CSS = `${tokenRules({
  base: ':host',
  compact: ":host([density='compact'])",
  dark: ":host([appearance='dark'])",
  auto: ":host([appearance='auto'])",
})}
  :host { color-scheme: light; }
  :host([appearance='dark']) { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { :host([appearance='auto']) { color-scheme: dark; } }
`;

/**
 * The same defaults for the canvas chrome (light DOM, a direct child of the element). It resolves
 * the tokens itself, from the same `--bb-editor-*` values, so it also works on its own.
 */
export const CANVAS_TOKEN_CSS = tokenRules({
  base: '.bbx-host',
  compact: "[density='compact'] > .bbx-host",
  dark: "[appearance='dark'] > .bbx-host",
  auto: "[appearance='auto'] > .bbx-host",
});

/** Whether a name is a token (`accent`, `radius-lg`). */
export const isEditorToken = (name: string): name is EditorToken =>
  Object.hasOwn(EDITOR_TOKENS, name);
