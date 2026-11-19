/**
 * Words the editor shows on the canvas: toolbar buttons, empty states, the field panel and the
 * label on the selected element. Hosts in another language pass their own through `ui.strings`
 * (any subset; the rest stay English). The side panels are not covered yet.
 */
export interface EditorStrings {
  /** Accessible name of the page canvas. */
  canvas: string;
  /** Accessible name of the selected element's toolbar, and the title of its field panel. */
  selected: string;
  drag: string;
  parent: string;
  moveUp: string;
  moveDown: string;
  duplicate: string;
  delete: string;
  /** Accessible name of a data list item's toolbar. */
  listItem: string;
  itemUp: string;
  itemDown: string;
  itemCopy: string;
  itemRemove: string;
  noPages: string;
  emptyPage: string;
  /** The empty page, when adding is allowed. */
  emptyPageInsert: string;
  /** Title of the form for a field that has no label. */
  edit: string;
  replacePhoto: string;
  linkPrompt: string;
  /** Undo label of a change typed on the page. */
  editText: string;
  uploadImage: string;
  /** Undo label of a field panel change, e.g. "Edit alt text". */
  editField: (label: string) => string;
  /** The label on the selected element. */
  selectionLabel: (node: SelectionInfo) => string;
  peerTyping: (name: string) => string;
  /** Text typed on the page wasn't saved because someone else changed it meanwhile. */
  editConflict: (what: string, typed: string) => string;
  editConflictHint: string;
  removedWhileEditing: (id: string, typed: string) => string;
  uploadFailed: (reason: string) => string;
  ghostBanner: (
    label: string,
    parts: { created: number; updated: number; removed: number },
  ) => string;
  symbolBanner: (name: string, instances: number) => string;
}

/** What the selection label can name. */
export interface SelectionInfo {
  id: string;
  type: string;
  /** The component's title (`ComponentDef.title`). */
  title?: string;
  /** The node's own name (`BNode.name`). */
  name?: string;
  /** Section template name, for a section root. */
  section?: string;
}

export const DEFAULT_STRINGS: EditorStrings = {
  canvas: 'Page canvas',
  selected: 'Selected element',
  drag: 'Drag to move',
  parent: 'Select parent',
  moveUp: 'Move up',
  moveDown: 'Move down',
  duplicate: 'Duplicate',
  delete: 'Delete',
  listItem: 'List item',
  itemUp: 'Move item up',
  itemDown: 'Move item down',
  itemCopy: 'Copy item',
  itemRemove: 'Remove item',
  noPages: 'This site has no pages yet.',
  emptyPage: 'This page is empty.',
  emptyPageInsert: 'This page is empty. Add a section from the Insert panel, or drag one here.',
  edit: 'Edit',
  replacePhoto: 'Replace photo…',
  linkPrompt: 'Link to (URL or /path):',
  editText: 'Edit text',
  uploadImage: 'Upload image',
  editField: (label) => `Edit ${label.toLowerCase()}`,
  selectionLabel: (n) => `${n.id} · ${n.section ?? n.type}`,
  peerTyping: (name) => `${name} is typing…`,
  editConflict: (what, typed) =>
    `Someone else changed ${what} while you were editing, so your text wasn't saved: “${typed.slice(0, 120)}”.`,
  editConflictHint: 'Edit it again to replace their version.',
  removedWhileEditing: (id, typed) =>
    `"${id}" was removed while you were editing it, so your text wasn't saved${typed ? `: “${typed.slice(0, 120)}”` : ''}.`,
  uploadFailed: (reason) => `Upload failed: ${reason}`,
  ghostBanner: (label, { created, updated, removed }) => {
    const parts = [
      created && `${created} new`,
      updated && `${updated} changed`,
      removed && `${removed} removed`,
    ].filter(Boolean);
    return `${label}${parts.length ? ` · ${parts.join(', ')}` : ''} · not applied yet`;
  },
  symbolBanner: (name, n) =>
    `Editing linked component “${name}”: changes apply to ${n} instance${n === 1 ? '' : 's'}`,
};

/** The host's strings over the defaults; anything that isn't the right type is ignored. */
export function resolveStrings(custom: Partial<EditorStrings> | undefined): EditorStrings {
  if (!custom) return DEFAULT_STRINGS;
  const out = { ...DEFAULT_STRINGS } as Record<string, unknown>;
  for (const [key, value] of Object.entries(custom)) {
    const fallback = (DEFAULT_STRINGS as unknown as Record<string, unknown>)[key];
    if (fallback !== undefined && typeof value === typeof fallback) out[key] = value;
  }
  return out as unknown as EditorStrings;
}
