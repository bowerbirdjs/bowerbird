import type { FreedomLevel } from '@bowerbirdjs/core';
import type { EditorIcons } from './icons.js';
import type { EditorStrings } from './strings.js';
import type { EditorAppearance, EditorDensity, EditorTokens } from './theme.js';

/**
 * Every part of the editor a host can turn off, with what it is. A key with a dot belongs to the
 * key before it: turning off `inspector` also hides `inspector.styles`. Action keys (`insert`,
 * `move`, `duplicate`, `delete`, `text`, `components`, `undo`) remove every way to do that action:
 * buttons, drag and drop and keyboard shortcuts.
 *
 * Hiding something is not a permission: the store's policy decides what may change. By default the
 * editor offers only what the policy allows its actor (see `EditorUI.preset`).
 */
export const EDITOR_FEATURES = {
  toolbar: 'The top bar.',
  'toolbar.panels': 'Buttons that show or hide the side panels.',
  'toolbar.pages': 'Page switcher (without it, the page title shows).',
  'toolbar.peers': 'Avatars of the people and agents in the document.',
  'toolbar.breakpoints': 'Screen size buttons.',
  'toolbar.zoom': 'Zoom menu.',
  'toolbar.language': 'Language menu (for sites with translations).',
  'toolbar.theme': 'Theme preview menu.',
  'toolbar.preview': 'Preview button (hides editing outlines).',
  structure: 'The left panel.',
  'structure.layers': 'Layers tab.',
  'structure.history': 'History tab.',
  'structure.review': 'Review tab, while changes are waiting for review.',
  inspector: 'The right panel.',
  'inspector.page': 'Page title, path and description (shown when nothing is selected).',
  'inspector.info': 'Name, type and id of the selected element.',
  'inspector.provenance': 'Who changed the selected element last.',
  'inspector.content': 'Content fields of the selected element.',
  'inspector.content.advanced':
    'Fields other than text, links and images (heading level, button style…).',
  'inspector.section': 'Section variants (layout options of a section).',
  'inspector.section.settings': 'Section settings (colours, spacing).',
  'inspector.styles': 'Style editor.',
  'canvas.toolbar': 'Toolbar on the selected element.',
  'canvas.label': 'Label naming the selected element.',
  'canvas.peers': 'Other people’s and agents’ selections on the page.',
  insert: 'Adding content: the Insert tab and dropping new things onto the page.',
  'insert.sections': 'Section templates.',
  'insert.elements': 'Single elements (text, image, button…).',
  'insert.components': 'Linked components.',
  move: 'Moving and reordering: drag and drop, ↑/↓ buttons, Alt+arrow keys.',
  duplicate: 'Duplicating: buttons and Ctrl+D.',
  delete: 'Deleting: buttons and the Delete key.',
  text: 'Editing text on the page (double-click or Enter).',
  'text.formatting': 'Bold, italic and links in rich text (Ctrl+B, Ctrl+I, Ctrl+K).',
  data: 'Editing site data on the page: double-click text shown from data (a form opens for times, dates, links and colours).',
  'data.items': 'List items shown from data: add, move, copy or remove them on the page.',
  'canvas.fields':
    'Fields on the page for what isn’t text on the selected element (a photo, its alt text, a link’s address).',
  components: 'Linked components: their panel, editing a definition, detaching an instance.',
  'components.create': 'Making a section a linked component.',
  'components.reset': 'Resetting an instance to its definition.',
  undo: 'Undo and redo: buttons, shortcuts and undoing someone else’s work.',
} as const;

export type EditorFeature = keyof typeof EDITOR_FEATURES;
export type FeatureSettings = Partial<Record<EditorFeature, boolean>>;

/** Elements offered in the Insert tab. */
export const EDITOR_ELEMENTS = [
  'box',
  'text',
  'heading',
  'rich-text',
  'link',
  'button',
  'image',
  'icon',
  'accordion',
  'form',
  'field',
] as const;
export type EditorElementName = (typeof EDITOR_ELEMENTS)[number];

/**
 * How much of the editor people see:
 * - `full`: everything.
 * - `layout`: add, arrange and fill sections; no styling.
 * - `content`: text, links and images only.
 */
export type EditorPreset = 'full' | 'layout' | 'content';

export const EDITOR_PRESETS: Record<EditorPreset, FeatureSettings> = {
  full: {},
  layout: {
    'inspector.styles': false,
    'inspector.section.settings': false,
    'components.create': false,
    'components.reset': false,
  },
  content: {
    insert: false,
    move: false,
    duplicate: false,
    delete: false,
    components: false,
    'structure.layers': false,
    'structure.history': false,
    'inspector.page': false,
    'inspector.info': false,
    'inspector.content.advanced': false,
    'inspector.section': false,
    'inspector.styles': false,
    'canvas.toolbar': false,
    'canvas.label': false,
  },
};

/** The preset that offers what a policy level allows. */
export function presetForLevel(level: FreedomLevel | undefined): EditorPreset {
  return level === 'content' ? 'content' : level === 'layout' ? 'layout' : 'full';
}

/** What the editor offers. Everything is optional; the default is `{ preset: 'auto' }`. */
export interface EditorUI {
  /**
   * Starting point. `auto` (default) follows the store policy: the editor offers what the policy
   * lets its actor change (`content` level gets the `content` preset, and so on).
   */
  preset?: EditorPreset | 'auto';
  /** Turns single features on or off on top of the preset, e.g. `{ 'toolbar.zoom': false }`. */
  features?: FeatureSettings;
  /** Section templates offered in Insert, by name. Default: all registered sections. */
  sections?: readonly string[];
  /** Elements offered in Insert. Default: all of `EDITOR_ELEMENTS`. */
  elements?: readonly EditorElementName[];
  /** CSS properties the style editor offers. Default: any property. */
  styleProperties?: readonly string[];
  /** Light or dark editor; `auto` follows the system setting. Default `light`. The page keeps its own colours. */
  appearance?: EditorAppearance;
  /** `compact` makes controls smaller and spacing tighter. Default `comfortable`. */
  density?: EditorDensity;
  /**
   * Design tokens of the editor (see `EDITOR_TOKENS`), e.g. `{ accent: '#0f766e', radius: '2px' }`.
   * The same as setting `--bb-editor-accent` and so on in CSS; set here, they win over CSS.
   */
  tokens?: EditorTokens;
  /**
   * Your own icons in place of the built-in ones, as SVG markup by name (`ICON_NAMES`), e.g. from
   * your icon package. Trusted markup only: plain drawings, no scripts or handlers (others are
   * ignored with a warning). Icons follow the text colour (`currentColor`).
   */
  icons?: EditorIcons;
  /**
   * Words on the canvas in your language (see `EditorStrings`; any subset, the rest stay English),
   * e.g. `{ moveUp: 'Nach oben', selectionLabel: (n) => n.title ?? n.type }`.
   */
  strings?: Partial<EditorStrings>;
}

/** The resolved settings: which features are on, and the allowlists. */
export class EditorFeatures {
  readonly preset: EditorPreset;
  private readonly settings: FeatureSettings;

  constructor(
    readonly ui: EditorUI = {},
    level?: FreedomLevel,
  ) {
    const preset = !ui.preset || ui.preset === 'auto' ? presetForLevel(level) : ui.preset;
    this.preset = Object.hasOwn(EDITOR_PRESETS, preset) ? preset : 'full';
    this.settings = { ...EDITOR_PRESETS[this.preset], ...(ui.features ?? {}) };
  }

  /** Whether a feature is on: it and every feature it belongs to. */
  on(feature: EditorFeature): boolean {
    let key = feature as string;
    for (;;) {
      if (this.settings[key as EditorFeature] === false) return false;
      const dot = key.lastIndexOf('.');
      if (dot < 0) return true;
      key = key.slice(0, dot);
    }
  }

  /** Whether a section template is offered (and `insert.sections` is on). */
  section(name: string): boolean {
    return this.on('insert.sections') && (!this.ui.sections || this.ui.sections.includes(name));
  }

  /** Whether an element is offered (and `insert.elements` is on). */
  element(name: EditorElementName): boolean {
    return this.on('insert.elements') && (!this.ui.elements || this.ui.elements.includes(name));
  }

  /** Whether the style editor offers a CSS property. */
  styleProperty(property: string): boolean {
    return (
      this.on('inspector.styles') &&
      (!this.ui.styleProperties || this.ui.styleProperties.includes(property))
    );
  }
}
