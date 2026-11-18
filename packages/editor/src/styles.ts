import { css } from 'lit';

/** Editor chrome. Themable through `--bb-editor-*` custom properties on the host. */
export const editorStyles = css`
  :host {
    --accent: var(--bb-editor-accent, #4f46e5);
    --fg: var(--bb-editor-fg, #111827);
    --muted: var(--bb-editor-muted, #6b7280);
    --bg: var(--bb-editor-bg, #ffffff);
    --panel: var(--bb-editor-panel, #f9fafb);
    --border: var(--bb-editor-border, #e5e7eb);
    --hover: var(--bb-editor-hover, #f3f4f6);
    --danger: var(--bb-editor-danger, #b91c1c);
    display: grid;
    grid-template-columns: var(--bb-editor-left, 264px) minmax(0, 1fr) var(--bb-editor-right, 300px);
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
  :host([left-hidden]) { grid-template-columns: 0 minmax(0, 1fr) var(--bb-editor-right, 300px); }
  :host([right-hidden]) { grid-template-columns: var(--bb-editor-left, 264px) minmax(0, 1fr) 0; }
  :host([left-hidden][right-hidden]) { grid-template-columns: 0 minmax(0, 1fr) 0; }
  * { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .toolbar {
    grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border-bottom: 1px solid var(--border); background: var(--bg); min-width: 0; overflow-x: auto;
  }
  .toolbar .spacer { flex: 1; }
  .group { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex: none; }
  .group button { border: 0; background: none; padding: 4px 10px; white-space: nowrap; }
  .group button + button { border-left: 1px solid var(--border); }
  .group button[aria-pressed='true'] { background: var(--accent); color: #fff; }
  .icon-btn { border: 1px solid var(--border); background: var(--bg); border-radius: 8px; padding: 4px 9px; flex: none; }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .icon-btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  select.compact { border: 1px solid var(--border); border-radius: 8px; padding: 4px 6px; background: var(--bg); max-width: 180px; }

  .panel { background: var(--panel); min-height: 0; overflow: auto; }
  .left { border-right: 1px solid var(--border); }
  .right { border-left: 1px solid var(--border); }
  :host([left-hidden]) .left, :host([right-hidden]) .right { visibility: hidden; }
  .center { position: relative; min-width: 0; min-height: 0; }
  ::slotted([slot='canvas']) { position: absolute; inset: 0; }

  .tabs { display: flex; position: sticky; top: 0; z-index: 1; background: var(--panel); border-bottom: 1px solid var(--border); }
  .tabs button { flex: 1; border: 0; background: none; padding: 9px 4px; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; }
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
  .card:hover { border-color: var(--accent); }
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
  .row-inline { display: flex; gap: 6px; align-items: center; }
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
    background: #111827; color: #fff; padding: 10px 14px; border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  }
  .toast p { margin: 0; }
  .toast .hint { color: #cbd5e1; font-size: 12px; margin-top: 2px; }

  @media (max-width: 760px) {
    :host { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .left, .right { position: absolute; top: 45px; bottom: 0; width: min(300px, 85%); z-index: 3; box-shadow: 0 8px 24px rgb(0 0 0 / 0.15); }
    .left { left: 0; }
    .right { right: 0; }
    .center { grid-column: 1; grid-row: 2; }
  }
`;
