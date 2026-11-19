import { css } from 'lit';

/**
 * Default chrome colours for the dark appearance. Light defaults are in `:host` below. The canvas
 * chrome (light DOM) reads the same `--_bb-*` defaults, which it inherits from the element.
 */
const DARK = css`
  --_bb-accent: #818cf8;
  --_bb-on-accent: #0f172a;
  --_bb-fg: #e5e7eb;
  --_bb-muted: #9ca3af;
  --_bb-bg: #111827;
  --_bb-panel: #0f172a;
  --_bb-border: #334155;
  --_bb-hover: #1e293b;
  --_bb-danger: #f87171;
  --_bb-linked: #c4b5fd;
  --_bb-warning: #fbbf24;
  --_bb-toast-bg: #f3f4f6;
  --_bb-toast-fg: #111827;
  --_bb-toast-hint: #4b5563;
  --_bb-canvas-bg: #020617;
  --_bb-scheme: dark;
`;

/**
 * Editor chrome. Themable through `--bb-editor-*` custom properties on the host (accent, on-accent,
 * fg, muted, bg, panel, border, hover, danger, linked, warning, font, left, right, canvas-bg,
 * color-scheme) and `::part()` (see the element). `appearance="dark"` switches the defaults to a
 * dark palette (`auto` follows the system); variables the host sets still win.
 * Panels the host turned off (`no-structure`, `no-inspector`) give their space to the canvas.
 * Below 900px of its own width the element is `narrow`: panels open over the canvas instead.
 */
export const editorStyles = css`
  :host {
    --_bb-accent: #4f46e5;
    --_bb-on-accent: #ffffff;
    --_bb-fg: #111827;
    --_bb-muted: #6b7280;
    --_bb-bg: #ffffff;
    --_bb-panel: #f9fafb;
    --_bb-border: #e5e7eb;
    --_bb-hover: #f3f4f6;
    --_bb-danger: #b91c1c;
    --_bb-linked: #7c3aed;
    --_bb-warning: #b45309;
    --_bb-toast-bg: #111827;
    --_bb-toast-fg: #ffffff;
    --_bb-toast-hint: #cbd5e1;
    --_bb-canvas-bg: #e9ebf0;
    --_bb-scheme: light;
  }
  :host([appearance='dark']) { ${DARK} }
  @media (prefers-color-scheme: dark) {
    :host([appearance='auto']) { ${DARK} }
  }
  :host {
    --accent: var(--bb-editor-accent, var(--_bb-accent));
    --on-accent: var(--bb-editor-on-accent, var(--_bb-on-accent));
    --fg: var(--bb-editor-fg, var(--_bb-fg));
    --muted: var(--bb-editor-muted, var(--_bb-muted));
    --bg: var(--bb-editor-bg, var(--_bb-bg));
    --panel: var(--bb-editor-panel, var(--_bb-panel));
    --border: var(--bb-editor-border, var(--_bb-border));
    --hover: var(--bb-editor-hover, var(--_bb-hover));
    --danger: var(--bb-editor-danger, var(--_bb-danger));
    --linked: var(--bb-editor-linked, var(--_bb-linked));
    --warning: var(--bb-editor-warning, var(--_bb-warning));
    --_left: var(--bb-editor-left, 264px);
    --_right: var(--bb-editor-right, 300px);
    color-scheme: var(--bb-editor-color-scheme, var(--_bb-scheme));
    display: grid;
    grid-template-columns: var(--_left) minmax(0, 1fr) var(--_right);
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 480px;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
    color: var(--fg);
    background: var(--bg);
    font: 13px/1.45 var(--bb-editor-font, ui-sans-serif, system-ui, sans-serif);
  }
  :host([left-hidden]), :host([no-structure]) { --_left: 0px; }
  :host([right-hidden]), :host([no-inspector]) { --_right: 0px; }
  * { box-sizing: border-box; }
  /* Inherited text styles from the host page (or rules on the element itself) stop here. */
  .toolbar, .panel, .toast {
    font: 13px/1.45 var(--bb-editor-font, ui-sans-serif, system-ui, sans-serif);
    text-transform: none; letter-spacing: normal; word-spacing: normal; text-align: start; text-indent: 0;
    text-shadow: none; white-space: normal; font-style: normal; font-variant: normal; font-weight: 400;
  }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .toolbar {
    grid-row: 1; grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-bottom: 1px solid var(--border); background: var(--bg); min-width: 0; overflow-x: auto;
  }
  .toolbar .spacer { flex: 1; }
  .group { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex: none; }
  .group button { border: 0; background: none; padding: 4px 10px; white-space: nowrap; }
  .group button + button { border-left: 1px solid var(--border); }
  .group button[aria-pressed='true'] { background: var(--accent); color: var(--on-accent); }
  .icon-btn { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 4px 9px; flex: none; }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .icon-btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  select.compact { border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; background: var(--bg); max-width: 180px; }

  .panel { background: var(--panel); min-height: 0; overflow: auto; }
  .left { grid-row: 2; grid-column: 1; border-right: 1px solid var(--border); }
  .right { grid-row: 2; grid-column: 3; border-left: 1px solid var(--border); }
  :host([left-hidden]) .left, :host([right-hidden]) .right { visibility: hidden; }
  .center { grid-row: 2; grid-column: 2; position: relative; min-width: 0; min-height: 0; }
  ::slotted([slot='canvas']) { position: absolute; inset: 0; }

  .tabs { display: flex; position: sticky; top: 0; z-index: 1; background: var(--panel); border-bottom: 1px solid var(--border); }
  .tabs button { flex: 1; border: 0; background: none; padding: 9px 4px; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; white-space: nowrap; }
  .tabs button[aria-selected='true'] { color: var(--fg); border-bottom-color: var(--accent); }

  .section { padding: 12px; border-bottom: 1px solid var(--border); }
  .section h3 { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .empty { padding: 16px 12px; color: var(--muted); }

  .tree { list-style: none; margin: 0; padding: 4px 0; }
  .row { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 6px; margin: 0 4px; cursor: pointer; user-select: none; }
  .row:hover, .row.hovered { background: var(--hover); }
  .row.selected { background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .row.drop-before { box-shadow: inset 0 2px 0 var(--accent); }
  .row.drop-after { box-shadow: inset 0 -2px 0 var(--accent); }
  .row.drop-inside { outline: 1px dashed var(--accent); }
  .caret { width: 16px; flex: none; border: 0; background: none; padding: 0; color: var(--muted); }
  .row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .kind { margin-left: auto; color: var(--muted); font-size: 11px; flex: none; }
  .badge { display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 11px; background: var(--hover); color: var(--muted); }
  .badge.section { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }

  .cards { display: grid; gap: 8px; padding: 12px; }
  .card { text-align: left; border: 1px solid var(--border); background: var(--bg); border-radius: 10px; padding: 10px; display: grid; gap: 4px; }
  .card:hover:not(:disabled) { border-color: var(--accent); }
  .card:disabled, .elements button:disabled { opacity: 0.5; cursor: default; }
  .card strong { font-size: 13px; }
  .card span { color: var(--muted); font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .elements { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; padding: 0 12px 12px; }
  .elements button { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 8px 4px; }

  .field { display: grid; gap: 4px; margin-bottom: 10px; }
  .field label, .field .label { font-size: 12px; font-weight: 600; }
  .field input:not([type='checkbox']), .field select, .field textarea {
    width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px; background: var(--bg);
  }
  .field textarea { resize: vertical; min-height: 64px; }
  .row-inline { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .icon-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .icon-btn.primary:disabled { opacity: .5; }
  .count { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px;
    background: #b45309; color: #fff; font-size: 10px; font-weight: 700; }
  .card.linked { border-color: color-mix(in srgb, var(--linked) 35%, var(--border)); }
  .linked-panel h3 { color: var(--linked); }
  .override { color: var(--linked); font-size: 10px; }
  .provenance { margin: 6px 0 0; font-size: 12px; }
  .peers { display: flex; gap: 2px; margin: 0 0 0 8px; padding: 0; list-style: none; }
  .peers li { display: grid; }
  .peers button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border-radius: 999px; cursor: pointer;
    background: var(--peer); color: #fff; font-size: 11px; font-weight: 700; border: 2px solid var(--bg); }
  .upload { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--accent); cursor: pointer; }
  .upload input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .upload:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  .changeset .ops { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 4px; }
  .changeset .ops label { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; }
  .changeset .ops span { overflow-wrap: anywhere; }
  .changeset .notes { margin: 0 0 8px; padding-left: 16px; color: var(--warning); font-size: 12px; }
  .changeset p.notes { padding-left: 0; }
  .badge.actor.agent { background: #fef3c7; color: #92400e; }
  .row-inline > * { min-width: 0; }
  .decl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; gap: 4px; align-items: center; margin-bottom: 4px; }
  .decl code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .decl input { width: 100%; border: 1px solid var(--border); border-radius: 6px; padding: 4px 6px; background: var(--bg); }
  .link { border: 0; background: none; color: var(--accent); padding: 0; text-decoration: underline; }
  .danger { color: var(--danger); }
  .muted { color: var(--muted); }
  .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .head code { font-size: 12px; background: var(--hover); padding: 1px 5px; border-radius: 4px; }

  .history { list-style: none; margin: 0; padding: 8px; display: grid; gap: 4px; }
  .entry { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: center; padding: 6px 8px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
  .entry.undone .what { text-decoration: line-through; color: var(--muted); }
  .actor { font-size: 11px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--hover); }
  .actor.agent { background: #ede9fe; color: #5b21b6; }
  .actor.system { background: #e0f2fe; color: #075985; }
  .entry time { color: var(--muted); font-size: 11px; }

  .toast {
    position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 5; max-width: min(560px, 90%);
    background: var(--_bb-toast-bg); color: var(--_bb-toast-fg); padding: 10px 14px; border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  }
  .toast p { margin: 0; }
  .toast .hint { color: var(--_bb-toast-hint); font-size: 12px; margin-top: 2px; }

  /* A narrow editor (its own width, set by the element): panels open over the canvas, one at a time. */
  :host([narrow]) { grid-template-columns: minmax(0, 1fr); }
  :host([narrow]) .toolbar { flex-wrap: wrap; overflow-x: visible; }
  :host([narrow]) .left, :host([narrow]) .right {
    grid-row: 2; grid-column: 1; width: min(300px, 85%); z-index: 3; box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
  }
  :host([narrow]) .left { justify-self: start; }
  :host([narrow]) .right { justify-self: end; }
  :host([narrow]) .center { grid-column: 1; grid-row: 2; }
  :host([narrow][left-hidden]) .left, :host([narrow][right-hidden]) .right { display: none; }
`;
