import { type EditField, localizedProps, sanitizeRichText } from '@bowerbirdjs/core';
import { renderPage, renderSubtree } from '@bowerbirdjs/html';
import { type EditorController, type EditorEvent, splitDataPath } from './controller.js';
import {
  currentDrag,
  type DropTarget,
  dropTarget,
  endDrag,
  performDrop,
  startDrag,
} from './dnd.js';
import { FIELD_PANEL_CSS, FieldPanel, type PanelField } from './field-panel.js';
import { type IconName, iconMarkup } from './icons.js';
import { fieldsFor } from './schema-form.js';
import { CANVAS_TOKEN_CSS } from './theme.js';

/** Where picked image files go (the element's `assets`). */
export interface CanvasAssets {
  upload(file: File): Promise<{ src: string; alt?: string; width?: number; height?: number }>;
}

/** Text props edited in place; the field panel offers the other content props. */
const INLINE_PROP: Record<string, string> = {
  text: 'text',
  link: 'text',
  button: 'text',
  'rich-text': 'html',
};

let counter = 0;

/**
 * Chrome for the canvas itself (light DOM, so every class is prefixed). Host page CSS reaches
 * light DOM, so the first rules revert host styles on the chrome (`.app div { … }`, inherited
 * fonts) and every chrome rule is scoped under `.bbx-host` to outrank typical host selectors.
 * Page content has its own reset in the page CSS.
 */
export const CANVAS_CSS = `
.bbx-host.bbx-host, .bbx-host.bbx-host :where(:not(.bb-page, .bb-page *, svg *)) { all: revert; }
${CANVAS_TOKEN_CSS}
.bbx-host.bbx-host { position: absolute; inset: 0; display: block; font: 400 var(--bbe-font-size)/1.4 var(--bbe-font); color: var(--bbe-fg);
  text-transform: none; letter-spacing: normal; word-spacing: normal; text-align: start; text-indent: 0; text-shadow: none;
  white-space: normal; cursor: auto; }
.bbx-host .bbx-icon { display: block; flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.75px;
  stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
.bbx-host .bbx-frame { position: relative; height: 100%; overflow: auto; background: var(--bbe-canvas-bg); outline: none;
  scrollbar-width: thin; scrollbar-color: var(--bbe-border-strong) transparent; }
.bbx-host .bbx-frame:focus-visible { box-shadow: inset 0 0 0 2px var(--bbe-focus); }
.bbx-host .bbx-stage { position: relative; margin: 24px auto 48px; }
.bbx-host .bbx-viewport { position: absolute; top: 0; left: 0; transform-origin: top left; contain: layout paint;
  background: var(--color-surface, #fff); color-scheme: normal; box-shadow: 0 0 0 1px rgb(0 0 0 / .05), 0 1px 2px rgb(0 0 0 / .06), 0 10px 30px rgb(0 0 0 / .10); }
.bbx-host .bbx-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.bbx-host .bbx-box { position: absolute; border: 1.5px solid var(--bbe-selection); border-radius: 2px; box-sizing: border-box; }
.bbx-host .bbx-box[hidden], .bbx-host .bbx-toolbar[hidden], .bbx-host .bbx-drop[hidden] { display: none; }
.bbx-host .bbx-hover { border-width: 1px; opacity: .75; }
.bbx-host .bbx-label { position: absolute; left: -1.5px; bottom: 100%; padding: 0 7px; border-radius: 4px 4px 0 0; white-space: nowrap;
  background: var(--bbe-selection); color: var(--bbe-accent-fg); font: 600 11px/20px var(--bbe-font); }
.bbx-host .bbx-toolbar { position: absolute; display: flex; gap: 2px; padding: 3px; border-radius: calc(var(--bbe-radius) + 3px); pointer-events: auto;
  background: var(--bbe-floating-bg); color: var(--bbe-floating-fg); box-shadow: var(--bbe-shadow); }
.bbx-host .bbx-toolbar button { all: unset; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--bbe-radius);
  color: color-mix(in srgb, var(--bbe-floating-fg) 78%, transparent); cursor: pointer; }
.bbx-host .bbx-toolbar button:hover, .bbx-host .bbx-toolbar button:focus-visible { background: color-mix(in srgb, var(--bbe-floating-fg) 16%, transparent);
  color: var(--bbe-floating-fg); }
.bbx-host .bbx-toolbar button:focus-visible { outline: 2px solid var(--bbe-focus); outline-offset: 1px; }
.bbx-host .bbx-toolbar button[data-action="delete"]:hover { color: color-mix(in srgb, var(--bbe-danger) 55%, var(--bbe-floating-fg)); }
.bbx-host .bbx-toolbar button[hidden], .bbx-host .bbx-label[hidden] { display: none; }
.bbx-host .bbx-toolbar [draggable="true"] { cursor: grab; }
.bbx-host .bbx-drop { position: absolute; background: var(--bbe-selection); border-radius: 2px; }
.bbx-host .bbx-drop.bbx-inside { background: color-mix(in srgb, var(--bbe-selection) 10%, transparent);
  outline: 2px dashed var(--bbe-selection); outline-offset: -2px; }
.bbx-host .bbx-empty { padding: 64px 24px; text-align: center; font: 15px/1.5 var(--bbe-font);
  color: var(--color-on-surface-muted, #64748b); }
.bbx-host .bbx-content [contenteditable] { outline: 2px solid var(--bbe-selection); outline-offset: 2px; cursor: text; }
.bbx-host .bbx-content :is(a, button) { cursor: default; }
.bbx-host .bbx-banner { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; justify-content: center;
  margin: 0 auto; padding: 7px 12px; font: 600 12px/1.4 var(--bbe-font); color: var(--bbe-floating-fg); background: var(--bbe-floating-bg);
  box-shadow: inset 0 -3px 0 var(--bbe-accent); }
.bbx-host .bbx-banner[hidden] { display: none; }
.bbx-host .bbx-banner.bbx-ghost-banner { box-shadow: inset 0 -3px 0 var(--bbe-warning); }
.bbx-host .bbx-banner.bbx-symbol-banner { box-shadow: inset 0 -3px 0 var(--bbe-linked); }
.bbx-host .bbx-peer { position: absolute; box-sizing: border-box; border: 2px solid var(--peer); border-radius: 3px; pointer-events: none; }
.bbx-host .bbx-peer-tag { position: absolute; right: -2px; bottom: 100%; padding: 0 6px; border-radius: 4px 4px 0 0; white-space: nowrap;
  background: var(--peer); color: #fff; font: 600 11px/18px var(--bbe-font); }
.bbx-host .bbx-mark { position: absolute; box-sizing: border-box; border-radius: 3px; pointer-events: none; }
.bbx-host .bbx-mark.bbx-created { outline: 2px solid var(--bbe-success); background: color-mix(in srgb, var(--bbe-success) 8%, transparent); }
.bbx-host .bbx-mark.bbx-updated { outline: 2px dashed var(--bbe-warning); background: color-mix(in srgb, var(--bbe-warning) 6%, transparent); }
.bbx-host .bbx-frame:not([data-preview]) .bbx-content [data-bb-edit]:hover { outline: 1px dashed var(--bbe-selection); outline-offset: 2px; cursor: text; }
.bbx-host .bbx-frame:not([data-preview]) .bbx-content [data-bb-add] { cursor: pointer; }
.bbx-host .bbx-frame:not([data-preview]) .bbx-content [data-bb-add]:hover { outline: 1px dashed var(--bbe-selection); outline-offset: 2px; }
.bbx-host .bbx-frame[data-preview] .bbx-content [data-bb-add], .bbx-host .bbx-content [data-bb-add][data-bbx-off] { display: none !important; }
.bbx-host .bbx-item-box { position: absolute; border: 1.5px dotted var(--bbe-selection); border-radius: 4px; pointer-events: none; }
.bbx-host .bbx-item-box[hidden], .bbx-host .bbx-itembar[hidden] { display: none; }
.bbx-host .bbx-itembar { position: absolute; z-index: 2; display: flex; gap: 2px; padding: 2px; border-radius: calc(var(--bbe-radius) + 2px); pointer-events: auto;
  background: var(--bbe-selection); color: var(--bbe-accent-fg); box-shadow: var(--bbe-shadow); }
.bbx-host .bbx-itembar button { all: unset; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--bbe-radius);
  color: var(--bbe-accent-fg); cursor: pointer; }
.bbx-host .bbx-itembar .bbx-icon { width: 14px; height: 14px; }
.bbx-host .bbx-itembar button:hover, .bbx-host .bbx-itembar button:focus-visible { background: color-mix(in srgb, var(--bbe-accent-fg) 22%, transparent); }
.bbx-host .bbx-itembar button:disabled { opacity: .4; cursor: default; }
${FIELD_PANEL_CSS}`;

const TOOLBAR: [action: string, label: string, icon: IconName][] = [
  ['drag', 'Drag to move', 'grip'],
  ['parent', 'Select parent', 'parent'],
  ['up', 'Move up', 'arrow-up'],
  ['down', 'Move down', 'arrow-down'],
  ['duplicate', 'Duplicate', 'copy'],
  ['delete', 'Delete', 'trash'],
];

const TEXT_TYPES = new Set(['text', 'button', 'link', 'rich-text']);

/** Zero-width space: holds the caret inside an empty inline element; removed when saving. */
const CARET_HOLDER = String.fromCharCode(0x200b);
const NBSP = String.fromCharCode(0xa0);

/**
 * Browsers type a space at the end of a text node as &nbsp; and turn it back into a space only
 * when more text follows in the same node. Text that continues in another node (a new <strong>)
 * keeps the &nbsp;; this turns single ones between words back into ordinary spaces.
 */
function normalizeTypedSpaces(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const text = nodes.map((n) => n.data.split(CARET_HOLDER).join('')).join('');
  let offset = 0;
  for (const node of nodes) {
    const chars = [...node.data];
    let changed = false;
    let pos = offset;
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === CARET_HOLDER) continue;
      const prev = text[pos - 1];
      const next = text[pos + 1];
      if (chars[i] === NBSP && prev && next && !/\s/.test(prev) && !/\s/.test(next)) {
        chars[i] = ' ';
        changed = true;
      }
      pos++;
    }
    if (changed) node.data = chars.join('');
    offset = pos;
  }
}

/**
 * Toggles inline formatting in the editable `root`, like a word processor: a selection is wrapped
 * in a new `tag` element (or unwrapped, inside one of `names`); at a caret, what's typed next
 * starts (or stops) being formatted.
 */
function toggleInline(root: HTMLElement, tag: string, names: string[]): void {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  let inside: Element | undefined;
  for (let n: Node | null = range.commonAncestorContainer; n && n !== root; n = n.parentNode) {
    if (n.nodeType === 1 && names.includes((n as Element).localName)) {
      inside = n as Element;
      break;
    }
  }
  const caretIn = (text: Text) => {
    const r = doc.createRange();
    r.setStart(text, text.length);
    selection.removeAllRanges();
    selection.addRange(r);
  };
  const select = (r: Range) => {
    selection.removeAllRanges();
    selection.addRange(r);
  };
  if (range.collapsed) {
    const holder = doc.createTextNode(CARET_HOLDER);
    if (inside) inside.after(holder);
    else {
      const wrapper = doc.createElement(tag);
      wrapper.append(holder);
      range.insertNode(wrapper);
    }
    caretIn(holder);
    return;
  }
  if (inside) {
    const first = inside.firstChild;
    const last = inside.lastChild;
    inside.replaceWith(...inside.childNodes);
    if (first && last) {
      const r = doc.createRange();
      r.setStartBefore(first);
      r.setEndAfter(last);
      select(r);
    }
    return;
  }
  const wrapper = doc.createElement(tag);
  wrapper.append(range.extractContents());
  range.insertNode(wrapper);
  const r = doc.createRange();
  r.selectNodeContents(wrapper);
  select(r);
}

/**
 * The editing canvas. Renders the page into light DOM in the host document (no iframe, no shadow
 * root), so standard selection, contenteditable and hit testing work, and host components keep
 * their app context. Breakpoints are simulated by the viewport width; sections respond through
 * container queries.
 */
export class CanvasView {
  readonly frame: HTMLElement;
  readonly id = `c${++counter}`;
  private readonly stage: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly content: HTMLElement;
  private readonly pageStyle: HTMLStyleElement;
  private readonly overlay: HTMLElement;
  private readonly hoverBox: HTMLElement;
  private readonly selectBox: HTMLElement;
  private readonly selectLabel: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly drop: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly peerLayer: HTMLElement;
  private readonly off: () => void;
  private readonly resize: ResizeObserver;
  private frameRequest = 0;
  private needsRender = true;
  private editing: {
    id: string;
    el: HTMLElement;
    original: string;
    key: string;
    /** Editing a piece of site data in place, rather than a node's prop. */
    data?: { path: string; required: boolean; multiline: boolean };
  } | null = null;
  /** Where picked image files go (set by the element from its `assets`). */
  assets: CanvasAssets | undefined;
  private readonly panel: FieldPanel;
  private readonly itemBox: HTMLElement;
  private readonly itembar: HTMLElement;
  /** The editable data field last clicked (Enter edits it). */
  private activeField: string | null = null;
  /** The list item from site data last clicked. */
  private activeItem: { path: string; unique?: string[] } | null = null;
  /** Data just added: once it's on the page, its field is edited. */
  private pendingEdit: string | null = null;
  private dropTargetState: DropTarget | null = null;
  private scale = 1;

  constructor(
    readonly host: HTMLElement,
    readonly controller: EditorController,
  ) {
    const doc = host.ownerDocument;
    const el = (tag: string, className: string, parent: HTMLElement) => {
      const e = doc.createElement(tag);
      e.className = className;
      parent.append(e);
      return e;
    };
    const chrome = doc.createElement('style');
    chrome.textContent = CANVAS_CSS;
    host.append(chrome);
    this.frame = el('div', 'bbx-frame', host);
    this.frame.setAttribute('data-bb-canvas', this.id);
    // Focusable so keyboard shortcuts (Delete, Enter, Alt+arrows) work after clicking the page.
    this.frame.tabIndex = 0;
    this.frame.setAttribute('role', 'region');
    this.frame.setAttribute('aria-label', 'Page canvas');
    this.pageStyle = doc.createElement('style');
    this.frame.append(this.pageStyle);
    this.banner = el('div', 'bbx-banner', this.frame);
    this.banner.setAttribute('role', 'status');
    this.banner.hidden = true;
    this.stage = el('div', 'bbx-stage', this.frame);
    this.viewport = el('div', 'bbx-viewport', this.stage);
    this.content = el('div', 'bbx-content', this.viewport);
    this.overlay = el('div', 'bbx-overlay', this.stage);
    this.marks = el('div', 'bbx-marks', this.overlay);
    this.peerLayer = el('div', 'bbx-peers', this.overlay);
    this.hoverBox = el('div', 'bbx-box bbx-hover', this.overlay);
    this.selectBox = el('div', 'bbx-box bbx-select', this.overlay);
    this.selectLabel = el('div', 'bbx-label', this.selectBox);
    this.toolbar = el('div', 'bbx-toolbar', this.overlay);
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Selected element');
    for (const [action, label, name] of TOOLBAR) {
      const b = el('button', '', this.toolbar);
      b.dataset.action = action;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = iconMarkup(name, 'bbx-icon');
      if (action === 'drag') b.draggable = true;
    }
    this.drop = el('div', 'bbx-drop', this.overlay);
    this.itemBox = el('div', 'bbx-item-box', this.overlay);
    this.itembar = el('div', 'bbx-itembar', this.overlay);
    this.itembar.setAttribute('role', 'toolbar');
    this.itembar.setAttribute('aria-label', 'List item');
    for (const [action, label, name] of [
      ['up', 'Move item up', 'arrow-up'],
      ['down', 'Move item down', 'arrow-down'],
      ['duplicate', 'Copy item', 'copy'],
      ['remove', 'Remove item', 'trash'],
    ] as const) {
      const b = el('button', '', this.itembar);
      b.dataset.action = action;
      b.title = label;
      b.setAttribute('aria-label', label);
      // Static markup from icons.ts.
      b.innerHTML = iconMarkup(name, 'bbx-icon');
    }
    this.panel = new FieldPanel(this.overlay, (refocus) => {
      if (refocus) this.frame.focus({ preventScroll: true });
    });
    for (const e of [
      this.hoverBox,
      this.selectBox,
      this.toolbar,
      this.drop,
      this.itemBox,
      this.itembar,
    ])
      e.hidden = true;

    this.off = controller.on((event) => this.onEvent(event));
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(this.frame);
    this.resize.observe(this.content);
    this.bind();
    this.schedule();
  }

  destroy(): void {
    this.off();
    this.resize.disconnect();
    cancelAnimationFrame(this.frameRequest);
    this.host.replaceChildren();
  }

  private onEvent(event: EditorEvent): void {
    if (event.type === 'hover' || event.type === 'selection' || event.type === 'peers')
      this.updateOverlays();
    else if (event.type !== 'error') {
      // Someone else removed (or the page switched away from) the node being edited.
      if (this.editing && !this.controller.node(this.editing.id)) {
        const { id, el } = this.editing;
        // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the typed line breaks
        const typed = (el.innerText ?? el.textContent ?? '').trim();
        this.finishEditing(false);
        this.controller.report([
          {
            code: 'conflict',
            nodeId: id,
            message: `"${id}" was removed while you were editing it, so your text wasn't saved${typed ? `: “${typed.slice(0, 120)}”` : ''}.`,
          },
        ]);
      }
      this.needsRender = true;
      this.schedule();
    }
  }

  private schedule(): void {
    if (this.frameRequest) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      if (this.needsRender && !this.editing) this.render();
      this.layout();
    });
  }

  /** Renders the current page synchronously (normally batched to the next frame). */
  render(): void {
    this.needsRender = false;
    const c = this.controller;
    const doc = c.viewDoc;
    const page = c.currentPage;
    const symbol = c.currentSymbol;
    const canvasSelector = `[data-bb-canvas="${this.id}"]`;
    let html: string;
    let css: string;
    let empty: boolean;
    if (symbol && doc.nodes[symbol.rootId]) {
      ({ html, css } = renderSubtree(doc, c.store.registry, symbol.rootId, {
        mode: 'editor',
        canvasSelector,
        ...(c.locale ? { locale: c.locale } : {}),
      }));
      empty = false;
    } else if (page && doc.pages[page.id]) {
      ({ html, css } = renderPage(doc, c.store.registry, page.id, {
        mode: 'editor',
        canvasSelector,
        ...(c.locale ? { locale: c.locale } : {}),
      }));
      empty = !Object.values(doc.nodes).some((n) => n.parent === page.rootId);
    } else {
      this.content.innerHTML = '<div class="bbx-empty">This site has no pages yet.</div>';
      this.updateBanner();
      return;
    }
    this.pageStyle.textContent = css;
    queueMicrotask(() => this.runPendingEdit());
    this.content.innerHTML = empty
      ? `${html}<div class="bbx-empty">${c.can('insert') ? 'This page is empty. Add a section from the Insert panel, or drag one here.' : 'This page is empty.'}</div>`
      : html;
    // The page's links and buttons are content being edited, not controls: keep them out of the
    // Tab order (the canvas itself is focusable, and nodes are reached through Layers). The
    // editor's own add buttons stay reachable.
    for (const el of this.content.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, [tabindex]',
    ))
      if (!el.hasAttribute('data-bb-add')) el.tabIndex = -1;
    // Add buttons only where a click would add something (the host may have turned adding off).
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-bb-add]')) {
      const add = readAdd(el);
      el.toggleAttribute('data-bbx-off', !add || !c.canAdd(add.path, add.value));
    }
    if (c.theme) this.frame.setAttribute('data-theme', c.theme);
    else this.frame.removeAttribute('data-theme');
    this.frame.toggleAttribute('data-preview', c.preview);
    this.updateBanner();
  }

  private updateBanner(): void {
    const c = this.controller;
    const ghost = c.ghost;
    const symbol = c.currentSymbol;
    this.banner.classList.toggle('bbx-ghost-banner', !!ghost);
    this.banner.classList.toggle('bbx-symbol-banner', !ghost && !!symbol);
    if (ghost) {
      const parts = [
        ghost.created.length && `${ghost.created.length} new`,
        ghost.updated.length && `${ghost.updated.length} changed`,
        ghost.removed.length && `${ghost.removed.length} removed`,
      ].filter(Boolean);
      this.banner.textContent = `${ghost.label}${parts.length ? ` · ${parts.join(', ')}` : ''} · not applied yet`;
    } else if (symbol) {
      const count = Object.values(c.doc.nodes).filter(
        (n) => n.link?.symbol === symbol.id && n.link.node === symbol.rootId,
      ).length;
      this.banner.textContent = `Editing linked component “${symbol.name}”: changes apply to ${count} instance${count === 1 ? '' : 's'}`;
    }
    this.banner.hidden = !ghost && !symbol;
  }

  private layout(): void {
    const width = this.controller.previewWidth();
    const available = Math.max(200, this.frame.clientWidth - 48);
    const zoom = this.controller.zoom;
    this.scale = zoom === 'fit' ? Math.min(1, available / width) : zoom;
    const height = this.content.offsetHeight;
    this.viewport.style.width = `${width}px`;
    this.viewport.style.transform = this.scale === 1 ? '' : `scale(${this.scale})`;
    this.viewport.style.setProperty(
      '--bb-viewport-height',
      `${Math.round(this.frame.clientHeight / this.scale)}px`,
    );
    this.stage.style.width = `${Math.ceil(width * this.scale)}px`;
    this.stage.style.height = `${Math.ceil(height * this.scale)}px`;
    this.updateOverlays();
  }

  private element(id: string | null): HTMLElement | null {
    if (!id) return null;
    return this.content.querySelector<HTMLElement>(`[data-bb-node="${CSS.escape(id)}"]`);
  }

  private place(box: HTMLElement, rect: DOMRect | null): void {
    if (!rect) {
      box.hidden = true;
      return;
    }
    const s = this.stage.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left - s.left}px`;
    box.style.top = `${rect.top - s.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  /** Outlines for the nodes a ghost preview creates (green) or changes (amber). */
  private updateMarks(): void {
    const ghost = this.controller.ghost;
    const top = (ids: string[]) =>
      ids.filter((id) => !ids.some((o) => o !== id && id.startsWith(`${o}/`)));
    const wanted = ghost
      ? [
          ...top(ghost.created).map((id) => [id, 'bbx-created'] as const),
          ...ghost.updated
            .filter((id) => !ghost.created.includes(id))
            .map((id) => [id, 'bbx-updated'] as const),
        ].slice(0, 60)
      : [];
    const s = this.stage.getBoundingClientRect();
    const doc = this.host.ownerDocument;
    while (this.marks.children.length > wanted.length) this.marks.lastElementChild!.remove();
    wanted.forEach(([id, kind], i) => {
      const mark =
        (this.marks.children[i] as HTMLElement | undefined) ??
        this.marks.appendChild(doc.createElement('div'));
      mark.className = `bbx-mark ${kind}`;
      const rect = this.element(id)?.getBoundingClientRect();
      mark.hidden = !rect;
      if (!rect) return;
      mark.style.left = `${rect.left - s.left - 2}px`;
      mark.style.top = `${rect.top - s.top - 2}px`;
      mark.style.width = `${rect.width + 4}px`;
      mark.style.height = `${rect.height + 4}px`;
    });
  }

  /** Boxes with name tags for what other people and agents have selected on this page. */
  private updatePeers(): void {
    const c = this.controller;
    const doc = this.host.ownerDocument;
    // Preview mode hides all overlays. Showing a component definition, peers on its nodes show
    // (agents editing a definition have no page).
    const visible =
      c.preview || !c.can('canvas.peers')
        ? []
        : c.peers.filter(
            (p) =>
              p.selection &&
              (c.symbolView || !p.page || p.page === c.page) &&
              this.element(p.selection),
          );
    const s = this.stage.getBoundingClientRect();
    while (this.peerLayer.children.length > visible.length)
      this.peerLayer.lastElementChild!.remove();
    visible.forEach((peer, i) => {
      let box = this.peerLayer.children[i] as HTMLElement | undefined;
      if (!box) {
        box = doc.createElement('div');
        box.className = 'bbx-peer';
        box.append(doc.createElement('span'));
        box.firstElementChild!.className = 'bbx-peer-tag';
        this.peerLayer.append(box);
      }
      const rect = this.element(peer.selection!)!.getBoundingClientRect();
      box.style.setProperty('--peer', peer.color);
      box.style.left = `${rect.left - s.left}px`;
      box.style.top = `${rect.top - s.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      const name = peer.actor.name ?? peer.actor.id;
      box.firstElementChild!.textContent = `${name}${peer.editing ? ' is typing…' : peer.activity ? ` · ${peer.activity}` : ''}`;
      box.title = name;
    });
  }

  updateOverlays(): void {
    const c = this.controller;
    this.updateMarks();
    this.updatePeers();
    const showChrome = !c.readOnly;
    const hoverEl = showChrome && c.hovered !== c.selected ? this.element(c.hovered) : null;
    this.place(this.hoverBox, hoverEl?.getBoundingClientRect() ?? null);
    const selEl = showChrome ? this.element(c.selected) : null;
    const rect = selEl?.getBoundingClientRect() ?? null;
    this.place(this.selectBox, rect);
    // What the host turned off disappears from the selection's label and toolbar.
    // Only what the feature settings and the policy allow for this node.
    const allowed = c.selectionActions();
    const shown: Record<string, boolean> = {
      drag: allowed.up || allowed.down,
      parent: true,
      up: allowed.up,
      down: allowed.down,
      duplicate: allowed.duplicate,
      delete: allowed.delete,
    };
    let actions = 0;
    for (const b of this.toolbar.querySelectorAll<HTMLElement>('button')) {
      b.hidden = !shown[b.dataset.action ?? ''];
      if (!b.hidden && b.dataset.action !== 'parent') actions++;
    }
    const showToolbar = c.can('canvas.toolbar') && actions > 0;
    this.selectLabel.hidden = !c.can('canvas.label');
    if (rect && c.selected) {
      const node = c.node(c.selected);
      this.selectLabel.textContent = node?.section
        ? `${c.selected} · ${node.section.name}`
        : `${c.selected} · ${node?.type}`;
    }
    if (rect && c.selected && showToolbar) {
      const s = this.stage.getBoundingClientRect();
      this.toolbar.hidden = false;
      const tw = this.toolbar.offsetWidth || 160;
      const lw = this.selectLabel.hidden ? 0 : this.selectLabel.offsetWidth || 120;
      const stageWidth = this.stage.clientWidth;
      const selLeft = rect.left - s.left;
      const above = rect.top - s.top - 38;
      // Above the element, right-aligned; for a narrow element, just after its label instead.
      // Only below it when there's no room above: there it would cover the next element.
      let left = Math.max(0, Math.min(rect.right - s.left - tw, stageWidth - tw));
      let top = above;
      const afterLabel = selLeft + lw + 4;
      if (above < 0) top = rect.bottom - s.top + 6;
      else if (lw && left < afterLabel) {
        if (afterLabel + tw <= stageWidth) left = afterLabel;
        else top = rect.bottom - s.top + 6;
      }
      this.toolbar.style.left = `${left}px`;
      this.toolbar.style.top = `${top}px`;
    } else {
      this.toolbar.hidden = true;
    }
    const target = this.dropTargetState;
    this.drop.classList.toggle('bbx-inside', target?.indicator.kind === 'box');
    this.place(this.drop, target?.indicator.rect ?? null);
    this.updateItem();
    this.updatePanel(rect);
  }

  /** The active list item's outline and toolbar (move, copy, remove). */
  private updateItem(): void {
    const c = this.controller;
    const item = this.activeItem;
    const el = item && !c.readOnly && c.can('data.items') ? this.itemElement(item.path) : null;
    if (!el) {
      this.itemBox.hidden = true;
      this.itembar.hidden = true;
      return;
    }
    const rect = el.getBoundingClientRect();
    this.place(this.itemBox, rect);
    const s = this.stage.getBoundingClientRect();
    const index = Number(item!.path.split('.').at(-1));
    const siblings = this.siblingItems(item!.path);
    for (const b of this.itembar.querySelectorAll<HTMLButtonElement>('button')) {
      const action = b.dataset.action;
      b.disabled = (action === 'up' && index === 0) || (action === 'down' && index >= siblings - 1);
    }
    this.itembar.hidden = false;
    const width = this.itembar.offsetWidth || 100;
    this.itembar.style.left = `${Math.max(0, rect.right - s.left - width)}px`;
    this.itembar.style.top = `${Math.max(0, rect.top - s.top - 32)}px`;
  }

  private itemElement(path: string): HTMLElement | null {
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-bb-item]')) {
      if (readItem(el)?.path === path) return el;
    }
    return null;
  }

  /** How many items the list holding `path` has. */
  private siblingItems(path: string): number {
    const parent = path.slice(0, path.lastIndexOf('.'));
    let n = 0;
    for (const el of this.content.querySelectorAll<HTMLElement>('[data-bb-item]')) {
      const p = readItem(el)?.path;
      if (p && p.slice(0, p.lastIndexOf('.')) === parent) n++;
    }
    return n;
  }

  /**
   * The field panel: a form for data opened by a double-click, or the fields of the selected
   * element that aren't edited in place (a photo, its alt text, a link's address).
   */
  private updatePanel(selected: DOMRect | null): void {
    const c = this.controller;
    const panel = this.panel;
    const s = this.stage.getBoundingClientRect();
    const toStage = (r: DOMRect) => ({
      left: r.left - s.left,
      top: r.top - s.top,
      bottom: r.bottom - s.top,
      width: r.width,
    });
    if (panel.anchor?.startsWith('data:')) {
      const el = this.content.querySelector<HTMLElement>(
        `[data-bb-data="${CSS.escape(panel.anchor.slice(5))}"]`,
      );
      if (!el || c.readOnly) panel.close();
      else panel.place(toStage(el.getBoundingClientRect()), this.stage.clientHeight);
      return;
    }
    const node = c.selected ? c.node(c.selected) : undefined;
    const fields =
      node && selected && !c.readOnly && !this.editing && c.can('canvas.fields')
        ? this.nodeFields(node.id)
        : [];
    if (!fields.length) {
      if (panel.anchor?.startsWith('node:')) panel.close();
      return;
    }
    const anchor = `node:${node!.id}`;
    if (panel.anchor !== anchor) panel.show(anchor, 'Selected element', fields, { modal: false });
    panel.place(toStage(selected!), this.stage.clientHeight);
  }

  /** Content props of a node that aren't edited in place, as panel fields. */
  private nodeFields(id: string): PanelField[] {
    const c = this.controller;
    const node = c.node(id);
    const def = node ? c.store.registry.component(node.type) : undefined;
    if (!node || !def) return [];
    const content = new Set(def.contentProps ?? []);
    const inline = INLINE_PROP[node.type];
    const props = localizedProps(node, c.locale ?? undefined);
    return fieldsFor(def)
      .filter((f) => content.has(f.key) && f.key !== inline)
      .map((f): PanelField => {
        const value = props[f.key];
        const kind: PanelField['kind'] =
          f.kind === 'image'
            ? 'image'
            : f.kind === 'url'
              ? 'url'
              : f.key === 'date'
                ? 'date'
                : f.kind === 'textarea'
                  ? 'multiline'
                  : 'text';
        return {
          label: f.label,
          kind,
          value: typeof value === 'string' ? value : value === undefined ? '' : String(value),
          commit: (v) =>
            !!c.setProps(
              id,
              { [f.key]: v === '' && !f.required ? null : v },
              `Edit ${f.label.toLowerCase()}`,
            ).ok,
          ...(kind === 'image' && this.assets
            ? { upload: (file: File) => this.upload(id, f.key, file) }
            : {}),
        };
      });
  }

  private async upload(id: string, key: string, file: File): Promise<void> {
    const c = this.controller;
    try {
      const asset = await this.assets!.upload(file);
      const node = c.node(id);
      const props: Record<string, unknown> = { [key]: asset.src };
      if (key === 'src') {
        if (asset.width) props.width = asset.width;
        if (asset.height) props.height = asset.height;
        if (asset.alt && !node?.props.alt) props.alt = asset.alt;
      }
      c.setProps(id, props, 'Upload image');
    } catch (error) {
      c.report([
        {
          code: 'invalid_props',
          nodeId: id,
          message: `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  }

  /** An element's box in stage coordinates (where overlays are placed). */
  private stageRect(el: Element) {
    const s = this.stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { left: r.left - s.left, top: r.top - s.top, bottom: r.bottom - s.top, width: r.width };
  }

  /** Adds what a `data-bb-add` placeholder offers, then edits it once it's on the page. */
  addFrom(el: HTMLElement): boolean {
    const c = this.controller;
    const add = readAdd(el);
    if (!add || c.readOnly) return false;
    const at = c.addData(add.path, add.value);
    if (!at) return false;
    const isItem = /\.\d+$/.test(at);
    if (isItem) this.activeItem = { path: at };
    const field = add.edit;
    this.pendingEdit = field === undefined ? null : field ? `${at}.${field}` : at;
    this.frame.focus({ preventScroll: true });
    return true;
  }

  private runPendingEdit(): void {
    const path = this.pendingEdit;
    if (!path || this.editing) return;
    this.pendingEdit = null;
    const el = this.content.querySelector<HTMLElement>(
      `[data-bb-data="${CSS.escape(path)}"][data-bb-edit]`,
    );
    if (el) {
      this.activeField = path;
      this.startDataEditing(el);
    }
  }

  /** Edits the data field last clicked (Enter on the canvas). */
  editActiveField(): boolean {
    if (!this.activeField) return false;
    const el = this.content.querySelector<HTMLElement>(
      `[data-bb-data="${CSS.escape(this.activeField)}"][data-bb-edit]`,
    );
    return !!el && this.startDataEditing(el);
  }

  /**
   * Edits site data shown by an element: in place when it's one text field showing its value,
   * otherwise in a form over it.
   */
  startDataEditing(el: HTMLElement): boolean {
    const c = this.controller;
    if (c.readOnly || !c.can('data')) return false;
    let fields: EditField[];
    try {
      fields = JSON.parse(el.getAttribute('data-bb-edit') ?? '[]') as EditField[];
    } catch {
      return false;
    }
    if (!fields.length) return false;
    if (this.editing) this.finishEditing(true);
    const first = fields[0]!;
    const kind = first.kind ?? 'text';
    const shown = (el.textContent ?? '').trim();
    const value = first.value ?? shown;
    const owner = el.closest('[data-bb-node]')?.getAttribute('data-bb-node') ?? '';
    const inPlace =
      fields.length === 1 &&
      (kind === 'text' || kind === 'multiline') &&
      el.children.length === 0 &&
      shown === value.trim();
    if (!inPlace) {
      this.panel.show(
        `data:${first.path}`,
        first.label ?? 'Edit',
        fields.map((f) => ({
          label: f.label ?? f.path.split('.').at(-1)!,
          kind: f.kind ?? 'text',
          value: f.value ?? '',
          ...(f.options ? { options: f.options } : {}),
          commit: (v: string) =>
            !!c.setData(f.path, v, {
              ...(f.required ? { required: true } : {}),
              label: `Edit ${f.label?.toLowerCase() ?? 'field'}`,
            })?.ok,
        })),
        { modal: true, at: { rect: this.stageRect(el), stageHeight: this.stage.clientHeight } },
      );
      this.updateOverlays();
      return true;
    }
    this.editing = {
      id: owner,
      el,
      original: value,
      key: '',
      data: { path: first.path, required: !!first.required, multiline: kind === 'multiline' },
    };
    try {
      el.contentEditable = 'plaintext-only';
    } catch {
      el.contentEditable = 'true';
    }
    el.spellcheck = true;
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const selection = el.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const multiline = kind === 'multiline';
    const inSummary = !!el.closest('summary');
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      // No formatting in data: it's plain text.
      if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'k', 'u'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        return;
      }
      // Inside a <summary>, Space would toggle its <details>: type the space ourselves.
      if (e.key === ' ' && inSummary) {
        e.preventDefault();
        el.ownerDocument.execCommand('insertText', false, ' ');
        return;
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.finishEditing(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEditing(false);
      }
    };
    const onBlur = () => this.finishEditing(true);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur, { once: true });
    this.cleanupEditing = () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
    };
    return true;
  }

  private idAt(target: EventTarget | null): string | null {
    const el = (target as Element | null)?.closest?.('[data-bb-node]');
    const id = el?.getAttribute('data-bb-node') ?? null;
    return id && !this.controller.isRoot(id) ? id : null;
  }

  private bind(): void {
    const c = this.controller;
    const content = this.content;
    content.addEventListener('pointermove', (e) => {
      if (!c.readOnly && !this.editing) c.hover(this.idAt(e.target));
    });
    content.addEventListener('pointerleave', () => c.hover(null));
    content.addEventListener(
      'click',
      (e) => {
        if (this.editing && (e.target as Element).closest('[contenteditable]')) return;
        e.preventDefault();
        if (c.readOnly) return;
        const id = this.idAt(e.target);
        const target = e.target as Element;
        // A placeholder that adds data (the first item of an empty list, a missing value).
        const adder = target.closest?.<HTMLElement>('[data-bb-add]');
        if (adder && this.content.contains(adder)) {
          this.addFrom(adder);
          return;
        }
        // Remember the data field and list item clicked (Enter edits the field; the item gets a toolbar).
        this.activeField = target.closest?.('[data-bb-edit]')?.getAttribute('data-bb-data') ?? null;
        const itemEl = target.closest?.<HTMLElement>('[data-bb-item]');
        this.activeItem = itemEl ? readItem(itemEl) : null;
        if (
          this.panel.anchor?.startsWith('data:') &&
          this.panel.anchor.slice(5) !== this.activeField
        )
          this.panel.close();
        c.select(id);
        this.frame.focus({ preventScroll: true });
        this.updateOverlays();
        // Text shown from site data (e.g. a schedule item): the host can open where it's edited.
        const path = target.closest?.('[data-bb-data]')?.getAttribute('data-bb-data');
        if (path) c.openData(path, id);
      },
      true,
    );
    content.addEventListener('submit', (e) => e.preventDefault(), true);
    // Add placeholders are buttons for the keyboard too.
    content.addEventListener('keydown', (e) => {
      const adder = (e.target as Element).closest?.<HTMLElement>('[data-bb-add]');
      if (!adder || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      this.addFrom(adder);
    });
    content.addEventListener('dblclick', (e) => {
      // Site data first: its text sits inside a component node that isn't text itself.
      const field = (e.target as Element).closest?.<HTMLElement>('[data-bb-edit]');
      if (field && this.content.contains(field) && this.startDataEditing(field)) return;
      const id = this.idAt(e.target);
      if (id && !c.readOnly) this.startEditing(id);
    });
    this.itembar.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.action;
      const item = this.activeItem;
      if (!item || !action) return;
      const next = c.dataItem(
        item.path,
        action as 'up' | 'down' | 'duplicate' | 'remove',
        item.unique,
      );
      this.activeItem = next ? { ...item, path: next } : null;
      this.updateOverlays();
    });
    this.frame.addEventListener('scroll', () => this.updateOverlays(), { passive: true });

    this.toolbar.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.action;
      if (action === 'parent') c.selectParent();
      else if (action === 'up') c.nudge(-1);
      else if (action === 'down') c.nudge(1);
      else if (action === 'duplicate') c.duplicateSelected();
      else if (action === 'delete' && c.removeSelected()?.ok)
        this.frame.focus({ preventScroll: true });
    });
    this.toolbar.addEventListener('dragstart', (e) => {
      if (c.selected) startDrag(e, { kind: 'move', id: c.selected, source: c });
    });
    this.toolbar.addEventListener('dragend', () => {
      endDrag();
      this.clearDrop();
    });

    this.frame.addEventListener('dragover', (e) => {
      const payload = currentDrag(e, c);
      if (!payload || c.readOnly) return;
      const allowed =
        payload.kind === 'move'
          ? c.can('move')
          : payload.kind === 'section'
            ? c.features.section(payload.name)
            : c.can('insert.elements');
      if (!allowed) return;
      const target = dropTarget(c, payload, e.target as Element, e.clientX, e.clientY, content);
      this.dropTargetState = target;
      if (target) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = payload.kind === 'move' ? 'move' : 'copy';
      }
      this.updateOverlays();
    });
    this.frame.addEventListener('dragleave', (e) => {
      if (!this.frame.contains(e.relatedTarget as Node | null)) this.clearDrop();
    });
    this.frame.addEventListener('drop', (e) => {
      const payload = currentDrag(e, c);
      const target = this.dropTargetState;
      this.clearDrop();
      endDrag();
      if (!payload || !target) return;
      e.preventDefault();
      performDrop(c, payload, target);
    });
  }

  private clearDrop(): void {
    this.dropTargetState = null;
    this.updateOverlays();
  }

  /** Inline text editing for text, link and button nodes without children. */
  startEditing(id: string): boolean {
    const c = this.controller;
    const node = c.node(id);
    const el = this.element(id);
    if (
      c.readOnly ||
      !c.can('text') ||
      !node ||
      !el ||
      !TEXT_TYPES.has(node.type) ||
      c.store.view.children(id).length
    )
      return false;
    if (this.editing) this.finishEditing(true);
    const rich = node.type === 'rich-text';
    const key = rich ? 'html' : 'text';
    const value = localizedProps(node, c.locale ?? undefined)[key];
    const original = typeof value === 'string' ? value : '';
    this.editing = { id, el, original, key };
    c.select(id);
    c.setEditing(id);
    if (rich) el.contentEditable = 'true';
    else {
      try {
        el.contentEditable = 'plaintext-only';
      } catch {
        el.contentEditable = 'true';
      }
    }
    el.spellcheck = true;
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const selection = el.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const doc = el.ownerDocument;
      if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'k'].includes(e.key.toLowerCase())) {
        // Inline formatting; the result is sanitized to the rich-text subset when saved. Without
        // rich text (or with formatting turned off) the browser's own formatting is blocked too.
        e.preventDefault();
        if (!rich || !c.can('text.formatting')) return;
        const k = e.key.toLowerCase();
        // Our own toggle: execCommand('bold') un-bolds headings with <span style>, which the
        // rich-text subset can't keep.
        if (k === 'b') toggleInline(el, 'strong', ['strong', 'b']);
        else if (k === 'i') toggleInline(el, 'em', ['em', 'i']);
        else {
          const url = doc.defaultView?.prompt('Link to (URL or /path):', 'https://');
          if (url) doc.execCommand('createLink', false, url);
        }
        return;
      }
      // An editable <button> takes Space as a click instead of typing it.
      if (e.key === ' ' && el.localName === 'button' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        doc.execCommand('insertText', false, ' ');
        return;
      }
      if (rich && e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        doc.execCommand('insertLineBreak');
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.finishEditing(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finishEditing(false);
      }
    };
    const onBlur = () => this.finishEditing(true);
    // Pasted markup is reduced to the rich-text subset before it lands (paragraphs and list items
    // become line breaks); plain text keeps its line breaks.
    const onPaste = (e: ClipboardEvent) => {
      if (!rich || !e.clipboardData) return;
      e.preventDefault();
      // Without formatting, pasted markup comes in as plain text.
      const html = c.can('text.formatting') ? e.clipboardData.getData('text/html') : '';
      const plain = e.clipboardData.getData('text/plain');
      const clean = html
        ? sanitizeRichText(html)
        : sanitizeRichText(
            plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\r?\n/g, '<br>'),
          );
      el.ownerDocument.execCommand('insertHTML', false, clean);
    };
    // Keyup would still activate an editable <button> (Space/Enter "click" it).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') e.preventDefault();
    };
    el.addEventListener('keydown', onKey);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('paste', onPaste);
    el.addEventListener('blur', onBlur, { once: true });
    this.cleanupEditing = () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('paste', onPaste);
      el.removeEventListener('blur', onBlur);
    };
    return true;
  }

  private cleanupEditing: () => void = () => {};

  finishEditing(commit: boolean): void {
    const state = this.editing;
    if (!state) return;
    this.editing = null;
    this.cleanupEditing();
    this.controller.setEditing(null);
    const focused = state.el.contains(state.el.ownerDocument.activeElement);
    // Keep line breaks (Shift+Enter); collapse other runs of whitespace.
    const normalize = (t: string) =>
      t
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .trim();
    const rich = state.key === 'html';
    const show = (v: string) => {
      if (rich) state.el.innerHTML = sanitizeRichText(v);
      else state.el.textContent = v;
    };
    if (rich) normalizeTypedSpaces(state.el);
    const text = rich
      ? sanitizeRichText(state.el.innerHTML.split(CARET_HOLDER).join(''))
      : // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the typed line breaks
        normalize(state.el.innerText ?? state.el.textContent ?? '');
    state.el.removeAttribute('contenteditable');
    // Enter or Escape: keep keyboard focus in the canvas. A blur moved it elsewhere already.
    if (focused) this.frame.focus({ preventScroll: true });
    if (state.data) {
      // Site data: plain text, saved through data.set (empty removes an optional value).
      const typed = state.data.multiline ? text : text.replace(/\s*\n\s*/g, ' ');
      const current = readData(this.controller, state.data.path);
      if (commit && typed !== normalize(state.original)) {
        if (current !== undefined && current !== state.original) {
          state.el.textContent = current;
          this.controller.report([
            {
              code: 'conflict',
              path: state.data.path,
              message: `Someone else changed ${state.data.path} while you were editing, so your text wasn't saved: “${typed.slice(0, 120)}”.`,
              hint: 'Edit it again to replace their version.',
            },
          ]);
        } else {
          const result = this.controller.setData(state.data.path, typed, {
            required: state.data.required,
            label: 'Edit text',
          });
          if (!result?.ok) state.el.textContent = state.original;
        }
      } else state.el.textContent = current ?? state.original;
      this.needsRender = true;
      this.schedule();
      return;
    }
    const node = this.controller.node(state.id);
    const currentValue = node
      ? localizedProps(node, this.controller.locale ?? undefined)[state.key]
      : undefined;
    const current = typeof currentValue === 'string' ? currentValue : undefined;
    const same = rich
      ? text === sanitizeRichText(state.original)
      : text === normalize(state.original);
    if (commit && !same) {
      if (current !== undefined && current !== state.original) {
        // Someone else changed this text while it was being edited: don't overwrite it silently.
        show(current);
        this.controller.report([
          {
            code: 'conflict',
            nodeId: state.id,
            message: `Someone else changed "${state.id}" while you were editing, so your text wasn't saved: “${text.slice(0, 120)}”.`,
            hint: 'Edit it again to replace their version.',
          },
        ]);
      } else {
        const result = this.controller.setProps(state.id, { [state.key]: text }, 'Edit text');
        if (!result.ok) show(state.original);
      }
    } else {
      show(current ?? state.original);
    }
    this.needsRender = true;
    this.schedule();
  }

  get isEditing(): boolean {
    return !!this.editing;
  }
}

/** The list item an element shows (`data-bb-item`). */
function readItem(el: Element): { path: string; unique?: string[] } | null {
  try {
    const item = JSON.parse(el.getAttribute('data-bb-item') ?? 'null') as {
      path?: unknown;
      unique?: unknown;
    } | null;
    if (!item || typeof item.path !== 'string') return null;
    return {
      path: item.path,
      ...(Array.isArray(item.unique)
        ? { unique: item.unique.filter((u): u is string => typeof u === 'string') }
        : {}),
    };
  } catch {
    return null;
  }
}

/** What an add placeholder adds (`data-bb-add`, see `ElementSpec.add`). */
function readAdd(el: Element): { path: string; value: unknown; edit?: string } | null {
  try {
    const add = JSON.parse(el.getAttribute('data-bb-add') ?? 'null') as {
      path?: unknown;
      value?: unknown;
      edit?: unknown;
    } | null;
    if (!add || typeof add.path !== 'string') return null;
    return {
      path: add.path,
      value: add.value,
      ...(typeof add.edit === 'string' ? { edit: add.edit } : {}),
    };
  } catch {
    return null;
  }
}

/** The current value of a piece of site data, as text (undefined when absent). */
function readData(c: EditorController, path: string): string | undefined {
  const [key, ...rest] = splitDataPath(path);
  let value: unknown = c.store.view.data?.(String(key));
  for (const seg of rest) value = (value as Record<string | number, unknown> | undefined)?.[seg];
  return value === undefined || value === null ? undefined : String(value);
}
