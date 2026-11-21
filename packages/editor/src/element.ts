import { createDefaultRegistry, createStarterDoc, PLACEHOLDER_IMAGE } from '@bowerbirdjs/blocks';
import {
  type Actor,
  type BNode,
  type ComponentDef,
  createStore,
  describeOp,
  flattenTokens,
  formatIssue,
  type Issue,
  iconSvg,
  instanceRootOf,
  localizedProps,
  type NodeInput,
  overridesOf,
  type SectionDef,
  STATE_PSEUDO,
  type Store,
} from '@bowerbirdjs/core';
import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { CanvasView, type ComponentMount, createPageSlots } from './canvas.js';
import { EditorController, type EditorEvent, type Position } from './controller.js';
import { currentDrag, type DragPayload, endDrag, performDrop, startDrag } from './dnd.js';
import type { EditorElementName, EditorPreset, EditorUI } from './features.js';
import { ICON_NAMES, type IconName, iconForType, iconMarkup, isIconMarkup } from './icons.js';
import { type Field, fieldsForNode, fieldValue, withCompanions } from './schema-form.js';
import { editorStyles } from './styles.js';
import {
  EDITOR_TOKENS,
  type EditorAppearance,
  type EditorDensity,
  type EditorTokens,
  isEditorToken,
} from './theme.js';
import {
  buildSectionThumbs,
  groupSections,
  matchesQuery,
  type SectionThumbs,
  THUMB_WIDTH,
} from './thumbnails.js';

const ELEMENT_ICONS: Record<EditorElementName, IconName> = {
  box: 'box',
  text: 'text',
  heading: 'heading',
  'rich-text': 'paragraph',
  link: 'link',
  button: 'button',
  image: 'image',
  icon: 'star',
  accordion: 'accordion',
  form: 'form',
  field: 'field',
};

/** Icon for a breakpoint: by its name, else by its width. */
function breakpointIcon(bp: { id: string; label?: string; minWidth: number }): IconName {
  const name = `${bp.id} ${bp.label ?? ''}`;
  if (/mobile|phone/i.test(name)) return 'mobile';
  if (/tablet/i.test(name)) return 'tablet';
  if (/desktop|wide|laptop/i.test(name)) return 'desktop';
  return bp.minWidth < 600 ? 'mobile' : bp.minWidth < 1024 ? 'tablet' : 'desktop';
}

const ELEMENTS: [EditorElementName, string, NodeInput][] = [
  ['box', 'Box', { type: 'box' }],
  ['text', 'Text', { type: 'text', props: { text: 'New text' } }],
  ['heading', 'Heading', { type: 'text', props: { tag: 'h2', text: 'New heading' } }],
  [
    'rich-text',
    'Rich text',
    { type: 'rich-text', props: { html: 'Text with <strong>bold</strong> and <em>italic</em>.' } },
  ],
  ['link', 'Link', { type: 'link', props: { text: 'Link', href: '#' } }],
  ['button', 'Button', { type: 'button', props: { text: 'Button' } }],
  ['image', 'Image', { type: 'image', props: { src: PLACEHOLDER_IMAGE, alt: '' } }],
  // The icon's name is filled in from the registry's icon set when it is offered.
  ['icon', 'Icon', { type: 'icon', props: { name: 'star' } }],
  [
    'accordion',
    'Accordion item',
    {
      type: 'details',
      children: [
        { type: 'text', props: { tag: 'summary', text: 'A question people ask' } },
        { type: 'text', props: { text: 'The answer, shown when the question is opened.' } },
      ],
    },
  ],
  [
    'form',
    'Form',
    {
      type: 'form',
      children: [
        { type: 'field', props: { type: 'email', name: 'email', label: 'Email', required: true } },
        { type: 'button', props: { type: 'submit', text: 'Send' } },
      ],
    },
  ],
  ['field', 'Form field', { type: 'field', props: { name: 'field', label: 'Label' } }],
];

/** The icon a new icon element starts with: a familiar one if the site's set has it. */
function starterIcon(names: string[]): string | undefined {
  return names.includes('star') ? 'star' : names[0];
}

const COMMON_PROPS = [
  'display',
  'gap',
  'padding',
  'padding-block',
  'padding-inline',
  'margin',
  'margin-block',
  'margin-inline',
  'color',
  'background',
  'border',
  'border-radius',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'text-align',
  'width',
  'max-width',
  'min-height',
  'grid-template-columns',
  'flex-direction',
  'align-items',
  'justify-content',
  'box-shadow',
  'opacity',
];

const VAR_FAMILY: Record<string, string> = {
  color: '--color-',
  space: '--space-',
  size: '--size-',
  radius: '--radius-',
  font: '--font-',
  shadow: '--shadow-',
};

/** Shortest and tallest a section preview gets in its card (px). */
const THUMB_MIN = 36;
const THUMB_MAX = 148;

/** Below this width (px) of its own, the editor lays its panels over the canvas. */
const NARROW_WIDTH = 900;

/** A provenance key in words: `props.text` → "text", `l10n.de.text` → "text (de)". */
function fieldLabel(field: string): string {
  const l10n = /^l10n\.([^.]+)\.(.+)$/.exec(field);
  if (l10n) return `${l10n[2]} (${l10n[1]})`;
  return field.replace(/^props\./, '');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

const TABS = ['layers', 'insert', 'history', 'review'] as const;
type TabName = (typeof TABS)[number];

const timeAgo = (time: number) => {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** A store with the default sections and tokens and an empty home page. */
export function createDefaultStore(): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({
    actor: { kind: 'system', id: 'bowerbird' },
    label: 'New site',
    ops: [{ op: 'page.create', path: '/', title: 'Home' }],
  });
  return store;
}

/** Stores files the person picks (images) and returns where they can be loaded from. */
export interface AssetAdapter {
  upload(file: File): Promise<{ src: string; alt?: string; width?: number; height?: number }>;
}

export interface EditorChangeDetail {
  doc: Store['doc'];
}

/**
 * `<bowerbird-editor>`: the embeddable visual editor.
 *
 * Properties: `store` (a Bowerbird store; one is created if omitted), `actor` (who edits, default
 * the local user), `page` (page id, reflected), `ui` (what the editor offers, see `EditorUI`),
 * `assets` (image uploads), `hostComponents` (attribute `host-components`: you draw code
 * components and their children on the canvas yourself, see `mounts`), `pageAttributes`
 * (attributes for the page frame, an element around the page's content that the editor's resets
 * leave alone, e.g. the attribute and custom properties your site CSS is scoped to), `pageSlots`
 * (elements for your own markup at the start and end of the frame). Attributes `preset` (`full`, `layout`, `content`), `appearance`
 * (`light`, `dark`, `auto`) and `density` (`comfortable`, `compact`) are shorthands for the same
 * `ui` settings. The look follows the `--bb-editor-*` design tokens (see `EDITOR_TOKENS`).
 * Events (bubbling, composed): `bb-change`, `bb-transaction`, `bb-selection`, `bb-page`,
 * `bb-error`, `bb-changesets` (proposed changes waiting for review changed), `bb-data-click`
 * (text shown from site data was clicked: `{ path, node }`), `bb-mounts` (with
 * `hostComponents`: the code components to draw changed, `{ mounts }`).
 * Methods: `apply(ops, label)`, `select(id)`, `undo()`, `redo()`, `componentsRendered()`.
 * Slots: `toolbar-start`, `toolbar-end` (your own controls in the top bar).
 * Parts (for `::part()`): `toolbar`, `title` (page title), `structure`, `inspector`, `tabs`, `tab`,
 * `panel-section`, `heading`, `layer`, `card`, `button` (also `primary`, `danger`), `field`,
 * `label`, `input`, `select`, `toast`.
 *
 * The panels live in this element's shadow root; the page canvas is a light-DOM child, so page
 * content is never inside a shadow root (see docs/plan.md §2.1).
 */
export class BowerbirdEditor extends LitElement {
  static override styles = editorStyles;
  static override properties = {
    store: { attribute: false },
    actor: { attribute: false },
    assets: { attribute: false },
    ui: { attribute: false },
    hostComponents: { type: Boolean, attribute: 'host-components', reflect: true },
    pageAttributes: { attribute: false },
    preset: { type: String },
    appearance: { type: String, reflect: true },
    density: { type: String, reflect: true },
    page: { type: String, reflect: true },
    tab: { state: true },
    tick: { state: true },
    toast: { state: true },
  };

  declare store: Store | undefined;
  declare actor: Actor | undefined;
  /** Where uploaded images go. Without it, image fields take URLs only. */
  declare assets: AssetAdapter | undefined;
  /** What the editor offers; see `EditorUI`. */
  declare ui: EditorUI | undefined;
  /**
   * You draw code components (`kind: 'code'`) on the canvas with your own framework: each one gets
   * a mount element (`mounts`, event `bb-mounts`) that stays the same while the page changes. You
   * draw a code component's child nodes too (the editor renders none), each in an element marked
   * `data-bb-node="<id>"` so it can be selected, moved and edited.
   */
  declare hostComponents: boolean | undefined;
  /**
   * Attributes for the page frame (`data-bb-frame`), an element around the page's content inside
   * its root: `data-*`, `lang`, `class`, `style` and the like. The editor's resets and base styles
   * leave it alone, so site CSS scoped to an attribute on your site's root applies there as on your
   * own pages.
   */
  declare pageAttributes: Record<string, string> | undefined;
  /** Shorthand for `ui.preset` (which wins when both are set). */
  declare preset: EditorPreset | 'auto' | undefined;
  /** Light or dark editor (`auto` follows the system). `ui.appearance` wins when both are set. */
  declare appearance: EditorAppearance | undefined;
  /** `compact` or `comfortable` (default). `ui.density` wins when both are set. */
  declare density: EditorDensity | undefined;
  declare page: string | undefined;
  declare tab: TabName;
  declare tick: number;
  declare toast: { message: string; hint?: string } | null;

  controller: EditorController | undefined;
  canvas: CanvasView | undefined;
  private canvasHost: HTMLElement | undefined;
  private expanded = new Set<string>();
  private layerDrop: { id: string; where: 'before' | 'after' | 'inside' } | null = null;
  private styleState = 'default';
  private newProp = '';
  private newValue = '';
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnected = false;
  /** Watches the element's own width (it may sit in a narrow column, not just a small window). */
  private sizeObserver: ResizeObserver | undefined;
  /** Panel visibility from before the editor became narrow, restored when it widens again. */
  private widePanels: { left: boolean; right: boolean } | null = null;
  /** Layer row that holds keyboard focus (roving tabindex). */
  private focusedRow: string | null = null;
  private collapsedRoot = false;
  private symbolName = '';
  /** Tokens set from `ui.tokens` (see `applyTokens`). */
  private appliedTokens = new Set<string>();
  private tokenSheet: CSSStyleSheet | undefined;
  /** What the Insert tab is filtered by. */
  private insertQuery = '';
  /** Section previews, kept while the site's tokens, themes, data and sections stay the same. */
  private thumbs: { key: unknown[]; value: SectionThumbs } | undefined;
  private thumbSheet: CSSStyleSheet | HTMLStyleElement | undefined;
  private thumbCss = '';
  private thumbFrame = 0;
  private lastLook: Pick<EditorUI, 'appearance' | 'density'> = {};
  private visibleRows: {
    id: string;
    parent: string | null;
    hasChildren: boolean;
    open: boolean;
  }[] = [];

  constructor() {
    super();
    this.tab = 'insert';
    this.tick = 0;
    this.toast = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.disconnected = false;
    this.addEventListener('keydown', this.onKeyDown);
    this.sizeObserver ??= new ResizeObserver(([entry]) => {
      if (entry) this.setNarrow(entry.contentRect.width < NARROW_WIDTH);
    });
    this.sizeObserver.observe(this);
    // Set up on the first update rather than here, so properties that frameworks set right after
    // inserting the element (store, actor, page) are used from the start.
    if (!this.controller) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.sizeObserver?.disconnect();
    this.disconnected = true;
    // Moving the element (remove + insert in one task) keeps its state; a real removal releases
    // the store subscription and canvas. Reconnecting later sets them up again.
    queueMicrotask(() => {
      if (this.disconnected && !this.isConnected) this.destroy();
    });
  }

  /**
   * Narrow editors show the canvas and open one panel at a time over it; both start closed. The
   * panels' earlier state comes back when the editor is wide again.
   */
  private setNarrow(narrow: boolean): void {
    if (narrow === this.hasAttribute('narrow')) return;
    this.toggleAttribute('narrow', narrow);
    if (narrow) {
      this.widePanels = {
        left: this.hasAttribute('left-hidden'),
        right: this.hasAttribute('right-hidden'),
      };
      this.setAttribute('left-hidden', '');
      this.setAttribute('right-hidden', '');
    } else if (this.widePanels) {
      this.toggleAttribute('left-hidden', this.widePanels.left);
      this.toggleAttribute('right-hidden', this.widePanels.right);
      this.widePanels = null;
    }
    this.tick++;
  }

  /** Shows or hides a side panel; in a narrow editor, opening one closes the other. */
  private togglePanel(side: 'left' | 'right'): void {
    const open = this.toggleAttribute(`${side}-hidden`) === false;
    if (open && this.hasAttribute('narrow'))
      this.setAttribute(`${side === 'left' ? 'right' : 'left'}-hidden`, '');
    this.tick++;
  }

  /** Releases the store subscription and canvas. Happens automatically when the element is removed. */
  destroy(): void {
    this.canvas?.destroy();
    this.controller?.destroy();
    this.canvasHost?.remove();
    this.controller = undefined;
    this.canvas = undefined;
    this.canvasHost = undefined;
  }

  private init(): void {
    if (!this.store) this.store = createDefaultStore();
    const controller = new EditorController(this.store, {
      ...(this.actor ? { actor: this.actor } : {}),
      ...(this.page ? { page: this.page } : {}),
      ui: this.effectiveUI(),
    });
    this.controller = controller;
    controller.on((event) => this.onControllerEvent(event));
    this.page = controller.page;
    this.canvasHost = this.ownerDocument.createElement('div');
    this.canvasHost.slot = 'canvas';
    this.canvasHost.className = 'bbx-host';
    this.append(this.canvasHost);
    this.canvas = new CanvasView(this.canvasHost, controller);
    this.canvas.onMounts = (mounts) => this.emit('bb-mounts', { mounts });
    if (this.slotEls) this.canvas.pageSlots(this.slotEls);
    if (
      Object.keys(this.store.doc.pages).length &&
      !this.store.view.children(controller.currentPage?.rootId ?? '').length
    ) {
      this.tab = 'insert';
    } else this.tab = 'layers';
  }

  /** `ui.appearance` and `ui.density` as attributes (for the token CSS), `ui.tokens` as inline properties. */
  private applyLook(ui: EditorUI): void {
    // A value that came from an earlier `ui` goes away with it; attributes set directly stay.
    const last = this.lastLook;
    if (ui.appearance) this.appearance = ui.appearance;
    else if (last.appearance && this.appearance === last.appearance) this.appearance = undefined;
    if (ui.density) this.density = ui.density;
    else if (last.density && this.density === last.density) this.density = undefined;
    this.lastLook = { appearance: ui.appearance, density: ui.density };
    this.applyTokens(ui.tokens ?? {});
    for (const [name, markup] of Object.entries(ui.icons ?? {})) {
      if (!ICON_NAMES.includes(name as IconName))
        console.warn(
          `[bowerbird] ui.icons: "${name}" is not an editor icon. Icons: ${ICON_NAMES.join(', ')}.`,
        );
      else if (!isIconMarkup(markup))
        console.warn(
          `[bowerbird] ui.icons: "${name}" isn't plain SVG markup (an <svg> without scripts or handlers), so the built-in icon stays.`,
        );
    }
  }

  /**
   * `ui.tokens` live in a stylesheet of their own (`:host { --bb-editor-x: … !important }`), set
   * through the CSSOM so values can't add rules. Important shadow declarations outrank the page's,
   * so they win over host CSS without touching the element's own `style`.
   */
  private applyTokens(tokens: EditorTokens): void {
    const style = this.tokenStyle();
    const next = new Set<string>();
    for (const [name, value] of Object.entries(tokens)) {
      if (!isEditorToken(name)) {
        console.warn(
          `[bowerbird] ui.tokens: "${name}" is not an editor token. Tokens: ${Object.keys(EDITOR_TOKENS).join(', ')}.`,
        );
        continue;
      }
      if (typeof value !== 'string' || !value.trim()) continue;
      style.setProperty(`--bb-editor-${name}`, value, 'important');
      next.add(name);
    }
    for (const name of this.appliedTokens)
      if (!next.has(name)) style.removeProperty(`--bb-editor-${name}`);
    this.appliedTokens = next;
  }

  private tokenStyle(): CSSStyleDeclaration {
    const root = this.renderRoot;
    if (!this.tokenSheet && root instanceof ShadowRoot && 'adoptedStyleSheets' in root) {
      this.tokenSheet = new CSSStyleSheet();
      this.tokenSheet.replaceSync(':host {}');
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.tokenSheet];
    }
    // Without constructable stylesheets, the element's own style (which host CSS can't beat).
    return (this.tokenSheet?.cssRules[0] as CSSStyleRule | undefined)?.style ?? this.style;
  }

  private effectiveUI(): EditorUI {
    const ui = this.ui ?? {};
    return ui.preset || !this.preset ? ui : { ...ui, preset: this.preset };
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.controller) {
      if (!this.isConnected) return;
      this.init();
    }
    const c = this.controller!;
    // Read the requested page first: switching stores resets the page.
    const requested = changed.has('page') ? this.page : undefined;
    if (changed.has('store') && this.store && this.store !== c.store) c.setStore(this.store);
    if (changed.has('actor') && this.actor) c.actor = this.actor;
    if (changed.has('ui') || changed.has('preset')) c.setUI(this.effectiveUI());
    if (changed.has('ui')) this.applyLook(this.ui ?? {});
    if (this.canvas) {
      this.canvas.assets = this.assets;
      this.canvas.hostComponents = !!this.hostComponents;
      this.canvas.pageAttributes = this.pageAttributes;
      if (changed.has('hostComponents') || changed.has('pageAttributes')) this.canvas.refresh();
    }
    if (requested && requested !== c.page) c.setPage(requested);
    if (this.page !== c.page) this.page = c.page;
    // Panels with nothing to show give their space to the canvas.
    const tabs = this.tabs(c);
    if (tabs.length && !tabs.includes(this.tab)) this.tab = tabs[0]!;
    this.toggleAttribute('no-toolbar', !c.can('toolbar'));
    this.toggleAttribute('no-structure', !tabs.length);
    this.toggleAttribute('no-inspector', !c.can('inspector'));
  }

  // -------------------------------------------------------------------------------------------
  // Public API

  /**
   * Applies ops as the editor's person (one transaction, one undo step). Pass `merge` for edits
   * made on every key in your own form fields: a burst with the same key undoes as one step.
   */
  protected override updated(): void {
    this.layoutThumbs();
  }

  /** The previews for the sections offered, rebuilt only when what they show could have changed. */
  private sectionThumbs(c: EditorController, sections: SectionDef[]): SectionThumbs {
    const doc = c.doc;
    const key: unknown[] = [
      c.store.registry,
      doc.tokens,
      doc.themes,
      doc.breakpoints,
      doc.data,
      sections.map((s) => s.name).join(' '),
    ];
    if (!this.thumbs || this.thumbs.key.some((k, i) => k !== key[i])) {
      let value: SectionThumbs;
      try {
        value = buildSectionThumbs(c.store.registry, doc, sections, '.bb-thumbs');
      } catch (error) {
        // Previews are a nicety: a registry that can't draw them still gets its cards.
        console.warn('[bowerbird] section previews failed:', error);
        value = { css: '', html: new Map() };
      }
      this.thumbs = { key, value };
    }
    return this.thumbs.value;
  }

  /** Puts the previews' stylesheet into the shadow root (constructed, so no markup is parsed). */
  private adoptThumbCss(css: string): void {
    if (css === this.thumbCss) return;
    this.thumbCss = css;
    const root = this.renderRoot;
    if (!this.thumbSheet) {
      if (root instanceof ShadowRoot && 'adoptedStyleSheets' in root) {
        this.thumbSheet = new CSSStyleSheet();
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.thumbSheet];
      } else {
        this.thumbSheet = this.ownerDocument.createElement('style');
        root.append(this.thumbSheet);
      }
    }
    if (this.thumbSheet instanceof CSSStyleSheet) this.thumbSheet.replaceSync(css);
    else this.thumbSheet.textContent = css;
  }

  /**
   * Scales each preview to its card: sections are laid out at a desktop width and shrunk, and a
   * card is as tall as its section, up to a limit (taller ones are cut off with a fade).
   */
  private layoutThumbs(): void {
    const thumbs = this.renderRoot.querySelectorAll<HTMLElement>('.thumb');
    if (!thumbs.length) return;
    const fit = () => {
      for (const thumb of thumbs) {
        const page = thumb.firstElementChild as HTMLElement | null;
        const width = thumb.clientWidth;
        if (!page || !width) continue;
        const scale = width / THUMB_WIDTH;
        page.style.width = `${THUMB_WIDTH}px`;
        page.style.transform = `scale(${scale})`;
        const height = Math.round(page.offsetHeight * scale);
        thumb.style.height = `${Math.max(THUMB_MIN, Math.min(height, THUMB_MAX))}px`;
        thumb.toggleAttribute('data-cropped', height > THUMB_MAX);
      }
    };
    fit();
    // Once more after images and fonts have settled.
    cancelAnimationFrame(this.thumbFrame);
    this.thumbFrame = requestAnimationFrame(fit);
  }

  apply(ops: unknown[], label?: string, options?: { merge?: { key: string; within?: number } }) {
    return this.controller?.apply(ops, label, options);
  }

  select(id: string | null): void {
    this.controller?.select(id);
  }

  undo() {
    return this.controller?.undo();
  }

  /**
   * Elements at the start and end of the page frame for your own markup that isn't part of the
   * document (a site header or menu): they stay the same across renders, and nothing in them can be
   * selected. Reading this turns them on.
   */
  get pageSlots(): { start: HTMLElement; end: HTMLElement } {
    this.slotEls ??= createPageSlots(this.ownerDocument);
    this.canvas?.pageSlots(this.slotEls);
    return this.slotEls;
  }

  private slotEls: { start: HTMLElement; end: HTMLElement } | undefined;

  /** The code components to draw (with `hostComponents`), as last sent in `bb-mounts`. */
  get mounts(): readonly ComponentMount[] {
    return this.canvas?.mounts ?? [];
  }

  /**
   * Tell the editor you've drawn into the mounts: it readies the new markup (links and buttons
   * leave the Tab order) and re-measures the selection outlines.
   */
  componentsRendered(): void {
    this.canvas?.componentsRendered();
  }

  /** Moves keyboard focus to the page canvas. */
  focusCanvas(): void {
    this.canvas?.frame.focus({ preventScroll: true });
  }

  redo() {
    return this.controller?.redo();
  }

  // -------------------------------------------------------------------------------------------
  // Events

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private onControllerEvent(event: EditorEvent): void {
    const c = this.controller!;
    switch (event.type) {
      case 'commit':
        // A synced store's confirmation of a change already reported is not a new transaction.
        if (!event.event.echo)
          this.emit('bb-transaction', {
            entry: event.event.entry,
            summary: event.event.summary,
            doc: event.event.doc,
          });
        this.emit('bb-change', { doc: event.event.doc });
        break;
      case 'selection':
        if (event.id)
          for (const n of [c.node(event.id), ...this.ancestorsOf(event.id)])
            if (n?.parent) this.expanded.add(n.parent);
        this.emit('bb-selection', { id: event.id });
        break;
      case 'view':
      case 'store':
        if (this.page !== c.page) {
          this.page = c.page;
          this.emit('bb-page', { page: c.page });
        }
        break;
      case 'changesets':
        this.emit('bb-changesets', { changesets: event.changesets });
        if (
          this.tab !== 'review' &&
          this.openChangesets(c).length &&
          event.changesets.at(-1)?.status.every((st) => st === 'open')
        )
          this.tab = 'review';
        if (this.tab === 'review' && !this.openChangesets(c).length) this.tab = 'layers';
        break;
      case 'error':
        this.showError(event.errors);
        this.emit('bb-error', { errors: event.errors, label: event.label });
        break;
      case 'data':
        this.emit('bb-data-click', { path: event.path, node: event.node });
        break;
    }
    this.tick++;
  }

  private ancestorsOf(id: string): BNode[] {
    const c = this.controller!;
    const out: BNode[] = [];
    let cur = c.node(id);
    while (cur?.parent) {
      cur = c.node(cur.parent);
      if (cur) out.push(cur);
    }
    return out;
  }

  private showError(errors: Issue[]): void {
    const first = errors[0];
    if (!first) return;
    this.toast = { message: first.message, ...(first.hint ? { hint: first.hint } : {}) };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
    }, 6000);
    console.warn('[bowerbird]', errors.map(formatIssue).join('\n'));
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const c = this.controller;
    if (!c || this.canvas?.isEditing) return;
    const target = e.composedPath()[0] as HTMLElement | undefined;
    const tag = target?.tagName ?? '';
    const textEntry =
      !!target &&
      (target.isContentEditable ||
        tag === 'TEXTAREA' ||
        (tag === 'INPUT' &&
          !/^(checkbox|radio|button|submit|reset|range|color|file)$/i.test(
            (target as HTMLInputElement).type,
          )));
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      if (textEntry || !c.can('undo')) return;
      e.preventDefault();
      if (e.shiftKey) c.redo();
      else c.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      if (textEntry || !c.can('undo')) return;
      e.preventDefault();
      c.redo();
      return;
    }
    if (textEntry) return;
    if (e.key === 'Escape') {
      if (c.selectedNode?.parent && !c.isRoot(c.selectedNode.parent)) c.selectParent();
      else c.select(null);
      return;
    }
    // Editing shortcuts apply to the canvas and the layers tree only, never in preview.
    const onCanvas = !!target && (target === this || !!this.canvasHost?.contains(target));
    const onLayer = !!target?.closest?.('[role="treeitem"]');
    if (c.readOnly || !c.selected || !(onCanvas || onLayer)) return;
    const allowed = c.selectionActions();
    if ((e.key === 'Delete' || e.key === 'Backspace') && allowed.delete) {
      e.preventDefault();
      c.removeSelected();
      if (onLayer) this.focusRow(c.selected);
    } else if (mod && e.key.toLowerCase() === 'd' && allowed.duplicate) {
      e.preventDefault();
      c.duplicateSelected();
    } else if (
      e.altKey &&
      ((e.key === 'ArrowUp' && allowed.up) || (e.key === 'ArrowDown' && allowed.down))
    ) {
      e.preventDefault();
      c.nudge(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter' && onCanvas) {
      // The data field last clicked, else the selected text.
      if (this.canvas?.editActiveField() || this.canvas?.startEditing(c.selected))
        e.preventDefault();
    }
  };

  // -------------------------------------------------------------------------------------------
  // Rendering

  protected override render(): TemplateResult | typeof nothing {
    const c = this.controller;
    if (!c) return nothing;
    const tabs = this.tabs(c);
    return html`
      ${
        c.can('toolbar')
          ? html`<div class="toolbar" part="toolbar" role="toolbar" aria-label="Editor">${this.renderToolbar(c)}</div>`
          : nothing
      }
      ${tabs.length ? this.renderStructure(c, tabs) : nothing}
      <div class="center"><slot name="canvas"></slot></div>
      ${
        c.can('inspector')
          ? html`<section class="panel right" part="inspector" aria-label="Inspector">${this.renderInspector(c)}</section>`
          : nothing
      }
      <div class="toast" part="toast" role="status" aria-live="polite" ?hidden=${!this.toast}>
        ${
          this.toast
            ? html`${this.icon('warning')}<div>
                <p>${this.toast.message}</p>
                ${this.toast.hint ? html`<p class="hint">${this.toast.hint}</p>` : nothing}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  private renderStructure(c: EditorController, tabs: TabName[]): TemplateResult {
    return html`
      <section class="panel left" part="structure" aria-label="Page structure">
        <div class="tabs" part="tabs" role="tablist" aria-label="Panels" @keydown=${this.onTabKey}>
          ${tabs.map(
            (tab) => html`<button
              part="tab"
              role="tab"
              id=${`bb-tab-${tab}`}
              aria-selected=${this.tab === tab}
              aria-controls="bb-tabpanel"
              tabindex=${this.tab === tab ? 0 : -1}
              @click=${() => {
                this.tab = tab;
              }}
            >
              ${tab[0]!.toUpperCase() + tab.slice(1)}${
                tab === 'review'
                  ? html` <span class="count">${this.openChangesets(c).length}</span>`
                  : nothing
              }
            </button>`,
          )}
        </div>
        <div role="tabpanel" id="bb-tabpanel" aria-labelledby=${`bb-tab-${this.tab}`}>
          ${
            this.tab === 'layers'
              ? this.renderLayers(c)
              : this.tab === 'insert'
                ? this.renderInsert(c)
                : this.tab === 'review'
                  ? this.renderReview(c)
                  : this.renderHistory(c)
          }
        </div>
      </section>
    `;
  }

  private onTabKey = (e: KeyboardEvent): void => {
    const tabs = this.controller ? this.tabs(this.controller) : [...TABS];
    const i = tabs.indexOf(this.tab);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    this.tab = tabs[next]!;
    this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`#bb-tab-${this.tab}`)?.focus(),
    );
  };

  private openChangesets(c: EditorController) {
    return c.store.changesets.filter((cs) => cs.status.includes('open'));
  }

  /** Tabs the host left on; Review appears only while there is something to review. */
  private tabs(c: EditorController): TabName[] {
    if (!c.can('structure')) return [];
    return TABS.filter((tab) => {
      if (tab === 'layers') return c.can('structure.layers');
      if (tab === 'history') return c.can('structure.history');
      if (tab === 'review') return c.can('structure.review') && this.openChangesets(c).length > 0;
      return this.canInsert(c);
    });
  }

  /** Whether the Insert tab has anything to offer. */
  private canInsert(c: EditorController): boolean {
    const f = c.features;
    if (!f.on('insert')) return false;
    return (
      this.offeredElements(c).length > 0 ||
      c.store.registry.listSections().some((s) => f.section(s.name)) ||
      (f.on('insert.components') && Object.keys(c.doc.symbols ?? {}).length > 0)
    );
  }

  /**
   * Elements the Insert tab offers: what the host left on and the registry can make (a registry
   * without icons offers no icon; a host may have replaced a primitive with a stricter one).
   */
  private offeredElements(c: EditorController): [EditorElementName, string, NodeInput][] {
    const registry = c.store.registry;
    const icon = starterIcon(registry.listIcons());
    const known = (input: NodeInput): boolean =>
      registry.component(input.type)?.insertable !== false &&
      !!registry.component(input.type) &&
      (input.children ?? []).every(known);
    return ELEMENTS.filter(([name, , input]) => c.features.element(name) && known(input))
      .filter(([name]) => name !== 'icon' || !!icon)
      .map(([name, label, input]) =>
        name === 'icon' ? [name, label, { ...input, props: { name: icon } }] : [name, label, input],
      );
  }

  private renderToolbar(c: EditorController): TemplateResult {
    const doc = c.doc;
    const pages = Object.values(doc.pages);
    const symbols = c.can('components') ? Object.values(doc.symbols ?? {}) : [];
    const themes = Object.keys(doc.themes);
    const panels = c.can('toolbar.panels');
    const switcher = c.can('toolbar.pages') && (pages.length > 1 || symbols.length > 0);
    const undo = c.can('undo');
    const preview = c.can('toolbar.preview');
    const theme = themes.length > 0 && c.can('toolbar.theme');
    return html`
      <div class="zone start">
        <slot name="toolbar-start"></slot>
        ${
          panels && this.tabs(c).length
            ? html`<button
                class="btn ghost icon"
                part="button"
                title="Show or hide the structure panel"
                aria-label="Structure panel"
                aria-pressed=${!this.hasAttribute('left-hidden')}
                @click=${() => this.togglePanel('left')}
              >
                ${this.icon('panel-left')}
              </button>`
            : nothing
        }
        ${
          switcher
            ? html`<select
                part="input select"
                aria-label="Page"
                @change=${(e: Event) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value.startsWith('symbol:')) c.editSymbol(value.slice(7));
                  else c.setPage(value);
                }}
              >
                <optgroup label="Pages">
                  ${pages.map((p) => html`<option value=${p.id} .selected=${live(!c.symbolView && p.id === c.page)}>${(c.locale && p.l10n?.[c.locale]?.title) || p.title} (${p.path})</option>`)}
                </optgroup>
                ${
                  symbols.length
                    ? html`<optgroup label="Linked components">
                      ${symbols.map((sym) => html`<option value=${`symbol:${sym.id}`} .selected=${live(c.symbolView === sym.id)}>${sym.name}</option>`)}
                    </optgroup>`
                    : nothing
                }
              </select>`
            : html`<span class="page-title" part="title" title=${c.currentPage?.path ?? ''}>${c.currentPage?.title ?? ''}</span>`
        }
        ${
          c.peers.length && c.can('toolbar.peers')
            ? html`<ul class="peers" aria-label="Also here">
              ${c.peers.map((p) => {
                const who = `${p.actor.name ?? p.actor.id}${p.actor.kind === 'agent' ? ' (agent)' : ''}${p.activity ? `: ${p.activity}` : ''}`;
                return html`<li style=${`--peer: ${p.color}`}>
                  <button
                    part="button"
                    title=${who}
                    aria-label=${p.selection ? `${who}. Show their selection` : who}
                    @click=${() => p.selection && c.select(p.selection)}
                  >
                    ${(p.actor.name ?? p.actor.id).slice(0, 1).toUpperCase()}
                  </button>
                </li>`;
              })}
            </ul>`
            : nothing
        }
      </div>
      <div class="zone middle">
        ${
          c.can('toolbar.breakpoints')
            ? html`<div class="segmented" role="group" aria-label="Screen size">
              ${doc.breakpoints.map(
                (bp) => html`<button
                  part="button"
                  aria-pressed=${bp.id === c.breakpoint}
                  aria-label=${bp.label ?? bp.id}
                  title=${`${bp.label ?? bp.id}: styles for ${bp.minWidth}px and wider`}
                  @click=${() => c.setBreakpoint(bp.id)}
                >
                  ${this.icon(breakpointIcon(bp))}<span class="label">${bp.label ?? bp.id}</span>
                </button>`,
              )}
            </div>`
            : nothing
        }
        ${
          c.can('toolbar.zoom')
            ? html`<select
                part="input select"
                aria-label="Zoom"
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  c.setZoom(v === 'fit' ? 'fit' : Number(v));
                }}
              >
                ${[
                  ['fit', 'Fit'],
                  ['0.5', '50%'],
                  ['0.75', '75%'],
                  ['1', '100%'],
                ].map(
                  ([v, l]) =>
                    html`<option value=${v!} .selected=${live(String(c.zoom) === v)}>${l}</option>`,
                )}
              </select>`
            : nothing
        }
        ${
          doc.locales && c.can('toolbar.language')
            ? html`<select
                part="input select"
                aria-label="Language"
                @change=${(e: Event) => c.setLocale((e.target as HTMLSelectElement).value || null)}
              >
                <option value="" .selected=${live(!c.locale)}>${doc.locales.default} (default)</option>
                ${doc.locales.others.map((l) => html`<option value=${l} .selected=${live(c.locale === l)}>${l}</option>`)}
              </select>`
            : nothing
        }
      </div>
      <div class="zone end">
        ${
          undo
            ? html`<button class="btn ghost icon" part="button" title="Undo your last change (Ctrl+Z)" aria-label="Undo" ?disabled=${!c.canUndo()} @click=${() => c.undo()}>
                ${this.icon('undo')}
              </button>
              <button class="btn ghost icon" part="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" ?disabled=${!c.canRedo()} @click=${() => c.redo()}>
                ${this.icon('redo')}
              </button>`
            : nothing
        }
        ${undo && (theme || preview) ? html`<span class="sep"></span>` : nothing}
        ${
          theme
            ? html`<select part="input select" aria-label="Theme" @change=${(e: Event) => c.setTheme((e.target as HTMLSelectElement).value || null)}>
              <option value="" .selected=${live(!c.theme)}>Default theme</option>
              ${themes.map((t) => html`<option value=${t} .selected=${live(c.theme === t)}>${t}</option>`)}
            </select>`
            : nothing
        }
        ${
          preview
            ? html`<button class="btn" part="button" aria-pressed=${c.preview} title="Hide editing outlines" @click=${() => c.setPreview(!c.preview)}>
                ${this.icon('eye')}<span>Preview</span>
              </button>`
            : nothing
        }
        ${
          panels && c.can('inspector')
            ? html`<button
                class="btn ghost icon"
                part="button"
                title="Show or hide the inspector"
                aria-label="Inspector panel"
                aria-pressed=${!this.hasAttribute('right-hidden')}
                @click=${() => this.togglePanel('right')}
              >
                ${this.icon('panel-right')}
              </button>`
            : nothing
        }
        <slot name="toolbar-end"></slot>
      </div>
    `;
  }

  // ---- Layers -------------------------------------------------------------------------------

  private renderLayers(c: EditorController): TemplateResult {
    const rootId = c.currentRootId;
    if (!rootId) return html`<p class="empty">No page.</p>`;
    const symbolRoot = c.currentSymbol ? c.node(rootId) : undefined;
    const visible: (typeof this.visibleRows)[number][] = [];
    const entries: { node: BNode; depth: number; hasChildren: boolean; open: boolean }[] = [];
    const add = (node: BNode, depth: number, parent: string | null, open: boolean) => {
      const hasChildren = c.store.view.children(node.id).length > 0;
      visible.push({ id: node.id, parent, hasChildren, open });
      entries.push({ node, depth, hasChildren, open });
      return hasChildren && open;
    };
    const walk = (id: string, depth: number) => {
      for (const child of c.store.view.children(id)) {
        if (add(child, depth, depth ? id : null, this.expanded.has(child.id)))
          walk(child.id, depth + 1);
      }
    };
    if (symbolRoot) {
      // A definition shows its root as the top row (it is the component being edited).
      if (add(symbolRoot, 0, null, this.expanded.has(symbolRoot.id) || !this.collapsedRoot))
        walk(symbolRoot.id, 1);
    } else walk(rootId, 0);
    this.visibleRows = visible;
    if (!entries.length)
      return html`<p class="empty">This page is empty.${this.canInsert(c) ? ' Add a section from the Insert tab.' : ''}</p>`;
    // Decide which row takes Tab before rendering, so the tree is reachable from the first render.
    if (!visible.some((r) => r.id === this.focusedRow))
      this.focusedRow = visible.find((r) => r.id === c.selected)?.id ?? visible[0]?.id ?? null;
    const rows = entries.map((e) => this.renderLayerRow(c, e.node, e.depth, e.hasChildren, e.open));
    return html`<ul class="tree" role="tree" aria-label="Layers" @keydown=${this.onTreeKey}>${rows}</ul>`;
  }

  /** An icon: the host's (`ui.icons`, trusted markup) or the built-in one (static, icons.ts). */
  private icon(name: IconName) {
    return unsafeHTML(iconMarkup(name, 'bb-icon', this.controller?.features.ui.icons));
  }

  private nodeIcon(n: BNode): IconName {
    return iconForType(n.type, {
      section: !!n.section,
      linked: !!(n.link || n.symbol),
      tag: n.props.tag,
    });
  }

  private layerLabel(c: EditorController, n: BNode): string {
    if (n.name) return n.name;
    if (n.section) return c.store.registry.section(n.section.name)?.title ?? n.section.name;
    // In the language being edited; rich text holds markup, so label it by its text.
    const props = localizedProps(n, c.locale ?? undefined);
    const raw = (
      typeof props.text === 'string'
        ? props.text
        : typeof props.html === 'string'
          ? props.html
              .replace(/<[^>]*>/g, ' ')
              .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? '')
              .replace(/\s+/g, ' ')
          : ''
    ).trim();
    const text = raw ? `“${raw.length > 40 ? `${raw.slice(0, 39).trimEnd()}…` : raw}”` : '';
    return text || n.part || n.type;
  }

  private renderLayerRow(
    c: EditorController,
    n: BNode,
    depth: number,
    hasChildren: boolean,
    open: boolean,
  ): TemplateResult {
    const drop = this.layerDrop?.id === n.id ? this.layerDrop.where : null;
    return html`<li
      role="treeitem"
      data-id=${n.id}
      tabindex=${this.focusedRow === n.id ? 0 : -1}
      aria-label=${`${this.layerLabel(c, n)} (${n.section ? 'section' : n.type})`}
      aria-level=${depth + 1}
      aria-selected=${c.selected === n.id}
      aria-expanded=${hasChildren ? open : nothing}
      @focus=${() => {
        this.focusedRow = n.id;
      }}
    >
      <div
        part="layer"
        class=${classMap({
          row: true,
          'is-section': !!n.section,
          'is-linked': !!(n.link || n.symbol),
          selected: c.selected === n.id,
          hovered: c.hovered === n.id,
          'drop-before': drop === 'before',
          'drop-after': drop === 'after',
          'drop-inside': drop === 'inside',
        })}
        style=${`padding-left: calc(var(--_s1) + ${depth * 14}px)`}
        draggable=${c.can('move') && c.canRestructure(n.id) ? 'true' : 'false'}
        @click=${() => {
          this.focusedRow = n.id;
          c.select(n.id);
        }}
        @mouseenter=${() => c.hover(n.id)}
        @mouseleave=${() => c.hover(null)}
        @dragstart=${(e: DragEvent) => startDrag(e, { kind: 'move', id: n.id, source: c })}
        @dragend=${() => {
          endDrag();
          this.clearLayerDrop();
        }}
        @dragover=${(e: DragEvent) => this.onLayerDragOver(e, n)}
        @dragleave=${() => this.clearLayerDrop()}
        @drop=${(e: DragEvent) => this.onLayerDrop(e, n)}
      >
        <button
          class="caret"
          tabindex="-1"
          aria-hidden="true"
          aria-label=${open ? 'Collapse' : 'Expand'}
          ?hidden=${!hasChildren}
          @click=${(e: Event) => {
            e.stopPropagation();
            if (open) this.expanded.delete(n.id);
            else this.expanded.add(n.id);
            this.tick++;
          }}
        >
          ${this.icon(open ? 'chevron-down' : 'chevron-right')}
        </button>
        ${hasChildren ? nothing : html`<span class="caret" aria-hidden="true"></span>`}
        <span class="type" aria-hidden="true">${this.icon(this.nodeIcon(n))}</span>
        <span class="name">${this.layerLabel(c, n)}</span>
        <span class="kind">${n.section ? 'section' : n.type}</span>
      </div>
    </li>`;
  }

  private focusRow(id: string | null): void {
    this.updateComplete.then(() => {
      const rows = this.visibleRows;
      const target = rows.find((r) => r.id === id) ?? rows[0];
      if (!target) {
        // Nothing left in the tree: keep focus inside the editor so shortcuts (undo) still work.
        this.focusCanvas();
        return;
      }
      this.focusedRow = target.id;
      this.tick++;
      this.updateComplete.then(() =>
        this.renderRoot
          .querySelector<HTMLElement>(`li[data-id="${CSS.escape(target.id)}"]`)
          ?.focus(),
      );
    });
  }

  /** ARIA tree keyboard pattern: arrows move and expand/collapse, Enter/Space select. */
  private onTreeKey = (e: KeyboardEvent): void => {
    const c = this.controller;
    const item = (e.composedPath()[0] as HTMLElement).closest?.('li[role="treeitem"]');
    if (!c || !item || e.altKey || e.ctrlKey || e.metaKey) return;
    const rows = this.visibleRows;
    const i = rows.findIndex((r) => r.id === item.getAttribute('data-id'));
    const row = rows[i];
    if (!row) return;
    let target: string | undefined | null = null;
    switch (e.key) {
      case 'ArrowDown':
        target = rows[i + 1]?.id;
        break;
      case 'ArrowUp':
        target = rows[i - 1]?.id;
        break;
      case 'Home':
        target = rows[0]?.id;
        break;
      case 'End':
        target = rows.at(-1)?.id;
        break;
      case 'ArrowRight':
        if (row.hasChildren && !row.open) {
          this.expanded.add(row.id);
          target = row.id;
        } else target = row.open ? rows[i + 1]?.id : undefined;
        break;
      case 'ArrowLeft':
        if (row.open) {
          this.expanded.delete(row.id);
          target = row.id;
        } else target = row.parent ?? undefined;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        c.select(row.id);
        return;
      default:
        return;
    }
    e.preventDefault();
    if (target) this.focusRow(target);
  };

  private layerDropPosition(
    n: BNode,
    payload: DragPayload,
    e: DragEvent,
  ): 'before' | 'after' | 'inside' | null {
    const c = this.controller!;
    const view = c.store.view;
    if (
      payload.kind === 'move' &&
      (payload.id === n.id || this.ancestorsOf(n.id).some((a) => a.id === payload.id))
    )
      return null;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    // Whole sections (new or moved) go between the page's top-level sections.
    if (payload.kind === 'section' || (payload.kind === 'move' && view.node(payload.id)?.section))
      return n.parent && c.isRoot(n.parent) ? (y < 0.5 ? 'before' : 'after') : null;
    const type = payload.kind === 'node' ? payload.input.type : view.node(payload.id)?.type;
    if (!type) return null;
    // Linked component instances take no new children (they follow their definition).
    const accepts = c.store.registry.accepts(n.type, type) && c.canInsertInto(n.id);
    if (accepts && y > 0.3 && y < 0.7) return 'inside';
    const parent = n.parent ? view.node(n.parent) : undefined;
    if (!parent || !c.store.registry.accepts(parent.type, type) || !c.canInsertInto(parent.id))
      return accepts ? 'inside' : null;
    return y < 0.5 ? 'before' : 'after';
  }

  private onLayerDragOver(e: DragEvent, n: BNode): void {
    const payload = currentDrag(e, this.controller);
    if (!payload || this.controller?.previewing) return;
    const where = this.layerDropPosition(n, payload, e);
    if (!where) return;
    e.preventDefault();
    if (this.layerDrop?.id !== n.id || this.layerDrop.where !== where) {
      this.layerDrop = { id: n.id, where };
      this.tick++;
    }
  }

  private onLayerDrop(e: DragEvent, n: BNode): void {
    const payload = currentDrag(e, this.controller);
    const drop = this.layerDrop;
    this.clearLayerDrop();
    endDrag();
    if (!payload || !drop || drop.id !== n.id) return;
    e.preventDefault();
    const position: Position =
      drop.where === 'inside' ? { parent: n.id } : { parent: n.parent!, [drop.where]: n.id };
    performDrop(this.controller!, payload, position);
  }

  private clearLayerDrop(): void {
    if (this.layerDrop) {
      this.layerDrop = null;
      this.tick++;
    }
  }

  // ---- Insert -------------------------------------------------------------------------------

  private renderInsert(c: EditorController): TemplateResult {
    const f = c.features;
    const query = c.can('insert.search') ? this.insertQuery.trim() : '';
    const sections = c.symbolView
      ? []
      : c.store.registry.listSections().filter((s) => f.section(s.name));
    const symbols =
      c.symbolView || !f.on('insert.components') ? [] : Object.values(c.doc.symbols ?? {});
    const elements = this.offeredElements(c);
    const found = {
      sections: sections.filter((s) =>
        matchesQuery(query, s.name, s.title, s.category, s.description, ...(s.tags ?? [])),
      ),
      symbols: symbols.filter((sym) => matchesQuery(query, sym.id, sym.name, sym.description)),
      elements: elements.filter(([name, label]) => matchesQuery(query, name, label)),
    };
    const target = c.selectedNode;
    const off = c.previewing;
    // Previews are drawn for every section offered (not just the ones found), so typing in the
    // search box doesn't rebuild them.
    const thumbs =
      c.can('insert.thumbnails') && sections.length ? this.sectionThumbs(c, sections) : undefined;
    this.adoptThumbCss(thumbs?.css ?? '');
    const nothing_found =
      !!query && !found.sections.length && !found.symbols.length && !found.elements.length;
    return html`
      ${
        off
          ? html`<p class="empty" role="status">${c.preview ? 'Leave preview' : 'Close the review preview'} to add content.</p>`
          : nothing
      }
      ${
        c.can('insert.search') && sections.length + symbols.length + elements.length > 8
          ? html`<div class="search">
            ${this.icon('search')}
            <input
              part="input"
              type="search"
              aria-label="Search sections and elements"
              placeholder="Search"
              .value=${live(this.insertQuery)}
              @input=${(e: Event) => {
                this.insertQuery = (e.target as HTMLInputElement).value;
                this.tick++;
              }}
            />
          </div>`
          : nothing
      }
      ${nothing_found ? html`<p class="empty" role="status">Nothing matches “${query}”.</p>` : nothing}
      ${
        found.symbols.length
          ? html`<div class="section intro" part="panel-section">
            <h3 part="heading">Linked components</h3>
            <p class="muted hint">Edit one and every copy follows.</p>
          </div>
          <div class="cards">
            ${found.symbols.map(
              (
                sym,
              ) => html`<button class="card linked" part="card" ?disabled=${off} @click=${() => c.insertSymbol(sym.id)}>
                <strong>${sym.name}</strong>
                <span class="desc">${sym.description ?? `Linked copy of ${sym.id}`}</span>
                <span class="add" aria-hidden="true">${this.icon('plus')}</span>
              </button>`,
            )}
          </div>`
          : nothing
      }
      ${found.sections.length ? this.renderSectionList(c, found.sections, !!target, thumbs) : nothing}
      ${
        found.elements.length
          ? html`<div class="section intro" part="panel-section"><h3 part="heading">Elements</h3><p class="muted hint">Added inside the selected container.</p></div>
            <div class="elements">
              ${found.elements.map(
                ([name, label, input]) => html`<button
                  part="button"
                  ?disabled=${off}
                  draggable="true"
                  @click=${() => c.insertNode(structuredClone(input))}
                  @dragstart=${(e: DragEvent) => startDrag(e, { kind: 'node', input: structuredClone(input) })}
                  @dragend=${() => endDrag()}
                >
                  ${this.icon(ELEMENT_ICONS[name])}<span>${label}</span>
                </button>`,
              )}
            </div>`
          : nothing
      }
    `;
  }

  private renderSectionList(
    c: EditorController,
    sections: SectionDef[],
    hasTarget: boolean,
    thumbs: SectionThumbs | undefined,
  ) {
    const groups = groupSections(sections);
    return html`<div class="section intro" part="panel-section">
        <h3 part="heading">Sections</h3>
        <p class="muted hint">Click to add ${hasTarget ? 'after the selected section' : 'to the end of the page'}, or drag onto the page.</p>
      </div>
      ${groups.map(
        ([label, list]) => html`
          ${groups.length > 1 ? html`<h4 class="group" part="group">${label}</h4>` : nothing}
          <div class="cards">${list.map((s) => this.renderSectionCard(c, s, thumbs?.html.get(s.name)))}</div>
        `,
      )}`;
  }

  private renderSectionCard(
    c: EditorController,
    s: SectionDef,
    preview: string | undefined,
  ): TemplateResult {
    const variants = Object.entries(s.variants ?? {});
    return html`<button
      class=${preview ? 'card has-thumb' : 'card'}
      part="card"
      draggable="true"
      title=${preview ? s.description : nothing}
      ?disabled=${c.previewing}
      @click=${() => c.insertSection(s.name)}
      @dragstart=${(e: DragEvent) => startDrag(e, { kind: 'section', name: s.name })}
      @dragend=${() => endDrag()}
    >
      ${
        preview
          ? // A picture of the section, not content: nothing in it can be focused or clicked.
            html`<span class="thumb" part="thumbnail" aria-hidden="true" inert
              ><span class="thumb-page bb-thumbs" data-theme=${c.theme ?? nothing}>${unsafeHTML(preview)}</span></span
            >`
          : nothing
      }
      <strong>${s.title}</strong>
      ${preview ? nothing : html`<span class="desc" title=${s.description}>${s.description}</span>`}
      <span class="add" aria-hidden="true">${this.icon('plus')}</span>
      ${
        variants.length
          ? html`<span class="chips">${variants.flatMap(([, values]) => values.map((v) => html`<span class="badge">${v}</span>`))}</span>`
          : nothing
      }
    </button>`;
  }

  // ---- History ------------------------------------------------------------------------------

  private renderHistory(c: EditorController): TemplateResult {
    const entries = [...c.store.history].reverse().slice(0, 100);
    if (!entries.length) return html`<p class="empty">No changes yet.</p>`;
    const others = new Map<string, Actor>();
    for (const e of entries)
      if (e.actor.id !== c.identity.id && e.actor.kind !== 'system')
        others.set(e.actor.id, e.actor);
    return html`
      ${
        others.size && c.can('undo')
          ? html`<div class="section undo-others" part="panel-section">
            <h3 part="heading">Undo someone else's work</h3>
            ${[...others.values()].map(
              (a) => html`<button
                class="btn sm"
                part="button"
                ?disabled=${!c.store.history.some((e) => e.actor.id === a.id && e.kind !== 'undo' && !e.undone)}
                @click=${() => c.undoBy(a.id)}
              >
                ${this.icon('undo')}<span>Undo last change by ${a.name ?? a.id}</span>
              </button>`,
            )}
          </div>`
          : nothing
      }
      <ol class="history" aria-label="History">
        ${entries.map(
          (e) => html`<li class=${classMap({ entry: true, undone: c.isUndone(e) })}>
            <span class=${`avatar ${e.actor.kind}`} aria-hidden="true">${(e.actor.name ?? e.actor.id).slice(0, 1).toUpperCase()}</span>
            <span class="what">
              <span class=${`who ${e.actor.kind}`}>${e.actor.name ?? e.actor.id}</span>
              <span class="label">${e.label ?? e.kind}</span>
            </span>
            <time datetime=${new Date(e.time).toISOString()} title=${new Date(e.time).toLocaleString()}>${timeAgo(e.time)}</time>
          </li>`,
        )}
      </ol>
    `;
  }

  // ---- Inspector ----------------------------------------------------------------------------

  private renderInspector(c: EditorController): TemplateResult {
    const node = c.selectedNode;
    if (!node) return this.renderPageSettings(c);
    const registry = c.store.registry;
    const def = registry.component(node.type);
    const section = node.section ? registry.section(node.section.name) : undefined;
    const owner = node.section ? undefined : c.sectionOf(node.id);
    const provenance = c.can('inspector.provenance') ? this.renderProvenance(node) : nothing;
    const info = c.can('inspector.info')
      ? html`<div class="section" part="panel-section">
          <div class="node-head">
            <span class=${classMap({ 'node-icon': true, linked: !!(node.link || node.symbol) })} aria-hidden="true">${this.icon(this.nodeIcon(node))}</span>
            <span class="node-name" title=${this.layerLabel(c, node)}>${this.layerLabel(c, node)}</span>
            <span class="node-meta">
              <span class=${node.section ? 'badge section' : 'badge'}>${node.section ? `section · ${node.section.name}` : node.type}</span>
              <code title=${node.id}>${node.id}</code>
            </span>
          </div>
          ${owner ? html`<p class="muted hint provenance">In <button class="link" @click=${() => c.select(owner.id)}>${owner.id}</button></p>` : nothing}
          ${provenance}
        </div>`
      : provenance !== nothing
        ? html`<div class="section" part="panel-section">${provenance}</div>`
        : nothing;
    const editable = [
      c.can('components') ? this.renderLinkPanel(c, node) : nothing,
      section && c.can('inspector.section')
        ? this.renderSectionSettings(c, node, section)
        : nothing,
      def && c.can('inspector.content') ? this.renderProps(c, node, def) : nothing,
      c.can('inspector.styles') ? this.renderStyles(c, node) : nothing,
      this.renderActions(c),
    ].filter((p) => p !== nothing);
    return html`${info}${
      editable.length
        ? editable
        : html`<p class="empty">Nothing to change here. Select text, a link or an image.</p>`
    }`;
  }

  private renderActions(c: EditorController): TemplateResult | typeof nothing {
    // Parts of a linked instance, anything while previewing, and what the policy keeps in place
    // can't be restructured.
    const allowed = c.selectionActions();
    const duplicate = allowed.duplicate;
    const remove = allowed.delete;
    // "Select parent" only makes sense next to things you can do with the parent.
    if (!duplicate && !remove && !c.can('move')) return nothing;
    return html`<div class="section actions" part="panel-section">
      ${duplicate ? html`<button class="btn sm" part="button" @click=${() => c.duplicateSelected()}>${this.icon('copy')}<span>Duplicate</span></button>` : nothing}
      <button class="btn sm" part="button" @click=${() => c.selectParent()}>${this.icon('parent')}<span>Select parent</span></button>
      ${
        remove
          ? html`<button
              class="btn sm danger"
              part="button danger"
              @click=${() => {
                if (c.removeSelected()?.ok) this.focusCanvas();
              }}
            >
              ${this.icon('trash')}<span>Delete</span>
            </button>`
          : nothing
      }
    </div>`;
  }

  /** "Last edited by …" from the node's provenance stamps. */
  private renderProvenance(node: BNode): TemplateResult | typeof nothing {
    const stamps = Object.entries(node.edited ?? {}).filter(([field]) => field !== 'node');
    const latest = stamps.sort((a, b) => b[1].rev - a[1].rev)[0];
    const created = node.edited?.node;
    if (!latest && !created) return nothing;
    const [field, stamp] = latest ?? ['node', created!];
    const who = (s: typeof stamp) => `${s.by}${s.kind === 'agent' ? ' (agent)' : ''}`;
    // Fields set when the node was added belong to "Added by".
    const added = field === 'node' || (created && created.rev === stamp.rev);
    return html`<p class="muted provenance">
      ${added ? html`Added by ${who(created ?? stamp)}` : html`${fieldLabel(field)} last changed by ${who(stamp)}`}
      <span>· revision ${stamp.rev}</span>
    </p>`;
  }

  /** Linked component controls: instance info and actions, or "make linked component". */
  private renderLinkPanel(c: EditorController, node: BNode): TemplateResult | typeof nothing {
    const view = c.store.view;
    if (node.symbol) {
      const sym = c.doc.symbols?.[node.symbol];
      return html`<div class="section linked-panel" part="panel-section">
        <h3 part="heading">${this.icon('component')}Linked component</h3>
        <p class="muted hint">This is the definition of “${sym?.name ?? node.symbol}”. Changes here update every instance, except fields an instance overrides.</p>
      </div>`;
    }
    if (node.link) {
      const sym = c.doc.symbols?.[node.link.symbol];
      const root = instanceRootOf(view, node.id);
      const overrides = overridesOf(view, node);
      return html`<div class="section linked-panel" part="panel-section">
        <h3 part="heading">${this.icon('component')}Linked component</h3>
        <p class="muted hint">
          ${root?.id === node.id ? 'Instance' : 'Part of an instance'} of “${sym?.name ?? node.link.symbol}”.
          ${overrides.length ? html`Overrides: ${overrides.map(fieldLabel).join(', ')}.` : 'Matches the definition.'}
        </p>
        <div class="row-inline">
          <button class="btn sm" part="button" @click=${() => c.select(node.link!.node)}>${this.icon('edit')}<span>Edit definition</span></button>
          ${(overrides.length || root?.id === node.id) && c.can('components.reset') ? html`<button class="btn sm" part="button" @click=${() => c.resetOverrides(node.id)}>${this.icon('reset')}<span>Reset overrides</span></button>` : nothing}
          ${root ? html`<button class="btn sm" part="button" @click=${() => c.detachInstance(root.id)}>${this.icon('unlink')}<span>Detach</span></button>` : nothing}
        </div>
      </div>`;
    }
    if (!node.section || c.symbolView || !c.can('components.create')) return nothing;
    return html`<div class="section" part="panel-section">
      <h3 part="heading">Reuse</h3>
      <div class="row-inline reuse">
        <input part="input" aria-label="Linked component name" placeholder="Name, e.g. Site footer" .value=${live(this.symbolName)}
          @input=${(e: Event) => {
            this.symbolName = (e.target as HTMLInputElement).value;
            this.tick++;
          }} />
        <button
          class="btn"
          part="button"
          ?disabled=${!this.symbolName.trim()}
          @click=${() => {
            if (c.createSymbol(node.id, this.symbolName.trim())?.ok) this.symbolName = '';
          }}
        >
          Make linked
        </button>
      </div>
    </div>`;
  }

  // ---- Review -------------------------------------------------------------------------------

  private reviewSelection = new Map<string, Set<number>>();

  private renderReview(c: EditorController): TemplateResult {
    const open = this.openChangesets(c);
    if (!open.length) return html`<p class="empty">Nothing to review.</p>`;
    return html`${open.map((cs) => {
      const openOps = cs.status.flatMap((st, i) => (st === 'open' ? [i] : []));
      let chosen = this.reviewSelection.get(cs.id);
      if (!chosen) {
        chosen = new Set(openOps);
        this.reviewSelection.set(cs.id, chosen);
      }
      const selected = openOps.filter((i) => chosen!.has(i));
      const previewing = c.ghost?.changeset === cs.id;
      // Offer Accept only when it would work for this person (their access, dependencies).
      const blocked = c.acceptProblem(cs.id, selected);
      return html`<div class="section changeset" part="panel-section">
        <div class="head">
          <strong>${cs.label ?? cs.id}</strong>
          <span class=${`badge ${cs.actor.kind}`}>${cs.actor.name ?? cs.actor.id}</span>
        </div>
        <ul class="ops">
          ${openOps.map(
            (i) => html`<li>
              <label>
                <input
                  type="checkbox"
                  .checked=${live(chosen!.has(i))}
                  @change=${(e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    // Keep dependencies consistent: an op needs the ops that create what it uses.
                    const toggle = (j: number, value: boolean) => {
                      if (value) chosen!.add(j);
                      else chosen!.delete(j);
                    };
                    // Checking an op checks the ops it needs; unchecking one unchecks its dependents.
                    const cascade = (j: number, value: boolean) => {
                      if (chosen!.has(j) === value) return;
                      toggle(j, value);
                      if (value) {
                        for (const need of cs.needs[j] ?? [])
                          if (cs.status[need] === 'open') cascade(need, true);
                      } else {
                        cs.needs.forEach((needs, k) => {
                          if (needs.includes(j)) cascade(k, false);
                        });
                      }
                    };
                    toggle(i, !on);
                    cascade(i, on);
                    if (previewing)
                      c.previewChangeset(
                        cs.id,
                        [...chosen!].sort((a, b) => a - b),
                      );
                    this.tick++;
                  }}
                />
                <span>${describeOp(cs.ops[i]!)}</span>
              </label>
            </li>`,
          )}
        </ul>
        ${cs.warnings.length ? html`<ul class="notes">${cs.warnings.map((w) => html`<li>${w.message}</li>`)}</ul>` : nothing}
        ${blocked ? html`<p class="notes" role="note">You can’t accept ${selected.length === 1 ? 'this' : 'these'}: ${blocked.message}</p>` : nothing}
        <div class="row-inline">
          <button
            class="btn sm"
            part="button"
            aria-pressed=${!!previewing}
            @click=${() => (previewing ? c.clearPreview() : c.previewChangeset(cs.id, selected))}
          >
            ${this.icon('eye')}<span>${previewing ? 'Hide preview' : 'Preview'}</span>
          </button>
          <button class="btn sm primary" part="button primary" ?disabled=${!selected.length || !!blocked} @click=${() => {
            this.reviewSelection.delete(cs.id);
            c.acceptChangeset(cs.id, selected);
          }}>
            ${this.icon('check')}<span>Accept ${selected.length === openOps.length ? 'all' : `${selected.length}`}</span>
          </button>
          <button class="btn sm danger" part="button danger" ?disabled=${!selected.length} @click=${() => {
            this.reviewSelection.delete(cs.id);
            c.rejectChangeset(cs.id, selected);
          }}>
            Reject
          </button>
        </div>
      </div>`;
    })}`;
  }

  private renderPageSettings(c: EditorController): TemplateResult {
    const page = c.currentPage;
    if (!page) return html`<p class="empty">No page selected.</p>`;
    if (!c.can('inspector.page'))
      return html`<p class="empty">Select an element on the page to edit it.</p>`;
    const update = (field: 'title' | 'path' | 'description') => (e: Event) =>
      c.updatePage(page.id, { [field]: (e.target as HTMLInputElement).value });
    // In another language, the title and description fields edit that language's translation;
    // an empty field shows (and falls back to) the default.
    const locale = c.locale;
    const translated = locale ? page.l10n?.[locale] : undefined;
    const suffix = locale ? ` (${locale})` : '';
    return html`
      <div class="section" part="panel-section">
        <h3 part="heading">Page</h3>
        <div class="field" part="field"><label part="label" for="pt">Title${suffix}</label><input id="pt" part="input"
          .value=${live(locale ? (translated?.title ?? '') : page.title)}
          placeholder=${locale ? page.title : ''} @change=${update('title')} /></div>
        <div class="field" part="field"><label part="label" for="pp">Path</label><input id="pp" part="input" .value=${live(page.path)} @change=${update('path')} /></div>
        <div class="field" part="field">
          <label part="label" for="pd">Description${suffix}</label>
          <textarea id="pd" part="input" .value=${live(locale ? (translated?.description ?? '') : (page.description ?? ''))}
            placeholder=${locale ? (page.description ?? '') : ''} @change=${update('description')}></textarea>
        </div>
      </div>
      <p class="empty">Select an element on the page to edit it.</p>
    `;
  }

  private renderSectionSettings(
    c: EditorController,
    node: BNode,
    section: SectionDef,
  ): TemplateResult | typeof nothing {
    const tokens = flattenTokens(c.doc.tokens).tokens.map((t) => t.cssVar);
    const variants = Object.entries(section.variants ?? {});
    const vars = c.can('inspector.section.settings') ? Object.entries(section.vars ?? {}) : [];
    if (!variants.length && !vars.length) return nothing;
    return html`<div class="section" part="panel-section">
      <h3 part="heading">Section</h3>
      ${variants.map(
        ([axis, values]) => html`<div class="field" part="field">
          <label part="label" for=${`v-${axis}`}>${axis[0]!.toUpperCase() + axis.slice(1)}</label>
          <select part="input select" id=${`v-${axis}`} @change=${(e: Event) => c.setVariant(node.id, { [axis]: (e.target as HTMLSelectElement).value })}>
            ${values.map((v) => html`<option value=${v} .selected=${live(node.section?.variant[axis] === v)}>${v}</option>`)}
          </select>
        </div>`,
      )}
      ${vars.map(([name, spec]) => {
        const family = VAR_FAMILY[spec.type];
        const current = node.vars?.[name] ?? '';
        const options = family ? tokens.filter((t) => t.startsWith(family)) : [];
        const id = `var-${name}`;
        return html`<div class="field" part="field">
          <label part="label" for=${id}>${(spec.description ?? name).replace(/\.$/, '')}</label>
          ${
            family
              ? html`<select part="input select" id=${id} @change=${(e: Event) => c.setVars(node.id, { [name]: (e.target as HTMLSelectElement).value || null })}>
                <option value="" .selected=${live(!current)}>Default (${spec.default})</option>
                ${options.map((t) => html`<option value=${`var(${t})`} .selected=${live(current === `var(${t})`)}>${t.slice(2)}</option>`)}
              </select>`
              : html`<input part="input" id=${id} .value=${live(current)} placeholder=${spec.default}
                @change=${(e: Event) => c.setVars(node.id, { [name]: (e.target as HTMLInputElement).value || null })} />`
          }
        </div>`;
      })}
    </div>`;
  }

  private renderProps(
    c: EditorController,
    node: BNode,
    def: ComponentDef,
  ): TemplateResult | typeof nothing {
    // Without advanced fields, only content (text, links, images) can be changed.
    const content = new Set(def.contentProps ?? []);
    const fields = fieldsForNode(def, node.props).filter(
      (f) => c.can('inspector.content.advanced') || content.has(f.key),
    );
    if (!fields.length) return nothing;
    return html`<div class="section" part="panel-section">
      <h3 part="heading">Content</h3>
      ${fields.map((f) => this.renderField(c, node, f))}
    </div>`;
  }

  private renderField(c: EditorController, node: BNode, field: Field): TemplateResult {
    const id = `f-${field.key}`;
    const value = localizedProps(node, c.locale ?? undefined)[field.key];
    const onChange = (e: Event) => {
      const input = e.target as HTMLInputElement;
      let value: unknown;
      try {
        value = fieldValue(field, input);
      } catch (error) {
        this.showError([
          { code: 'invalid_props', nodeId: node.id, path: field.key, message: String(error) },
        ]);
        this.tick++;
        return;
      }
      const def = c.store.registry.component(node.type);
      const patch = { [field.key]: value };
      c.setProps(
        node.id,
        def ? withCompanions(def, node.props, patch) : patch,
        `Edit ${field.label.toLowerCase()}`,
      );
    };
    let control: TemplateResult;
    if (field.kind === 'select') {
      control = html`<select part="input select" id=${id} @change=${onChange}>
        ${field.required ? nothing : html`<option value="" .selected=${live(value === undefined)}>—</option>`}
        ${field.options!.map((o) => html`<option value=${o} .selected=${live(value === o)}>${o}</option>`)}
      </select>`;
    } else if (field.kind === 'json') {
      control = html`<textarea
        part="input"
        id=${id}
        part="input"
        class="code"
        spellcheck="false"
        .value=${live(value === undefined ? '' : JSON.stringify(value, null, 2))}
        @change=${onChange}
      ></textarea>`;
    } else if (field.kind === 'lines') {
      const lines = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
      control = html`<textarea part="input" id=${id} .value=${live(lines.join('\n'))} @change=${onChange}></textarea>`;
    } else if (field.kind === 'icon') {
      control = this.renderIconPicker(c, node, field, typeof value === 'string' ? value : '');
    } else if (field.kind === 'textarea') {
      control = html`<textarea part="input" id=${id} .value=${live(String(value ?? ''))} @change=${onChange}></textarea>`;
    } else if (field.kind === 'checkbox') {
      control = html`<input part="input" id=${id} type="checkbox" .checked=${live(!!value)} @change=${onChange} />`;
    } else if (field.kind === 'number') {
      control = html`<input part="input" id=${id} type="number" .value=${live(value === undefined ? '' : String(value))} @change=${onChange} />`;
    } else {
      const text = String(value ?? '');
      const embedded = field.kind === 'image' && text.startsWith('data:');
      control = html`<input
        part="input"
        id=${id}
        part="input"
        type=${field.kind === 'url' || field.kind === 'image' ? 'url' : 'text'}
        .value=${live(embedded ? '' : text)}
        placeholder=${embedded ? 'Embedded image (paste a URL to replace)' : field.kind === 'url' ? 'https:// or /path' : ''}
        @change=${onChange}
      />${
        field.kind === 'image' && this.assets
          ? html`<label class="upload">
              ${this.icon('upload')}<span>Upload image</span>
              <input
                type="file"
                accept="image/*"
                @change=${(e: Event) => this.upload(c, node, field.key, e.target as HTMLInputElement)}
              />
            </label>`
          : nothing
      }`;
    }
    const def = node.link ? c.node(node.link.node) : undefined;
    const defValue = def ? localizedProps(def, c.locale ?? undefined)[field.key] : undefined;
    const overridden = !!def && JSON.stringify(defValue) !== JSON.stringify(value);
    return html`<div class=${field.kind === 'checkbox' ? 'field check' : 'field'} part="field"><label part="label" for=${id}>${field.label}${field.required ? ' *' : ''}${
      overridden
        ? html` <span class="override" title="Differs from the linked component">●</span>`
        : nothing
    }</label>${control}</div>`;
  }

  /** The site's icons as a grid of buttons; the chosen one is pressed. */
  private renderIconPicker(
    c: EditorController,
    node: BNode,
    field: Field,
    current: string,
  ): TemplateResult {
    const registry = c.store.registry;
    return html`<div class="icon-grid" role="group" aria-label=${field.label} id=${`f-${field.key}`}>
      ${registry.listIcons().map((name) => {
        const icon = registry.icon(name);
        return html`<button
          type="button"
          class="icon-option"
          part="button"
          title=${name}
          aria-label=${name}
          aria-pressed=${name === current}
          @click=${() => c.setProps(node.id, { [field.key]: name }, `Change ${field.label.toLowerCase()}`)}
        >
          ${icon ? unsafeHTML(iconSvg(icon)) : nothing}
        </button>`;
      })}
    </div>`;
  }

  private renderStyles(c: EditorController, node: BNode): TemplateResult {
    const bp = c.breakpoint;
    const state = this.styleState;
    const decls = node.styles?.[bp]?.[state] ?? {};
    const tokens = flattenTokens(c.doc.tokens).tokens.map((t) => `var(${t.cssVar})`);
    const bpLabel = c.doc.breakpoints.find((b) => b.id === bp)?.label ?? bp;
    const f = c.features;
    const offered = (f.ui.styleProperties ?? COMMON_PROPS).filter((p) => f.styleProperty(p));
    return html`<div class="section" part="panel-section">
      <h3 part="heading">Style · ${bpLabel}</h3>
      <div class="field" part="field">
        <label part="label" for="state">State</label>
        <select
          id="state"
          part="input select"
          @change=${(e: Event) => {
            this.styleState = (e.target as HTMLSelectElement).value;
            this.tick++;
          }}
        >
          ${Object.keys(STATE_PSEUDO).map((s) => html`<option value=${s} .selected=${live(s === state)}>${s}</option>`)}
        </select>
      </div>
      ${Object.entries(decls).map(
        ([prop, value]) => html`<div class="decl">
          <code title=${prop}>${prop}</code>
          <input
            part="input"
            aria-label=${`${prop} value`}
            list="bb-tokens"
            .value=${live(value)}
            ?disabled=${!f.styleProperty(prop)}
            title=${f.styleProperty(prop) ? '' : 'This property can’t be changed here.'}
            @change=${(e: Event) => c.setDeclaration(node.id, prop, (e.target as HTMLInputElement).value, { state })}
          />
          ${
            f.styleProperty(prop)
              ? html`<button class="btn ghost sm icon" part="button" aria-label=${`Remove ${prop}`} title=${`Remove ${prop}`} @click=${() => c.setStyle(node.id, '', { state, remove: [prop] })}>${this.icon('close')}</button>`
              : html`<span></span>`
          }
        </div>`,
      )}
      ${Object.keys(decls).length ? nothing : html`<p class="muted">No styles for ${bpLabel}${state === 'default' ? '' : ` (${state})`} yet.</p>`}
      <div class="decl add">
        <input part="input" aria-label="CSS property" placeholder="property" list="bb-props" .value=${live(this.newProp)}
          @input=${(e: Event) => {
            this.newProp = (e.target as HTMLInputElement).value;
          }} />
        <input part="input" aria-label="Value" placeholder="var(--token)" list="bb-tokens" .value=${live(this.newValue)}
          @input=${(e: Event) => {
            this.newValue = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this.addStyle(c, node.id, state);
          }} />
        <button class="btn" part="button" @click=${() => this.addStyle(c, node.id, state)}>Add</button>
      </div>
      <datalist id="bb-props">${offered.map((p) => html`<option value=${p}></option>`)}</datalist>
      <datalist id="bb-tokens">${tokens.map((t) => html`<option value=${t}></option>`)}</datalist>
    </div>`;
  }

  /** Sends a picked file to the host's asset adapter and points the image at the result. */
  private async upload(
    c: EditorController,
    node: BNode,
    key: string,
    input: HTMLInputElement,
  ): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.assets) return;
    try {
      const asset = await this.assets.upload(file);
      const props: Record<string, unknown> = { [key]: asset.src };
      if (key === 'src') {
        if (asset.width) props.width = asset.width;
        if (asset.height) props.height = asset.height;
        if (asset.alt && !node.props.alt) props.alt = asset.alt;
      }
      c.setProps(node.id, props, 'Upload image');
    } catch (error) {
      c.report([
        {
          code: 'invalid_props',
          nodeId: node.id,
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }

  private addStyle(c: EditorController, id: string, state: string): void {
    const prop = this.newProp.trim();
    const value = this.newValue.trim();
    if (!prop || !value) return;
    if (!c.features.styleProperty(prop)) {
      const allowed = c.features.ui.styleProperties ?? [];
      this.showError([
        {
          code: 'policy',
          nodeId: id,
          message: `“${prop}” can’t be styled in this editor.`,
          hint: `Properties you can set: ${allowed.join(', ')}.`,
        },
      ]);
      return;
    }
    const result = c.setStyle(id, `${prop}: ${value}`, { state });
    if (result.ok) {
      this.newProp = '';
      this.newValue = '';
      this.tick++;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bowerbird-editor': BowerbirdEditor;
  }
  interface HTMLElementEventMap {
    'bb-change': CustomEvent<EditorChangeDetail>;
  }
}
