/**
 * A small form on the canvas, next to what it edits: fields of site data that aren't edited in
 * place (a time shown as "14:00 Uhr", a link's address, a colour), or what isn't text on the
 * selected element (a photo, its alt text, a link). Each field commits on its own (Enter, leaving
 * the field, or picking a value), so every change is one undo step. Light DOM, so its classes are
 * prefixed and scoped like the rest of the canvas chrome.
 */

export interface PanelField {
  label: string;
  kind: 'text' | 'multiline' | 'time' | 'date' | 'url' | 'color' | 'select' | 'image';
  value: string;
  options?: [string, string][];
  /** Returns false when the value was refused (the field keeps what was typed). */
  commit: (value: string) => boolean;
  /** For `image`: where a picked file goes. Without it, the field takes a URL. */
  upload?: (file: File) => void;
}

/** A rectangle in stage coordinates. */
export interface Rect {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export const FIELD_PANEL_CSS = `
.bbx-host .bbx-fields { position: absolute; z-index: 3; display: grid; gap: 8px; width: 260px; padding: 10px; border-radius: 8px;
  pointer-events: auto; background: #fff; color: #111827; box-shadow: 0 8px 28px rgb(15 23 42 / .22), 0 0 0 1px rgb(15 23 42 / .08);
  font: 12px/1.4 system-ui, sans-serif; }
.bbx-host .bbx-fields[hidden] { display: none; }
.bbx-host .bbx-fields label { display: grid; gap: 3px; font-weight: 600; }
.bbx-host .bbx-fields :is(input, select, textarea) { all: revert; box-sizing: border-box; width: 100%; font: 13px/1.4 system-ui, sans-serif;
  padding: 5px 7px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; color: #111827; }
.bbx-host .bbx-fields input[type="color"] { padding: 2px; height: 30px; }
.bbx-host .bbx-fields textarea { min-height: 64px; resize: vertical; }
.bbx-host .bbx-fields :is(input, select, textarea):focus { outline: 2px solid var(--bb-editor-accent, #4f46e5); outline-offset: 0; }
.bbx-host .bbx-fields button { all: revert; justify-self: start; padding: 5px 10px; border-radius: 6px; border: 1px solid #d1d5db;
  background: #fff; color: #111827; font: 600 12px/1.4 system-ui, sans-serif; cursor: pointer; }
.bbx-host .bbx-fields .bbx-file { position: absolute; width: 1px; height: 1px; opacity: 0; }
`;

export class FieldPanel {
  readonly el: HTMLElement;
  /** What the panel is for (`data:schedule.0.time`, `node:hero-1/media`). */
  anchor: string | null = null;
  /** Opened on purpose (double-click): focus goes in, Escape returns it to the canvas. */
  modal = false;

  constructor(
    parent: HTMLElement,
    private readonly onClose: (refocus: boolean) => void,
  ) {
    const doc = parent.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'bbx-fields';
    this.el.setAttribute('role', 'group');
    this.el.hidden = true;
    parent.append(this.el);
    // Keys typed here are for the fields, not the editor's shortcuts (Delete, Ctrl+Z…).
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close(true);
      }
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  show(
    anchor: string,
    title: string,
    fields: PanelField[],
    options: { modal: boolean; at?: { rect: Rect; stageHeight: number } },
  ): void {
    const doc = this.el.ownerDocument;
    this.anchor = anchor;
    this.modal = options.modal;
    this.el.setAttribute('aria-label', title);
    this.el.replaceChildren();
    const ids = `bbx-f-${Math.random().toString(36).slice(2, 8)}`;
    fields.forEach((field, i) => {
      const id = `${ids}-${i}`;
      if (field.kind === 'image' && field.upload) {
        const label = doc.createElement('label');
        label.textContent = field.label;
        const button = doc.createElement('button');
        button.type = 'button';
        button.textContent = 'Replace photo…';
        const file = doc.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.className = 'bbx-file';
        button.addEventListener('click', () => file.click());
        file.addEventListener('change', () => {
          const picked = file.files?.[0];
          file.value = '';
          if (picked) field.upload?.(picked);
        });
        label.append(button, file);
        this.el.append(label);
        return;
      }
      const label = doc.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label;
      let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (field.kind === 'select') {
        const select = doc.createElement('select');
        for (const [value, text] of field.options ?? []) {
          const option = doc.createElement('option');
          option.value = value;
          option.textContent = text;
          select.append(option);
        }
        input = select;
      } else if (field.kind === 'multiline') {
        input = doc.createElement('textarea');
      } else {
        const el = doc.createElement('input');
        el.type = field.kind === 'image' ? 'url' : field.kind === 'text' ? 'text' : field.kind;
        input = el;
      }
      input.id = id;
      // Long inline values (embedded photos) aren't worth showing as text.
      input.value = field.kind === 'image' && field.value.startsWith('data:') ? '' : field.value;
      if (field.kind === 'image') (input as HTMLInputElement).placeholder = 'https://';
      let committed = input.value;
      const commit = () => {
        if (input.value === committed) return;
        if (field.commit(input.value)) committed = input.value;
        else input.setAttribute('aria-invalid', 'true');
      };
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        const key = e as KeyboardEvent;
        const submit =
          key.key === 'Enter' &&
          (field.kind !== 'multiline' || key.ctrlKey || key.metaKey) &&
          input.tagName !== 'SELECT';
        if (!submit) return;
        e.preventDefault();
        commit();
        if (this.modal) this.close(true);
      });
      this.el.append(label, input);
    });
    this.el.hidden = false;
    // Placed before anything is focused: some inputs (time, date) scroll themselves into view.
    if (options.at) this.place(options.at.rect, options.at.stageHeight);
    if (options.modal) {
      const first = this.el.querySelector<HTMLElement>('input, select, textarea, button');
      first?.focus({ preventScroll: true });
      if (first instanceof HTMLInputElement && first.type === 'text') first.select();
    }
  }

  close(refocus = false): void {
    if (!this.open) return;
    const had = this.el.contains(this.el.ownerDocument.activeElement);
    this.el.hidden = true;
    this.el.replaceChildren();
    this.anchor = null;
    this.modal = false;
    this.onClose(refocus || had);
  }

  /** Below the rectangle (stage coordinates), or above it when there's no room. */
  place(rect: Rect, stageHeight: number): void {
    const height = this.el.offsetHeight || 120;
    const below = rect.bottom + 8;
    const top =
      below + height > stageHeight && rect.top - height - 8 >= 0 ? rect.top - height - 8 : below;
    this.el.style.left = `${Math.max(0, rect.left)}px`;
    this.el.style.top = `${top}px`;
  }
}
