import { css, unsafeCSS } from 'lit';
import { TOKEN_CSS } from './theme.js';

/**
 * Editor chrome (the panels, in the element's shadow root). Every colour, size and corner comes
 * from the design tokens in `theme.ts` (`--bb-editor-*` on the host, resolved to `--bbe-*`), so a
 * host can restyle the editor without touching this file; `::part()` reaches single pieces.
 * Panels the host turned off (`no-structure`, `no-inspector`) give their space to the canvas.
 * Below 900px of its own width the element is `narrow`: panels open over the canvas instead.
 */
export const editorStyles = [
  unsafeCSS(TOKEN_CSS),
  css`
  :host {
    /* Steps of the spacing unit and the type and control scales. */
    --_s1: var(--bbe-space);
    --_s2: calc(var(--bbe-space) * 2);
    --_s3: calc(var(--bbe-space) * 3);
    --_s4: calc(var(--bbe-space) * 4);
    --_s6: calc(var(--bbe-space) * 6);
    --_fs-sm: calc(var(--bbe-font-size) - 1px);
    --_fs-xs: calc(var(--bbe-font-size) - 2px);
    --_h: var(--bbe-control-height);
    --_h-sm: calc(var(--bbe-control-height) - 6px);
    --_icon: calc(var(--bbe-font-size) + 3px);
    --_left: var(--bbe-left);
    --_right: var(--bbe-right);
    --_ring: 0 0 0 3px color-mix(in srgb, var(--bbe-focus) 28%, transparent);
    display: grid;
    grid-template-columns: var(--_left) minmax(0, 1fr) var(--_right);
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    min-height: 480px;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
    color: var(--bbe-fg);
    background: var(--bbe-bg);
  }
  :host([left-hidden]), :host([no-structure]) { --_left: 0px; }
  :host([right-hidden]), :host([no-inspector]) { --_right: 0px; }
  /* Type is set on the parts, not the host, so host page rules on the element don't reach it. */
  .toolbar, .panel, .toast {
    font-family: var(--bbe-font);
    font-size: var(--bbe-font-size);
    line-height: 1.45;
    letter-spacing: normal;
    -webkit-font-smoothing: antialiased;
    /* Other inherited text styles of the host page (uppercase, spacing, centring) stop here too. */
    font-style: normal; font-variant: normal; font-weight: 400; text-transform: none; word-spacing: normal;
    text-align: start; text-indent: 0; text-shadow: none; white-space: normal;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button, input, select, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--bbe-focus); outline-offset: 1px; }
  .bb-icon { width: var(--_icon); height: var(--_icon); flex: none; display: block; }
  code, .code { font-family: var(--bbe-font-mono); }

  /* ---- Controls ------------------------------------------------------------------------- */

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--_s2);
    height: var(--_h); padding: 0 var(--_s3); flex: none; white-space: nowrap;
    border: 1px solid var(--bbe-border-strong); border-radius: var(--bbe-radius);
    background: var(--bbe-surface); color: var(--bbe-fg); font-weight: 500;
    transition: background-color .12s, border-color .12s, color .12s, box-shadow .12s;
  }
  .btn:hover:not(:disabled) { box-shadow: inset 0 0 0 100vmax var(--bbe-hover); }
  .btn:disabled { opacity: .45; cursor: default; }
  .btn.icon { width: var(--_h); padding: 0; }
  .btn.sm { height: var(--_h-sm); padding: 0 var(--_s2); font-size: var(--_fs-sm); gap: var(--_s1); }
  .btn.sm.icon { width: var(--_h-sm); padding: 0; }
  .btn.ghost { border-color: transparent; background: transparent; color: var(--bbe-muted); }
  .btn.ghost:hover:not(:disabled) { box-shadow: none; background: var(--bbe-hover); color: var(--bbe-fg); }
  .btn[aria-pressed='true'] { background: var(--bbe-selected); border-color: transparent; color: var(--bbe-accent-text); }
  /* Panel toggles: shown panels are the normal state, so pressed only darkens the icon. */
  .btn.ghost[aria-pressed='true'] { background: transparent; color: var(--bbe-fg); }
  .btn.ghost[aria-pressed='false'] { color: var(--bbe-muted); }
  .btn.primary { background: var(--bbe-accent); border-color: var(--bbe-accent); color: var(--bbe-accent-fg); }
  .btn.primary:hover:not(:disabled) { box-shadow: inset 0 0 0 100vmax rgb(0 0 0 / .12); }
  .btn.danger { color: var(--bbe-danger); border-color: color-mix(in srgb, var(--bbe-danger) 40%, var(--bbe-border-strong)); }
  .btn.danger:hover:not(:disabled) {
    box-shadow: none; background: color-mix(in srgb, var(--bbe-danger) 10%, var(--bbe-surface));
    border-color: color-mix(in srgb, var(--bbe-danger) 45%, var(--bbe-border-strong));
  }
  .link { border: 0; background: none; padding: 0; color: var(--bbe-accent-text); text-decoration: underline;
    text-underline-offset: 2px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
  .link:hover { text-decoration-color: currentColor; }

  input:not([type='checkbox'], [type='radio'], [type='file'], [type='color']), select, textarea {
    width: 100%; min-width: 0; height: var(--_h); padding: 0 var(--_s2);
    border: 1px solid var(--bbe-border-strong); border-radius: var(--bbe-radius);
    background: var(--bbe-surface); color: var(--bbe-fg);
    transition: border-color .12s, box-shadow .12s;
  }
  /* Several lines never take a pill radius: at most the card radius. */
  textarea { height: auto; min-height: 64px; padding: var(--_s2); resize: vertical; line-height: 1.45; border-radius: min(var(--bbe-radius), var(--bbe-radius-lg)); }
  textarea.code { font-size: var(--_fs-sm); }
  :is(input, select, textarea):hover:not(:disabled, :focus) { border-color: color-mix(in srgb, var(--bbe-fg) 30%, var(--bbe-border-strong)); }
  :is(input, select, textarea):focus-visible { outline: none; border-color: var(--bbe-focus); box-shadow: var(--_ring); }
  :is(input, textarea)::placeholder { color: var(--bbe-muted); opacity: .85; }
  input[type='checkbox'] { accent-color: var(--bbe-accent); width: 15px; height: 15px; margin: 0; }
  input:disabled { opacity: .6; }

  /* ---- Top bar -------------------------------------------------------------------------- */

  .toolbar {
    grid-row: 1; grid-column: 1 / -1; display: flex; align-items: center; gap: var(--_s2);
    padding: var(--_s2) var(--_s3); min-width: 0; overflow-x: auto; scrollbar-width: none;
    border-bottom: 1px solid var(--bbe-border); background: var(--bbe-bg); color: var(--bbe-fg);
  }
  .zone { display: flex; align-items: center; gap: var(--_s1); min-width: max-content; }
  .zone.start, .zone.end { flex: 1 1 0; }
  .zone.end { justify-content: flex-end; }
  .zone.middle { gap: var(--_s2); }
  .sep { width: 1px; height: calc(var(--_h) - 10px); margin: 0 var(--_s1); background: var(--bbe-border); flex: none; }
  .page-title { padding: 0 var(--_s2); font-weight: 600; white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
  .toolbar select { width: auto; max-width: 200px; }
  .segmented { display: inline-flex; gap: 2px; padding: 2px; flex: none; border-radius: calc(var(--bbe-radius) + 2px); background: var(--bbe-hover); }
  .segmented button {
    display: inline-flex; align-items: center; gap: var(--_s2); height: calc(var(--_h) - 4px); padding: 0 var(--_s3);
    border: 0; border-radius: var(--bbe-radius); background: transparent; color: var(--bbe-muted); font-weight: 500; white-space: nowrap;
  }
  .segmented button:hover { color: var(--bbe-fg); }
  .segmented button[aria-pressed='true'] { background: var(--bbe-surface); color: var(--bbe-fg); box-shadow: 0 1px 2px rgb(0 0 0 / .12), 0 0 0 1px var(--bbe-border); }
  .peers { display: flex; margin: 0 0 0 var(--_s2); padding: 0; list-style: none; }
  .peers li { display: grid; margin-left: -4px; }
  .peers button { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 999px; cursor: pointer;
    background: var(--peer); color: #fff; font-size: var(--_fs-xs); font-weight: 700; box-shadow: 0 0 0 2px var(--bbe-bg); }

  /* ---- Layout ----------------------------------------------------------------------------- */

  .panel {
    min-height: 0; overflow: auto; background: var(--bbe-panel); color: var(--bbe-fg);
    scrollbar-width: thin; scrollbar-color: var(--bbe-border-strong) transparent;
  }
  .left { grid-row: 2; grid-column: 1; border-right: 1px solid var(--bbe-border); }
  .right { grid-row: 2; grid-column: 3; border-left: 1px solid var(--bbe-border); }
  :host([left-hidden]) .left, :host([right-hidden]) .right { visibility: hidden; }
  .center { grid-row: 2; grid-column: 2; position: relative; min-width: 0; min-height: 0; }
  ::slotted([slot='canvas']) { position: absolute; inset: 0; }

  .tabs {
    display: flex; gap: var(--_s1); padding: var(--_s2) var(--_s2) 0; position: sticky; top: 0; z-index: 1;
    background: var(--bbe-panel); border-bottom: 1px solid var(--bbe-border);
  }
  .tabs button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: var(--_s1);
    height: var(--_h); margin-bottom: -1px; padding: 0 var(--_s1); border: 0; border-bottom: 2px solid transparent;
    border-radius: min(var(--bbe-radius), 8px) min(var(--bbe-radius), 8px) 0 0; background: none; color: var(--bbe-muted); font-weight: 600;
    white-space: nowrap;
  }
  .tabs button:hover { color: var(--bbe-fg); background: var(--bbe-hover); }
  .tabs button[aria-selected='true'] { color: var(--bbe-fg); border-bottom-color: var(--bbe-accent); background: none; }
  .count { display: inline-grid; place-items: center; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px;
    background: var(--bbe-warning); color: var(--bbe-bg); font-size: var(--_fs-xs); font-weight: 700; line-height: 1; }

  .section { padding: var(--_s4); border-bottom: 1px solid var(--bbe-border); }
  .section h3 { display: flex; align-items: center; gap: var(--_s2); margin: 0 0 var(--_s3); font-size: var(--_fs-sm); font-weight: 600; color: var(--bbe-fg); }
  .section h3 .bb-icon { color: var(--bbe-muted); }
  .section.intro { border-bottom: 0; padding-bottom: var(--_s3); }
  .section.intro h3 { margin-bottom: var(--_s1); }
  .section > p { margin: 0 0 var(--_s3); }
  .section > p:last-child { margin-bottom: 0; }
  .empty { margin: 0; padding: var(--_s6) var(--_s4); color: var(--bbe-muted); text-align: center; }
  .muted { color: var(--bbe-muted); }
  .hint { font-size: var(--_fs-sm); }
  .danger { color: var(--bbe-danger); }
  .row-inline { display: flex; gap: var(--_s2); align-items: center; flex-wrap: wrap; }
  .row-inline > * { min-width: 0; }

  /* ---- Layers --------------------------------------------------------------------------- */

  .tree { list-style: none; margin: 0; padding: var(--_s2); }
  .tree li { outline: none; }
  .tree li:focus-visible > .row { box-shadow: inset 0 0 0 2px var(--bbe-focus); }
  .row {
    display: flex; align-items: center; gap: var(--_s1); height: calc(var(--_h) - 2px); padding-right: var(--_s2);
    border-radius: var(--bbe-radius); cursor: pointer; user-select: none; color: var(--bbe-fg);
  }
  .row:hover, .row.hovered { background: var(--bbe-hover); }
  .row.selected { background: var(--bbe-selected); }
  .row.drop-before { box-shadow: inset 0 2px 0 var(--bbe-selection); }
  .row.drop-after { box-shadow: inset 0 -2px 0 var(--bbe-selection); }
  .row.drop-inside { box-shadow: inset 0 0 0 1.5px var(--bbe-selection); }
  .caret { display: grid; place-items: center; width: 16px; height: 16px; flex: none; padding: 0; border: 0; border-radius: 4px; background: none; color: var(--bbe-muted); }
  .caret:hover { color: var(--bbe-fg); background: var(--bbe-hover); }
  .caret .bb-icon { width: 12px; height: 12px; }
  .row .type { color: var(--bbe-muted); display: grid; }
  .row.selected .type { color: var(--bbe-accent-text); }
  .row.is-linked .type, .row.is-linked .name { color: var(--bbe-linked); }
  .row.is-section .name { font-weight: 500; }
  .row .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The kind gives way first, so names stay readable. */
  .row .kind { margin-left: auto; padding-left: var(--_s2); flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; color: var(--bbe-muted); font-size: var(--_fs-xs); opacity: 0; }
  .row:hover .kind, .row.selected .kind { opacity: 1; }

  /* ---- Insert --------------------------------------------------------------------------- */

  .cards { display: grid; gap: var(--_s2); padding: 0 var(--_s3) var(--_s4); }
  .card {
    position: relative; display: grid; gap: var(--_s1); padding: var(--_s3); text-align: left;
    border: 1px solid var(--bbe-border); border-radius: var(--bbe-radius-lg); box-shadow: var(--bbe-shadow-card);
    background: var(--bbe-surface); color: var(--bbe-fg); transition: border-color .12s, box-shadow .12s;
  }
  .card:hover:not(:disabled) { border-color: var(--bbe-accent); box-shadow: var(--bbe-shadow-card), 0 0 0 3px color-mix(in srgb, var(--bbe-accent) 12%, transparent); }
  .card:disabled, .elements button:disabled { opacity: .5; cursor: default; }
  .card strong { font-weight: 600; padding-right: calc(var(--_icon) + var(--_s2)); }
  .card .desc { color: var(--bbe-muted); font-size: var(--_fs-sm); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .card .add { position: absolute; top: var(--_s3); right: var(--_s3); color: var(--bbe-accent-text); opacity: 0; transition: opacity .12s; }
  .card:hover .add, .card:focus-visible .add { opacity: 1; }
  .card.linked strong { color: var(--bbe-linked); }
  .card.linked:hover { border-color: var(--bbe-linked); box-shadow: var(--bbe-shadow-card), 0 0 0 3px color-mix(in srgb, var(--bbe-linked) 14%, transparent); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--_s1); margin-top: var(--_s1); }
  .card.has-thumb { padding: 0 0 var(--_s3); overflow: hidden; }
  .card.has-thumb > :not(.thumb, .add) { margin-inline: var(--_s3); }
  .card.has-thumb > strong { margin-top: var(--_s2); }
  .card.has-thumb .add { top: auto; bottom: var(--_s3); }
  .thumb {
    position: relative; display: block; height: 96px; overflow: hidden; pointer-events: none;
    border-bottom: 1px solid var(--bbe-border); background: var(--bbe-canvas-bg); color-scheme: normal;
  }
  .thumb[data-cropped]::after {
    content: ""; position: absolute; inset: auto 0 0; height: 28px;
    background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bbe-surface) 85%, transparent));
  }
  .thumb-page { position: absolute; top: 0; left: 0; display: block; transform-origin: 0 0; }
  .group {
    margin: var(--_s2) var(--_s4) var(--_s2); font-size: var(--_fs-xs); font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--bbe-muted);
  }
  .search { position: relative; margin: var(--_s3) var(--_s3) 0; }
  .search .bb-icon { position: absolute; top: 50%; left: var(--_s2); transform: translateY(-50%); color: var(--bbe-muted); pointer-events: none; }
  .search input { width: 100%; padding-left: calc(var(--_s2) * 2 + var(--_icon)); }
  .badge {
    display: inline-flex; align-items: center; gap: 4px; height: 18px; padding: 0 7px; border-radius: 999px; white-space: nowrap;
    background: var(--bbe-hover); color: var(--bbe-muted); font-size: var(--_fs-xs); font-weight: 500; line-height: 1;
  }
  .badge.section { background: var(--bbe-selected); color: var(--bbe-accent-text); }
  .badge.linked { background: color-mix(in srgb, var(--bbe-linked) 14%, transparent); color: var(--bbe-linked); }
  .badge.agent { background: color-mix(in srgb, var(--bbe-agent) 14%, transparent); color: var(--bbe-agent); }
  .elements { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: var(--_s2); padding: 0 var(--_s3) var(--_s4); }
  .elements button {
    display: grid; justify-items: center; gap: var(--_s2); padding: var(--_s3) var(--_s1);
    border: 1px solid var(--bbe-border); border-radius: var(--bbe-radius-lg); box-shadow: var(--bbe-shadow-card);
    background: var(--bbe-surface); color: var(--bbe-fg); font-size: var(--_fs-sm); font-weight: 500;
    transition: border-color .12s, box-shadow .12s;
  }
  .elements .bb-icon { width: calc(var(--_icon) + 4px); height: calc(var(--_icon) + 4px); color: var(--bbe-muted); }
  .elements button:hover:not(:disabled) { border-color: var(--bbe-accent); box-shadow: var(--bbe-shadow-card), 0 0 0 3px color-mix(in srgb, var(--bbe-accent) 12%, transparent); }
  .elements button:hover .bb-icon { color: var(--bbe-accent-text); }

  /* ---- Inspector ------------------------------------------------------------------------ */

  .node-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--_s1) var(--_s3); align-items: center; }
  .node-icon {
    grid-row: span 2; display: grid; place-items: center; width: calc(var(--_h) + 4px); height: calc(var(--_h) + 4px);
    border-radius: var(--bbe-radius); background: var(--bbe-selected); color: var(--bbe-accent-text);
  }
  .node-icon.linked { background: color-mix(in srgb, var(--bbe-linked) 14%, transparent); color: var(--bbe-linked); }
  .node-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-meta { display: flex; align-items: center; gap: var(--_s2); min-width: 0; font-size: var(--_fs-sm); color: var(--bbe-muted); }
  .node-meta code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--_fs-xs); }
  .provenance { margin: var(--_s3) 0 0; font-size: var(--_fs-sm); }

  .field { display: grid; gap: 5px; margin-bottom: var(--_s3); }
  .field:last-child { margin-bottom: 0; }
  .field > label, .field .label { font-size: var(--_fs-sm); font-weight: 500; color: var(--bbe-muted); }
  .field.check { grid-template-columns: auto 1fr; align-items: center; gap: var(--_s2); }
  .field.check input { order: -1; }
  .field.check > label { color: var(--bbe-fg); }
  .reuse { flex-wrap: nowrap; }
  .reuse input { flex: 1; }
  .override { color: var(--bbe-linked); font-size: 10px; }
  .upload { display: inline-flex; align-items: center; gap: var(--_s1); margin-top: 2px; font-size: var(--_fs-sm); font-weight: 500; color: var(--bbe-accent-text); cursor: pointer; justify-self: start; }
  .upload input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .upload:focus-within { outline: 2px solid var(--bbe-focus); outline-offset: 2px; border-radius: 4px; }
  .linked-panel h3, .linked-panel h3 .bb-icon { color: var(--bbe-linked); }
  .icon-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--_h) + 2px), 1fr)); gap: 2px;
    max-height: calc((var(--_h) + 4px) * 5 + var(--_s2)); overflow-y: auto; padding: var(--_s1);
    border: 1px solid var(--bbe-border-strong); border-radius: var(--bbe-radius); background: var(--bbe-surface);
    scrollbar-width: thin; scrollbar-color: var(--bbe-border-strong) transparent;
  }
  .icon-option {
    display: grid; place-items: center; aspect-ratio: 1; padding: 0; border: 0; border-radius: min(var(--bbe-radius), 6px);
    background: none; color: var(--bbe-fg); font-size: calc(var(--_icon) + 2px);
  }
  .icon-option:hover { background: var(--bbe-hover); }
  .icon-option[aria-pressed='true'] { background: var(--bbe-selected); color: var(--bbe-accent-text); box-shadow: inset 0 0 0 1.5px var(--bbe-accent); }
  .icon-option svg { display: block; }

  .decl { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto; gap: var(--_s1); align-items: center; margin-bottom: var(--_s1); }
  .decl code { font-size: var(--_fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bbe-muted); }
  .decl input { height: var(--_h-sm); font-size: var(--_fs-sm); }
  .decl.add { margin-top: var(--_s3); }
  .decl.add input { height: var(--_h); font-size: inherit; }
  .actions { display: flex; flex-wrap: wrap; gap: var(--_s2); }

  .changeset .head { display: flex; align-items: center; gap: var(--_s2); flex-wrap: wrap; }
  .changeset .ops { list-style: none; margin: var(--_s3) 0; padding: 0; display: grid; gap: var(--_s1); }
  .changeset .ops label { display: flex; gap: var(--_s2); align-items: flex-start; font-size: var(--_fs-sm); }
  .changeset .ops input { margin-top: 2px; }
  .changeset .ops span { overflow-wrap: anywhere; }
  .changeset .notes { margin: 0 0 var(--_s3); padding-left: var(--_s4); color: var(--bbe-warning); font-size: var(--_fs-sm); }
  .changeset p.notes { padding-left: 0; }

  /* ---- History -------------------------------------------------------------------------- */

  .undo-others { display: grid; gap: var(--_s2); justify-items: start; }
  .history { list-style: none; margin: 0; padding: var(--_s2); display: grid; gap: 2px; }
  .entry { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--_s3); align-items: center; padding: var(--_s2); border-radius: min(var(--bbe-radius), var(--bbe-radius-lg)); }
  .entry:hover { background: var(--bbe-hover); }
  .avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 999px; font-size: var(--_fs-xs); font-weight: 700;
    background: color-mix(in srgb, var(--bbe-fg) 10%, transparent); color: var(--bbe-fg); }
  .avatar.agent { background: color-mix(in srgb, var(--bbe-agent) 16%, transparent); color: var(--bbe-agent); }
  .avatar.system { background: var(--bbe-hover); color: var(--bbe-muted); }
  .entry .what { display: grid; min-width: 0; }
  .entry .who { font-size: var(--_fs-xs); color: var(--bbe-muted); }
  .entry .who.agent { color: var(--bbe-agent); }
  .entry .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry.undone .label { text-decoration: line-through; color: var(--bbe-muted); }
  .entry time { color: var(--bbe-muted); font-size: var(--_fs-xs); white-space: nowrap; }

  /* ---- Messages ------------------------------------------------------------------------- */

  .toast {
    position: absolute; left: 50%; bottom: var(--_s4); transform: translateX(-50%); z-index: 5; max-width: min(560px, 90%);
    display: flex; gap: var(--_s3); align-items: flex-start; padding: var(--_s3) var(--_s4);
    border-radius: var(--bbe-radius-lg); background: var(--bbe-floating-bg); color: var(--bbe-floating-fg); box-shadow: var(--bbe-shadow);
  }
  .toast .bb-icon { color: color-mix(in srgb, var(--bbe-danger) 70%, var(--bbe-floating-fg)); margin-top: 1px; }
  .toast p { margin: 0; }
  .toast .hint { opacity: .75; margin-top: 2px; }

  /* A narrow editor (its own width, set by the element): panels open over the canvas, one at a time. */
  :host([narrow]) { grid-template-columns: minmax(0, 1fr); }
  :host([narrow]) .toolbar { flex-wrap: wrap; overflow-x: visible; }
  :host([narrow]) .zone { min-width: 0; flex-wrap: wrap; }
  :host([narrow]) .left, :host([narrow]) .right {
    grid-row: 2; grid-column: 1; width: min(300px, 85%); z-index: 3; box-shadow: var(--bbe-shadow);
  }
  :host([narrow]) .left { justify-self: start; }
  :host([narrow]) .right { justify-self: end; }
  :host([narrow]) .center { grid-column: 1; grid-row: 2; }
  :host([narrow]) .segmented .label { display: none; }
  :host([narrow][left-hidden]) .left, :host([narrow][right-hidden]) .right { display: none; }
`,
];
