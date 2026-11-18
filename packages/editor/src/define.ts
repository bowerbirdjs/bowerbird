import { BowerbirdEditor } from './element.js';

/** Registers `<bowerbird-editor>` (safe to call more than once). */
export function defineBowerbirdEditor(tag = 'bowerbird-editor'): void {
  if (!customElements.get(tag)) customElements.define(tag, class extends BowerbirdEditor {});
}

defineBowerbirdEditor();
