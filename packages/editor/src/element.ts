import { createDefaultRegistry, createStarterDoc, PLACEHOLDER_IMAGE } from '@bowerbirdjs/blocks';
import {
  type Actor,
  type BNode,
  type ComponentDef,
  createStore,
  flattenTokens,
  formatIssue,
  type Issue,
  type NodeInput,
  type SectionDef,
  STATE_PSEUDO,
  type Store,
} from '@bowerbirdjs/core';
import { html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { CanvasView } from './canvas.js';
import { EditorController, type EditorEvent, type Position } from './controller.js';
import { currentDrag, type DragPayload, endDrag, performDrop, startDrag } from './dnd.js';
import { type Field, fieldsFor, fieldValue } from './schema-form.js';
import { editorStyles } from './styles.js';

const ELEMENTS: [string, NodeInput][] = [
  ['Box', { type: 'box' }],
  ['Text', { type: 'text', props: { text: 'New text' } }],
  ['Heading', { type: 'text', props: { tag: 'h2', text: 'New heading' } }],
  ['Link', { type: 'link', props: { text: 'Link', href: '#' } }],
  ['Button', { type: 'button', props: { text: 'Button' } }],
  ['Image', { type: 'image', props: { src: PLACEHOLDER_IMAGE, alt: '' } }],
];

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

const TABS = ['layers', 'insert', 'history'] as const;

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
    ops: [{ op: 'page.create', path: '/', title: 'Home' }],
  });
  return store;
}

export interface EditorChangeDetail {
  doc: Store['doc'];
}

/**
 * `<bowerbird-editor>`: the embeddable visual editor.
 *
 * Properties: `store` (a Bowerbird store; one is created if omitted), `actor` (who edits, default
 * the local user), `page` (page id, reflected).
 * Events (bubbling, composed): `bb-change`, `bb-transaction`, `bb-selection`, `bb-page`,
 * `bb-error`.
 * Methods: `apply(ops, label)`, `select(id)`, `undo()`, `redo()`.
 *
 * The panels live in this element's shadow root; the page canvas is a light-DOM child, so page
 * content is never inside a shadow root (see docs/plan.md §2.1).
 */
export class BowerbirdEditor extends LitElement {
  static override styles = editorStyles;
  static override properties = {
    store: { attribute: false },
    actor: { attribute: false },
    page: { type: String, reflect: true },
    tab: { state: true },
    tick: { state: true },
    toast: { state: true },
  };

  declare store: Store | undefined;
  declare actor: Actor | undefined;
  declare page: string | undefined;
  declare tab: (typeof TABS)[number];
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
  /** Layer row that holds keyboard focus (roving tabindex). */
  private focusedRow: string | null = null;
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
    // Set up on the first update rather than here, so properties that frameworks set right after
    // inserting the element (store, actor, page) are used from the start.
    if (!this.controller) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.disconnected = true;
    // Moving the element (remove + insert in one task) keeps its state; a real removal releases
    // the store subscription and canvas. Reconnecting later sets them up again.
    queueMicrotask(() => {
      if (this.disconnected && !this.isConnected) this.destroy();
    });
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
    });
    this.controller = controller;
    controller.on((event) => this.onControllerEvent(event));
    this.page = controller.page;
    this.canvasHost = this.ownerDocument.createElement('div');
    this.canvasHost.slot = 'canvas';
    this.canvasHost.className = 'bbx-host';
    this.append(this.canvasHost);
    this.canvas = new CanvasView(this.canvasHost, controller);
    if (
      Object.keys(this.store.doc.pages).length &&
      !this.store.view.children(controller.currentPage?.rootId ?? '').length
    ) {
      this.tab = 'insert';
    } else this.tab = 'layers';
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!this.controller) {
      if (this.isConnected) this.init();
      return;
    }
    const c = this.controller;
    // Read the requested page first: switching stores resets the page.
    const requested = changed.has('page') ? this.page : undefined;
    if (changed.has('store') && this.store && this.store !== c.store) c.setStore(this.store);
    if (changed.has('actor') && this.actor) c.actor = this.actor;
    if (requested && requested !== c.page) c.setPage(requested);
    if (this.page !== c.page) this.page = c.page;
  }

  // -------------------------------------------------------------------------------------------
  // Public API

  apply(ops: unknown[], label?: string) {
    return this.controller?.apply(ops, label);
  }

  select(id: string | null): void {
    this.controller?.select(id);
  }

  undo() {
    return this.controller?.undo();
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
      case 'error':
        this.showError(event.errors);
        this.emit('bb-error', { errors: event.errors, label: event.label });
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
      if (textEntry) return;
      e.preventDefault();
      if (e.shiftKey) c.redo();
      else c.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      if (textEntry) return;
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
    if (c.preview || !c.selected || !(onCanvas || onLayer)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      c.removeSelected();
      if (onLayer) this.focusRow(c.selected);
    } else if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      c.duplicateSelected();
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      c.nudge(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Enter' && onCanvas) {
      if (this.canvas?.startEditing(c.selected)) e.preventDefault();
    }
  };

  // -------------------------------------------------------------------------------------------
  // Rendering

  protected override render(): TemplateResult | typeof nothing {
    const c = this.controller;
    if (!c) return nothing;
    return html`
      <div class="toolbar" role="toolbar" aria-label="Editor">${this.renderToolbar(c)}</div>
      <section class="panel left" aria-label="Page structure">
        <div class="tabs" role="tablist" aria-label="Panels" @keydown=${this.onTabKey}>
          ${TABS.map(
            (tab) => html`<button
              role="tab"
              id=${`bb-tab-${tab}`}
              aria-selected=${this.tab === tab}
              aria-controls="bb-tabpanel"
              tabindex=${this.tab === tab ? 0 : -1}
              @click=${() => {
                this.tab = tab;
              }}
            >
              ${tab[0]!.toUpperCase() + tab.slice(1)}
            </button>`,
          )}
        </div>
        <div role="tabpanel" id="bb-tabpanel" aria-labelledby=${`bb-tab-${this.tab}`}>
          ${this.tab === 'layers' ? this.renderLayers(c) : this.tab === 'insert' ? this.renderInsert(c) : this.renderHistory(c)}
        </div>
      </section>
      <div class="center"><slot name="canvas"></slot></div>
      <section class="panel right" aria-label="Inspector">${this.renderInspector(c)}</section>
      <div class="toast" role="status" aria-live="polite" ?hidden=${!this.toast}>
        ${
          this.toast
            ? html`<p>${this.toast.message}</p>
              ${this.toast.hint ? html`<p class="hint">${this.toast.hint}</p>` : nothing}`
            : nothing
        }
      </div>
    `;
  }

  private onTabKey = (e: KeyboardEvent): void => {
    const i = TABS.indexOf(this.tab);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    this.tab = TABS[next]!;
    this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>(`#bb-tab-${this.tab}`)?.focus(),
    );
  };

  private canUndo(c: EditorController): boolean {
    return c.store.history.some((e) => e.actor.id === c.actor.id && e.kind !== 'undo' && !e.undone);
  }

  private canRedo(c: EditorController): boolean {
    for (let i = c.store.history.length - 1; i >= 0; i--) {
      const e = c.store.history[i]!;
      if (e.actor.id !== c.actor.id) continue;
      if (e.kind === 'edit') return false;
      if (e.kind === 'undo' && !e.redone) return true;
    }
    return false;
  }

  private renderToolbar(c: EditorController): TemplateResult {
    const doc = c.doc;
    const pages = Object.values(doc.pages);
    const themes = Object.keys(doc.themes);
    return html`
      <button
        class="icon-btn"
        title="Show or hide the structure panel"
        aria-label="Structure panel"
        aria-pressed=${!this.hasAttribute('left-hidden')}
        @click=${() => this.toggleAttribute('left-hidden')}
      >
        ☰
      </button>
      ${
        pages.length > 1
          ? html`<select class="compact" aria-label="Page" @change=${(e: Event) => c.setPage((e.target as HTMLSelectElement).value)}>
            ${pages.map((p) => html`<option value=${p.id} .selected=${live(p.id === c.page)}>${p.title} (${p.path})</option>`)}
          </select>`
          : html`<strong>${c.currentPage?.title ?? ''}</strong>`
      }
      <span class="spacer"></span>
      <div class="group" role="group" aria-label="Screen size">
        ${doc.breakpoints.map(
          (bp) => html`<button
            aria-pressed=${bp.id === c.breakpoint}
            title=${`${bp.label ?? bp.id}: styles for ${bp.minWidth}px and wider`}
            @click=${() => c.setBreakpoint(bp.id)}
          >
            ${bp.label ?? bp.id}
          </button>`,
        )}
      </div>
      <select
        class="compact"
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
      </select>
      <span class="spacer"></span>
      <button class="icon-btn" title="Undo your last change (Ctrl+Z)" ?disabled=${!this.canUndo(c)} @click=${() => c.undo()}>↶ Undo</button>
      <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" ?disabled=${!this.canRedo(c)} @click=${() => c.redo()}>↷</button>
      ${
        themes.length
          ? html`<select class="compact" aria-label="Theme" @change=${(e: Event) => c.setTheme((e.target as HTMLSelectElement).value || null)}>
            <option value="" .selected=${live(!c.theme)}>Default theme</option>
            ${themes.map((t) => html`<option value=${t} .selected=${live(c.theme === t)}>${t}</option>`)}
          </select>`
          : nothing
      }
      <button class="icon-btn" aria-pressed=${c.preview} title="Hide editing outlines" @click=${() => c.setPreview(!c.preview)}>
        Preview
      </button>
      <button
        class="icon-btn"
        title="Show or hide the inspector"
        aria-label="Inspector panel"
        aria-pressed=${!this.hasAttribute('right-hidden')}
        @click=${() => this.toggleAttribute('right-hidden')}
      >
        ⚙
      </button>
    `;
  }

  // ---- Layers -------------------------------------------------------------------------------

  private renderLayers(c: EditorController): TemplateResult {
    const page = c.currentPage;
    if (!page) return html`<p class="empty">No page.</p>`;
    const rows: TemplateResult[] = [];
    const visible: typeof this.visibleRows = [];
    const walk = (id: string, depth: number) => {
      for (const child of c.store.view.children(id)) {
        const hasChildren = c.store.view.children(child.id).length > 0;
        const open = this.expanded.has(child.id);
        visible.push({ id: child.id, parent: depth ? id : null, hasChildren, open });
        rows.push(this.renderLayerRow(c, child, depth, hasChildren, open));
        if (hasChildren && open) walk(child.id, depth + 1);
      }
    };
    walk(page.rootId, 0);
    this.visibleRows = visible;
    if (!rows.length)
      return html`<p class="empty">This page is empty. Add a section from the Insert tab.</p>`;
    if (!visible.some((r) => r.id === this.focusedRow))
      this.focusedRow = visible.find((r) => r.id === c.selected)?.id ?? visible[0]?.id ?? null;
    return html`<ul class="tree" role="tree" aria-label="Layers" @keydown=${this.onTreeKey}>${rows}</ul>`;
  }

  private layerLabel(c: EditorController, n: BNode): string {
    if (n.name) return n.name;
    if (n.section) return c.store.registry.section(n.section.name)?.title ?? n.section.name;
    const text =
      typeof n.props.text === 'string' && n.props.text ? `“${n.props.text.slice(0, 32)}”` : '';
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
        class=${classMap({
          row: true,
          selected: c.selected === n.id,
          hovered: c.hovered === n.id,
          'drop-before': drop === 'before',
          'drop-after': drop === 'after',
          'drop-inside': drop === 'inside',
        })}
        style=${`padding-left: ${8 + depth * 14}px`}
        draggable="true"
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
          @click=${(e: Event) => {
            e.stopPropagation();
            if (open) this.expanded.delete(n.id);
            else this.expanded.add(n.id);
            this.tick++;
          }}
        >
          ${hasChildren ? (open ? '▾' : '▸') : ''}
        </button>
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
    if (payload.kind === 'section')
      return n.parent && c.isRoot(n.parent) ? (y < 0.5 ? 'before' : 'after') : null;
    const type = payload.kind === 'node' ? payload.input.type : view.node(payload.id)?.type;
    if (!type) return null;
    const accepts = c.store.registry.accepts(n.type, type);
    if (accepts && y > 0.3 && y < 0.7) return 'inside';
    const parent = n.parent ? view.node(n.parent) : undefined;
    if (!parent || !c.store.registry.accepts(parent.type, type)) return accepts ? 'inside' : null;
    return y < 0.5 ? 'before' : 'after';
  }

  private onLayerDragOver(e: DragEvent, n: BNode): void {
    const payload = currentDrag(e, this.controller);
    if (!payload) return;
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
    const sections = c.store.registry.listSections();
    const target = c.selectedNode;
    return html`
      <div class="section">
        <h3>Sections</h3>
        <p class="muted">Click to add ${target ? 'after the selected section' : 'to the end of the page'}, or drag onto the page.</p>
      </div>
      <div class="cards">
        ${sections.map((s) => this.renderSectionCard(c, s))}
      </div>
      <div class="section"><h3>Elements</h3><p class="muted">Added inside the selected container.</p></div>
      <div class="elements">
        ${ELEMENTS.map(
          ([label, input]) => html`<button
            draggable="true"
            @click=${() => c.insertNode(structuredClone(input))}
            @dragstart=${(e: DragEvent) => startDrag(e, { kind: 'node', input: structuredClone(input) })}
            @dragend=${() => endDrag()}
          >
            ${label}
          </button>`,
        )}
      </div>
    `;
  }

  private renderSectionCard(c: EditorController, s: SectionDef): TemplateResult {
    const variants = Object.entries(s.variants ?? {});
    return html`<button
      class="card"
      draggable="true"
      @click=${() => c.insertSection(s.name)}
      @dragstart=${(e: DragEvent) => startDrag(e, { kind: 'section', name: s.name })}
      @dragend=${() => endDrag()}
    >
      <strong>${s.title}</strong>
      <span>${s.description}</span>
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
      if (e.actor.id !== c.actor.id && e.actor.kind !== 'system') others.set(e.actor.id, e.actor);
    return html`
      ${
        others.size
          ? html`<div class="section">
            <h3>Undo someone else's work</h3>
            ${[...others.values()].map(
              (a) => html`<button
                class="icon-btn"
                ?disabled=${!c.store.history.some((e) => e.actor.id === a.id && e.kind !== 'undo' && !e.undone)}
                @click=${() => c.undoBy(a.id)}
              >
                Undo last change by ${a.name ?? a.id}
              </button>`,
            )}
          </div>`
          : nothing
      }
      <ol class="history" aria-label="History">
        ${entries.map(
          (e) => html`<li class=${classMap({ entry: true, undone: !!e.undone })}>
            <span class=${`actor ${e.actor.kind}`}>${e.actor.name ?? e.actor.id}</span>
            <span class="what">${e.label ?? e.kind}</span>
            <time datetime=${new Date(e.time).toISOString()}>${timeAgo(e.time)}</time>
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
    return html`
      <div class="section">
        <div class="head">
          <strong>${this.layerLabel(c, node)}</strong>
          <span class=${node.section ? 'badge section' : 'badge'}>${node.section ? `section · ${node.section.name}` : node.type}</span>
        </div>
        <div class="head" style="margin-top: 6px">
          <code>${node.id}</code>
          ${owner ? html`<button class="link" @click=${() => c.select(owner.id)}>in ${owner.id}</button>` : nothing}
        </div>
      </div>
      ${section ? this.renderSectionSettings(c, node, section) : nothing}
      ${def ? this.renderProps(c, node, def) : nothing}
      ${this.renderStyles(c, node)}
      <div class="section row-inline">
        <button class="icon-btn" @click=${() => c.duplicateSelected()}>Duplicate</button>
        <button class="icon-btn" @click=${() => c.selectParent()}>Select parent</button>
        <button
          class="icon-btn danger"
          @click=${() => {
            if (c.removeSelected()?.ok) this.focusCanvas();
          }}
        >
          Delete
        </button>
      </div>
    `;
  }

  private renderPageSettings(c: EditorController): TemplateResult {
    const page = c.currentPage;
    if (!page) return html`<p class="empty">No page selected.</p>`;
    const update = (field: 'title' | 'path' | 'description') => (e: Event) =>
      c.apply(
        [{ op: 'page.update', id: page.id, [field]: (e.target as HTMLInputElement).value }],
        'Page settings',
      );
    return html`
      <div class="section">
        <h3>Page</h3>
        <div class="field"><label for="pt">Title</label><input id="pt" .value=${live(page.title)} @change=${update('title')} /></div>
        <div class="field"><label for="pp">Path</label><input id="pp" .value=${live(page.path)} @change=${update('path')} /></div>
        <div class="field">
          <label for="pd">Description</label>
          <textarea id="pd" .value=${live(page.description ?? '')} @change=${update('description')}></textarea>
        </div>
      </div>
      <p class="empty">Select an element on the page to edit it.</p>
    `;
  }

  private renderSectionSettings(
    c: EditorController,
    node: BNode,
    section: SectionDef,
  ): TemplateResult {
    const tokens = flattenTokens(c.doc.tokens).tokens.map((t) => t.cssVar);
    return html`<div class="section">
      <h3>Section</h3>
      ${Object.entries(section.variants ?? {}).map(
        ([axis, values]) => html`<div class="field">
          <label for=${`v-${axis}`}>${axis[0]!.toUpperCase() + axis.slice(1)}</label>
          <select id=${`v-${axis}`} @change=${(e: Event) => c.setVariant(node.id, { [axis]: (e.target as HTMLSelectElement).value })}>
            ${values.map((v) => html`<option value=${v} .selected=${live(node.section?.variant[axis] === v)}>${v}</option>`)}
          </select>
        </div>`,
      )}
      ${Object.entries(section.vars ?? {}).map(([name, spec]) => {
        const family = VAR_FAMILY[spec.type];
        const current = node.vars?.[name] ?? '';
        const options = family ? tokens.filter((t) => t.startsWith(family)) : [];
        const id = `var-${name}`;
        return html`<div class="field">
          <label for=${id}>${spec.description ?? name}</label>
          ${
            family
              ? html`<select id=${id} @change=${(e: Event) => c.setVars(node.id, { [name]: (e.target as HTMLSelectElement).value || null })}>
                <option value="" .selected=${live(!current)}>Default (${spec.default})</option>
                ${options.map((t) => html`<option value=${`var(${t})`} .selected=${live(current === `var(${t})`)}>${t.slice(2)}</option>`)}
              </select>`
              : html`<input id=${id} .value=${live(current)} placeholder=${spec.default}
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
    const fields = fieldsFor(def);
    if (!fields.length) return nothing;
    return html`<div class="section">
      <h3>Content</h3>
      ${fields.map((f) => this.renderField(c, node, f))}
    </div>`;
  }

  private renderField(c: EditorController, node: BNode, field: Field): TemplateResult {
    const id = `f-${field.key}`;
    const value = node.props[field.key];
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
      c.setProps(node.id, { [field.key]: value }, `Edit ${field.label.toLowerCase()}`);
    };
    let control: TemplateResult;
    if (field.kind === 'select') {
      control = html`<select id=${id} @change=${onChange}>
        ${field.required ? nothing : html`<option value="" .selected=${live(value === undefined)}>—</option>`}
        ${field.options!.map((o) => html`<option value=${o} .selected=${live(value === o)}>${o}</option>`)}
      </select>`;
    } else if (field.kind === 'json') {
      control = html`<textarea
        id=${id}
        class="code"
        spellcheck="false"
        .value=${live(value === undefined ? '' : JSON.stringify(value, null, 2))}
        @change=${onChange}
      ></textarea>`;
    } else if (field.kind === 'textarea') {
      control = html`<textarea id=${id} .value=${live(String(value ?? ''))} @change=${onChange}></textarea>`;
    } else if (field.kind === 'checkbox') {
      control = html`<input id=${id} type="checkbox" .checked=${live(!!value)} @change=${onChange} />`;
    } else if (field.kind === 'number') {
      control = html`<input id=${id} type="number" .value=${live(value === undefined ? '' : String(value))} @change=${onChange} />`;
    } else {
      const text = String(value ?? '');
      const embedded = field.kind === 'image' && text.startsWith('data:');
      control = html`<input
        id=${id}
        type=${field.kind === 'url' || field.kind === 'image' ? 'url' : 'text'}
        .value=${live(embedded ? '' : text)}
        placeholder=${embedded ? 'Embedded image (paste a URL to replace)' : field.kind === 'url' ? 'https:// or /path' : ''}
        @change=${onChange}
      />`;
    }
    return html`<div class="field"><label for=${id}>${field.label}${field.required ? ' *' : ''}</label>${control}</div>`;
  }

  private renderStyles(c: EditorController, node: BNode): TemplateResult {
    const bp = c.breakpoint;
    const state = this.styleState;
    const decls = node.styles?.[bp]?.[state] ?? {};
    const tokens = flattenTokens(c.doc.tokens).tokens.map((t) => `var(${t.cssVar})`);
    const bpLabel = c.doc.breakpoints.find((b) => b.id === bp)?.label ?? bp;
    return html`<div class="section">
      <h3>Style · ${bpLabel}</h3>
      <div class="field">
        <label for="state">State</label>
        <select
          id="state"
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
            aria-label=${`${prop} value`}
            list="bb-tokens"
            .value=${live(value)}
            @change=${(e: Event) => c.setStyle(node.id, `${prop}: ${(e.target as HTMLInputElement).value}`, { state })}
          />
          <button class="link danger" aria-label=${`Remove ${prop}`} @click=${() => c.setStyle(node.id, '', { state, remove: [prop] })}>✕</button>
        </div>`,
      )}
      ${Object.keys(decls).length ? nothing : html`<p class="muted">No styles for ${bpLabel}${state === 'default' ? '' : ` (${state})`} yet.</p>`}
      <div class="decl" style="margin-top: 8px">
        <input aria-label="CSS property" placeholder="property" list="bb-props" .value=${live(this.newProp)}
          @input=${(e: Event) => {
            this.newProp = (e.target as HTMLInputElement).value;
          }} />
        <input aria-label="Value" placeholder="var(--token)" list="bb-tokens" .value=${live(this.newValue)}
          @input=${(e: Event) => {
            this.newValue = (e.target as HTMLInputElement).value;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') this.addStyle(c, node.id, state);
          }} />
        <button class="icon-btn" @click=${() => this.addStyle(c, node.id, state)}>Add</button>
      </div>
      <datalist id="bb-props">${COMMON_PROPS.map((p) => html`<option value=${p}></option>`)}</datalist>
      <datalist id="bb-tokens">${tokens.map((t) => html`<option value=${t}></option>`)}</datalist>
    </div>`;
  }

  private addStyle(c: EditorController, id: string, state: string): void {
    const prop = this.newProp.trim();
    const value = this.newValue.trim();
    if (!prop || !value) return;
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
