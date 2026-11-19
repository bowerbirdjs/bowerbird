import { ancestors, type NodeInput } from '@bowerbirdjs/core';
import type { EditorController, Position } from './controller.js';

/** What is being dragged. Kept in memory because `dataTransfer` is unreadable during `dragover`. */
export type DragPayload =
  | { kind: 'section'; name: string; variant?: Record<string, string> }
  | { kind: 'node'; input: NodeInput }
  /** Moves only make sense within the editor (and document) they started in. */
  | { kind: 'move'; id: string; source?: EditorController };

let active: DragPayload | null = null;

export const DRAG_MIME = 'application/x-bowerbird';

export function startDrag(event: DragEvent, payload: DragPayload): void {
  active = payload;
  const { source: _, ...data } = payload as DragPayload & { source?: unknown };
  event.dataTransfer?.setData(DRAG_MIME, JSON.stringify(data));
  event.dataTransfer?.setData('text/plain', payload.kind === 'move' ? payload.id : payload.kind);
  if (event.dataTransfer)
    event.dataTransfer.effectAllowed = payload.kind === 'move' ? 'move' : 'copy';
}

export function endDrag(): void {
  active = null;
}

/**
 * The payload being dragged, if this drag started in a Bowerbird editor. With an event, drags
 * that don't carry the Bowerbird type (files, text, a cancelled earlier drag) are ignored; with a
 * controller, moves from another editor are ignored.
 */
export function currentDrag(event?: DragEvent, controller?: EditorController): DragPayload | null {
  if (!active) return null;
  if (event?.dataTransfer && !event.dataTransfer.types.includes(DRAG_MIME)) return null;
  if (controller && active.kind === 'move' && active.source && active.source !== controller)
    return null;
  return active;
}

export interface DropTarget extends Position {
  /** Where to draw the indicator, in viewport coordinates. */
  indicator: { kind: 'line' | 'box'; rect: DOMRect; orientation: 'horizontal' | 'vertical' };
}

const EDGE = 10;

function isHorizontal(parentEl: Element | null): boolean {
  if (!parentEl) return false;
  const style = getComputedStyle(parentEl);
  if (style.display.includes('flex')) return style.flexDirection.startsWith('row');
  if (style.display.includes('grid'))
    return style.gridTemplateColumns.trim().split(/\s+/).length > 1;
  return false;
}

function lineRect(rect: DOMRect, side: 'before' | 'after', horizontal: boolean): DOMRect {
  if (horizontal)
    return new DOMRect(
      side === 'before' ? rect.left - 1 : rect.right - 1,
      rect.top,
      2,
      rect.height,
    );
  return new DOMRect(rect.left, side === 'before' ? rect.top - 1 : rect.bottom - 1, rect.width, 2);
}

/**
 * Where a drop at (x, y) over `el` would go, or null if nowhere valid. Sections go between the
 * page's top-level sections; nodes go inside a container (away from its edges) or before/after
 * the hovered node, following the parent's layout direction.
 */
export function dropTarget(
  controller: EditorController,
  payload: DragPayload,
  el: Element | null,
  x: number,
  y: number,
  content: Element,
): DropTarget | null {
  const page = controller.currentPage;
  if (!page) return null;
  const view = controller.store.view;
  const registry = controller.store.registry;
  const nodeEl = el?.closest('[data-bb-node]') ?? null;
  const id = nodeEl?.getAttribute('data-bb-node') ?? null;
  const elementOf = (nid: string) => content.querySelector(`[data-bb-node="${CSS.escape(nid)}"]`);

  // Whole sections (new, or moved by their handle) go between the page's top-level sections.
  const moving = payload.kind === 'move' ? view.node(payload.id) : undefined;
  const sectionLike = payload.kind === 'section' || !!moving?.section;
  // A symbol definition has no page to add sections to.
  if (sectionLike && controller.symbolView) return null;
  if (sectionLike) {
    let top = id ? view.node(id) : undefined;
    while (top?.parent && top.parent !== page.rootId) top = view.node(top.parent);
    if (moving && top?.id === moving.id) return null;
    const topEl = top && top.parent === page.rootId ? elementOf(top.id) : null;
    if (top && topEl) {
      const rect = topEl.getBoundingClientRect();
      const side = y < rect.top + rect.height / 2 ? 'before' : 'after';
      return {
        parent: page.rootId,
        [side]: top.id,
        indicator: { kind: 'line', rect: lineRect(rect, side, false), orientation: 'vertical' },
      };
    }
    const rootEl = elementOf(page.rootId);
    const rect = rootEl?.getBoundingClientRect() ?? content.getBoundingClientRect();
    return {
      parent: page.rootId,
      indicator: { kind: 'line', rect: lineRect(rect, 'after', false), orientation: 'vertical' },
    };
  }

  const type = payload.kind === 'node' ? payload.input.type : view.node(payload.id)?.type;
  if (!type || !id || !nodeEl) return null;
  const node = view.node(id);
  if (!node) return null;
  if (payload.kind === 'move') {
    if (id === payload.id || ancestors(view, id).some((a) => a.id === payload.id)) return null;
  }
  const rect = nodeEl.getBoundingClientRect();
  const nearEdge =
    y - rect.top < EDGE || rect.bottom - y < EDGE || x - rect.left < EDGE || rect.right - x < EDGE;
  // Linked component instances take no new children (they follow their definition).
  const inside = registry.accepts(node.type, type) && controller.canInsertInto(node.id);
  if (node.parent === null || (inside && !nearEdge)) {
    if (!inside) return null;
    return { parent: node.id, indicator: { kind: 'box', rect, orientation: 'vertical' } };
  }
  // Before or after the hovered node, or the nearest ancestor whose parent takes this type (a
  // section dragged over something inside another section goes next to that section).
  let anchor = node;
  let parent = view.node(node.parent);
  while (parent && !(registry.accepts(parent.type, type) && controller.canInsertInto(parent.id))) {
    anchor = parent;
    parent = parent.parent ? view.node(parent.parent) : undefined;
  }
  if (!parent || (payload.kind === 'move' && anchor.id === payload.id)) return null;
  const anchorEl = anchor === node ? nodeEl : elementOf(anchor.id);
  if (!anchorEl) return null;
  const anchorRect = anchor === node ? rect : anchorEl.getBoundingClientRect();
  const horizontal = isHorizontal(anchorEl.parentElement);
  const side = (
    horizontal
      ? x < anchorRect.left + anchorRect.width / 2
      : y < anchorRect.top + anchorRect.height / 2
  )
    ? 'before'
    : 'after';
  return {
    parent: parent.id,
    [side]: anchor.id,
    indicator: {
      kind: 'line',
      rect: lineRect(anchorRect, side, horizontal),
      orientation: horizontal ? 'horizontal' : 'vertical',
    },
  };
}

/** Applies a drop as one transaction. */
export function performDrop(controller: EditorController, payload: DragPayload, target: Position) {
  const position: Position = {
    ...(target.parent ? { parent: target.parent } : {}),
    ...(target.before ? { before: target.before } : {}),
    ...(target.after ? { after: target.after } : {}),
  };
  if (payload.kind === 'section')
    return controller.insertSection(payload.name, position, payload.variant);
  if (payload.kind === 'node')
    return controller.insertNode(payload.input, position as Position & { parent: string });
  const result = controller.move(payload.id, position);
  if (result?.ok) controller.select(payload.id);
  return result;
}
