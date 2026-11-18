import { renderPage } from '@bowerbirdjs/html';
import type { EditorController, EditorEvent } from './controller.js';
import {
  currentDrag,
  type DropTarget,
  dropTarget,
  endDrag,
  performDrop,
  startDrag,
} from './dnd.js';

let counter = 0;

/**
 * Chrome for the canvas itself (light DOM, so every class is prefixed). Host page CSS reaches
 * light DOM, so the first rules revert host styles on the chrome (`.app div { … }`, inherited
 * fonts) and every chrome rule is scoped under `.bbx-host` to outrank typical host selectors.
 * Page content has its own reset in the page CSS.
 */
export const CANVAS_CSS = `
.bbx-host.bbx-host, .bbx-host.bbx-host :where(:not(.bb-page, .bb-page *)) { all: revert; }
.bbx-host.bbx-host { position: absolute; inset: 0; display: block; font: 13px/1.4 system-ui, sans-serif; color: #111827; }
.bbx-host .bbx-frame { position: relative; height: 100%; overflow: auto; background: var(--bb-editor-canvas-bg, #e9ebf0); outline: none; }
.bbx-host .bbx-frame:focus-visible { box-shadow: inset 0 0 0 2px var(--bb-editor-accent, #4f46e5); }
.bbx-host .bbx-stage { position: relative; margin: 24px auto 48px; }
.bbx-host .bbx-viewport { position: absolute; top: 0; left: 0; transform-origin: top left; contain: layout paint; background: #fff;
  box-shadow: 0 1px 2px rgb(15 23 42 / .08), 0 8px 28px rgb(15 23 42 / .10); }
.bbx-host .bbx-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.bbx-host .bbx-box { position: absolute; border: 1.5px solid var(--bb-editor-accent, #4f46e5); border-radius: 2px; box-sizing: border-box; }
.bbx-host .bbx-box[hidden], .bbx-host .bbx-toolbar[hidden], .bbx-host .bbx-drop[hidden] { display: none; }
.bbx-host .bbx-hover { border-style: dashed; }
.bbx-host .bbx-label { position: absolute; left: -1.5px; bottom: 100%; padding: 0 6px; border-radius: 4px 4px 0 0; white-space: nowrap;
  background: var(--bb-editor-accent, #4f46e5); color: #fff; font: 600 11px/20px system-ui, sans-serif; }
.bbx-host .bbx-toolbar { position: absolute; display: flex; gap: 1px; padding: 2px; border-radius: 6px; pointer-events: auto;
  background: #111827; box-shadow: 0 4px 12px rgb(0 0 0 / .2); }
.bbx-host .bbx-toolbar button { all: unset; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; color: #e5e7eb;
  cursor: pointer; font: 13px/1 system-ui, sans-serif; }
.bbx-host .bbx-toolbar button:hover, .bbx-host .bbx-toolbar button:focus-visible { background: #374151; color: #fff; }
.bbx-host .bbx-toolbar [draggable="true"] { cursor: grab; }
.bbx-host .bbx-drop { position: absolute; background: var(--bb-editor-accent, #4f46e5); border-radius: 2px; }
.bbx-host .bbx-drop.bbx-inside { background: color-mix(in srgb, var(--bb-editor-accent, #4f46e5) 10%, transparent);
  outline: 2px dashed var(--bb-editor-accent, #4f46e5); outline-offset: -2px; }
.bbx-host .bbx-empty { padding: 64px 24px; text-align: center; font: 15px/1.5 system-ui, sans-serif; color: #64748b; }
.bbx-host .bbx-content [contenteditable] { outline: 2px solid var(--bb-editor-accent, #4f46e5); outline-offset: 2px; cursor: text; }
.bbx-host .bbx-content :is(a, button) { cursor: default; }
`;

const TOOLBAR: [action: string, label: string, glyph: string][] = [
  ['drag', 'Drag to move', '⠿'],
  ['parent', 'Select parent', '↰'],
  ['up', 'Move up', '↑'],
  ['down', 'Move down', '↓'],
  ['duplicate', 'Duplicate', '⧉'],
  ['delete', 'Delete', '✕'],
];

const TEXT_TYPES = new Set(['text', 'button', 'link']);

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
  private readonly off: () => void;
  private readonly resize: ResizeObserver;
  private frameRequest = 0;
  private needsRender = true;
  private editing: { id: string; el: HTMLElement; original: string } | null = null;
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
    this.stage = el('div', 'bbx-stage', this.frame);
    this.viewport = el('div', 'bbx-viewport', this.stage);
    this.content = el('div', 'bbx-content', this.viewport);
    this.overlay = el('div', 'bbx-overlay', this.stage);
    this.hoverBox = el('div', 'bbx-box bbx-hover', this.overlay);
    this.selectBox = el('div', 'bbx-box bbx-select', this.overlay);
    this.selectLabel = el('div', 'bbx-label', this.selectBox);
    this.toolbar = el('div', 'bbx-toolbar', this.overlay);
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', 'Selected element');
    for (const [action, label, glyph] of TOOLBAR) {
      const b = el('button', '', this.toolbar);
      b.dataset.action = action;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.textContent = glyph;
      if (action === 'drag') b.draggable = true;
    }
    this.drop = el('div', 'bbx-drop', this.overlay);
    for (const e of [this.hoverBox, this.selectBox, this.toolbar, this.drop]) e.hidden = true;

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
    if (event.type === 'hover' || event.type === 'selection') this.updateOverlays();
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
    const page = c.currentPage;
    if (!page) {
      this.content.innerHTML = '<div class="bbx-empty">This site has no pages yet.</div>';
      return;
    }
    const { html, css } = renderPage(c.doc, c.store.registry, page.id, {
      mode: 'editor',
      canvasSelector: `[data-bb-canvas="${this.id}"]`,
    });
    this.pageStyle.textContent = css;
    const empty = !c.store.view.children(page.rootId).length;
    this.content.innerHTML = empty
      ? `${html}<div class="bbx-empty">This page is empty. Add a section from the Insert panel, or drag one here.</div>`
      : html;
    if (c.theme) this.frame.setAttribute('data-theme', c.theme);
    else this.frame.removeAttribute('data-theme');
    this.frame.toggleAttribute('data-preview', c.preview);
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

  updateOverlays(): void {
    const c = this.controller;
    const showChrome = !c.preview;
    const hoverEl = showChrome && c.hovered !== c.selected ? this.element(c.hovered) : null;
    this.place(this.hoverBox, hoverEl?.getBoundingClientRect() ?? null);
    const selEl = showChrome ? this.element(c.selected) : null;
    const rect = selEl?.getBoundingClientRect() ?? null;
    this.place(this.selectBox, rect);
    if (rect && c.selected) {
      const node = c.node(c.selected);
      this.selectLabel.textContent = node?.section
        ? `${c.selected} · ${node.section.name}`
        : `${c.selected} · ${node?.type}`;
      const s = this.stage.getBoundingClientRect();
      this.toolbar.hidden = false;
      const tw = this.toolbar.offsetWidth || 160;
      const lw = this.selectLabel.offsetWidth || 120;
      const left = Math.max(0, Math.min(rect.right - s.left - tw, this.stage.clientWidth - tw));
      const above = rect.top - s.top - 32;
      // Above the element on the right, unless that would cover the label or leave the stage.
      const collides = rect.width < lw + tw + 8;
      this.toolbar.style.left = `${left}px`;
      this.toolbar.style.top = `${above >= 0 && !collides ? above : rect.bottom - s.top + 6}px`;
    } else {
      this.toolbar.hidden = true;
    }
    const target = this.dropTargetState;
    this.drop.classList.toggle('bbx-inside', target?.indicator.kind === 'box');
    this.place(this.drop, target?.indicator.rect ?? null);
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
      if (!c.preview && !this.editing) c.hover(this.idAt(e.target));
    });
    content.addEventListener('pointerleave', () => c.hover(null));
    content.addEventListener(
      'click',
      (e) => {
        if (this.editing && (e.target as Element).closest('[contenteditable]')) return;
        e.preventDefault();
        if (c.preview) return;
        c.select(this.idAt(e.target));
        this.frame.focus({ preventScroll: true });
      },
      true,
    );
    content.addEventListener('submit', (e) => e.preventDefault(), true);
    content.addEventListener('dblclick', (e) => {
      const id = this.idAt(e.target);
      if (id && !c.preview) this.startEditing(id);
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
      if (!payload || c.preview) return;
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
    if (c.preview || !node || !el || !TEXT_TYPES.has(node.type) || c.store.view.children(id).length)
      return false;
    if (this.editing) this.finishEditing(true);
    const original = typeof node.props.text === 'string' ? node.props.text : '';
    this.editing = { id, el, original };
    c.select(id);
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
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
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

  private cleanupEditing: () => void = () => {};

  finishEditing(commit: boolean): void {
    const state = this.editing;
    if (!state) return;
    this.editing = null;
    this.cleanupEditing();
    const focused = state.el.contains(state.el.ownerDocument.activeElement);
    // Keep line breaks (Shift+Enter); collapse other runs of whitespace.
    const normalize = (t: string) =>
      t
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/ ?\n ?/g, '\n')
        .trim();
    // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the typed line breaks
    const text = normalize(state.el.innerText ?? state.el.textContent ?? '');
    state.el.removeAttribute('contenteditable');
    // Enter or Escape: keep keyboard focus in the canvas. A blur moved it elsewhere already.
    if (focused) this.frame.focus({ preventScroll: true });
    const current = this.controller.node(state.id)?.props.text;
    if (commit && text !== normalize(state.original)) {
      if (typeof current === 'string' && current !== state.original) {
        // Someone else changed this text while it was being edited: don't overwrite it silently.
        state.el.textContent = current;
        this.controller.report([
          {
            code: 'conflict',
            nodeId: state.id,
            message: `Someone else changed "${state.id}" while you were editing, so your text wasn't saved: “${text.slice(0, 120)}”.`,
            hint: 'Edit it again to replace their version.',
          },
        ]);
      } else {
        const result = this.controller.setProps(state.id, { text }, 'Edit text');
        if (!result.ok) state.el.textContent = state.original;
      }
    } else {
      state.el.textContent = typeof current === 'string' ? current : state.original;
    }
    this.needsRender = true;
    this.schedule();
  }

  get isEditing(): boolean {
    return !!this.editing;
  }
}
