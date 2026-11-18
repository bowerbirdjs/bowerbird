# Bowerbird

**An open-source visual page editor that people and AI agents edit together.**

Bowerbird is a page engine you embed in your own product. Pages are built from large, prebuilt sections (hero, pricing, footer …) that stay fully editable inside. People edit on a visual canvas; AI agents edit through a typed API and MCP. Both go through the same validated, attributed and undoable operations. Styles use CSS custom properties and design tokens, so the output is plain HTML and CSS and stays on-brand.

> **Status: early (Phase 3 of the plan done).** The engine, starter sections, HTML/CSS renderer, agent tools, MCP server and the visual editor (`<bowerbird-editor>`, with React and Vue wrappers) work, with linked components, reviewable agent proposals, protection of people's edits, rendered-layout checks for agents, real-time sync with presence, rich text, translations, static-site and React export, and interop (catalog export, Puck import, MCP Apps). Nothing is published to npm yet. See [`docs/plan.md`](docs/plan.md) and [`docs/progress.md`](docs/progress.md).

## See it

```bash
pnpm install
pnpm build
pnpm --filter @bowerbirdjs/showcase dev
```

The showcase is a fictional events product that embeds the editor next to an assistant. The scripted demo agent needs no key; to use Claude, start it with `ANTHROPIC_API_KEY` set. The key stays on the Vite server, which proxies `/api/anthropic`; the proxy only forwards `POST /v1/messages` from this machine (`SHOWCASE_ALLOW_REMOTE=1` opens it to your network, which lets anyone there spend your key). Smaller embeds live in [`examples/`](examples): plain HTML, Vue, and a host page with deliberately hostile CSS.

### Wedding planner (proof of concept)

```bash
pnpm --filter @bowerbirdjs/wedding dev
```

A wedding planner whose event website is built with Bowerbird as a _structured_ editor: 18 event blocks, three designs, and the event's facts (venues, schedule, travel, dress code, gifts, questions) stored once and shown by every section that needs them. See [`apps/wedding/README.md`](apps/wedding/README.md).

## Try it with an agent

```bash
pnpm install
pnpm build
```

Add the MCP server to Claude Code (or any MCP client) and ask it to build a page:

```bash
claude mcp add bowerbird -- node "$PWD/packages/mcp/dist/cli.js" --file my-site.site.json
```

The server prints a live preview URL (default http://localhost:4321) that reloads as the agent works. Add `?theme=dark` to preview the dark theme.

- `--review`: the agent's changes become proposals; accept or reject them op by op in the preview (`?changeset=cs-1` previews one).
- `--protect confirm`: the agent must ask before changing text or styles a person edited (default `warn`).
- With [Playwright](https://playwright.dev) installed (`npm i -D playwright && npx playwright install chromium`), agents also get `get_layout` (box positions plus overflow, overlap, contrast and tap-target checks) and `screenshot`.

To run the scripted end-to-end check (a real MCP client building a page over stdio), optionally with screenshots:

```bash
node packages/mcp/scripts/smoke.mjs --screenshots ./shots
```

### Edit alongside your agent

While the MCP server runs, open an editor on the same site: your edits and the agent's sync live, and you see each other's selections.

```bash
pnpm --filter @bowerbirdjs/example-mcp-editor dev
```

Then open the printed URL with `?sync=<sync URL>&name=Sam`, where the sync URL is the one the MCP server logs (`editors can sync at http://localhost:4321/__bowerbird/sync?key=…`). The key is made per run; set `BOWERBIRD_SYNC_KEY` to keep links working across restarts. Editors reconnect by themselves and send edits made while the server was away once it's back.

### Export

```bash
node packages/export/dist/cli.js --file my-site.site.json --out dist --base-url https://example.com
node packages/export/dist/cli.js --file my-site.site.json --out src/site --react
```

Static export writes one HTML file per page and language (clean URLs, `hreflang` links, sitemap) and one stylesheet; `--react` writes a component per page.

## Embed the editor

The editor is one custom element. The page you edit renders in your document as ordinary light DOM (no iframe, nothing editable inside a shadow root); the panels sit in the element's shadow root.

```html
<bowerbird-editor></bowerbird-editor>
<script type="module">
  import '@bowerbirdjs/editor/define';

  const editor = document.querySelector('bowerbird-editor');
  editor.actor = { kind: 'user', id: 'sam', name: 'Sam' };
  editor.addEventListener('bb-transaction', (e) => save(e.detail.doc));
</script>
```

Pass your own `store` to load a saved document, set a policy or register your own sections. The editor adapts to its own width, not the window's: below 900px it shows the page and opens one panel at a time over it. React and Vue wrappers set the same properties and turn the `bb-*` events into callbacks:

```tsx
import { BowerbirdEditor } from '@bowerbirdjs/react';

<BowerbirdEditor
  store={store}
  actor={{ kind: 'user', id: 'sam' }}
  onTransaction={({ doc }) => save(doc)}
/>;
```

Everything the editor does goes through the same operations as agents, so people's changes are validated, attributed and undoable too.

### Choose what the editor offers

Not every product wants the full editor. By default it offers what the store's policy lets the person change: someone with `content` access sees text, links and images only, `layout` access adds arranging sections but no styling, and everyone else gets everything. Pick a preset yourself, then turn single parts on or off and limit what can be added and styled:

```js
editor.ui = {
  preset: 'layout', // 'full' | 'layout' | 'content' | 'auto' (default: follows the policy)
  features: { 'toolbar.zoom': false, 'structure.history': false, delete: false },
  sections: ['hero', 'features', 'cta'], // section templates offered in Insert
  elements: ['text', 'image', 'button'], // single elements offered in Insert
  styleProperties: ['color', 'background', 'padding'], // what the style editor offers
};
```

`<bowerbird-editor preset="content">` is the HTML shorthand; the React and Vue wrappers take `ui`, `preset` and `appearance` props. Turning off a feature also turns off what belongs to it (`inspector` hides every inspector section), and an action like `delete` disappears everywhere: buttons, the canvas toolbar and the Delete key. Panels with nothing left in them give their space to the page.

| Feature                                          | What it is                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `toolbar`                                        | The top bar: `.panels` (panel toggles), `.pages` (page switcher), `.peers` (avatars), `.breakpoints`, `.zoom`, `.language`, `.theme`, `.preview`                                                                                                                                           |
| `structure`                                      | The left panel: `.layers`, `.history`, `.review` tabs                                                                                                                                                                                                                                      |
| `inspector`                                      | The right panel: `.page` (page title, path, description), `.info` (name, type, id), `.provenance` (who changed it last), `.content` (fields; `.content.advanced` for non-content fields like heading level), `.section` (variants; `.section.settings` for colours and spacing), `.styles` |
| `canvas.toolbar`, `canvas.label`, `canvas.peers` | Toolbar and label on the selected element, other people's selections                                                                                                                                                                                                                       |
| `insert`                                         | Adding content: `.sections`, `.elements`, `.components`                                                                                                                                                                                                                                    |
| `move`, `duplicate`, `delete`                    | Drag and drop and ↑/↓, duplicating, deleting (buttons and shortcuts)                                                                                                                                                                                                                       |
| `text`                                           | Editing text on the page; `.formatting` for bold, italic and links in rich text                                                                                                                                                                                                            |
| `components`                                     | Linked components: `.create` (make linked), `.reset` (reset an instance)                                                                                                                                                                                                                   |
| `undo`                                           | Undo and redo, including undoing someone else's work                                                                                                                                                                                                                                       |

`EDITOR_FEATURES` in `@bowerbirdjs/editor` lists every key with a description. Hiding is not a permission: the store's policy decides what may change, for people and agents alike, so set both.

For the look, pick `appearance="dark"` (or `auto`, which follows the system; the default is `light`) and set `--bb-editor-*` variables (accent, on-accent, fg, muted, bg, panel, border, hover, danger, linked, warning, font, left, right, canvas-bg, color-scheme), which win over the appearance's defaults, or style parts with `::part()`: `toolbar`, `structure`, `inspector`, `tabs`, `tab`, `panel-section`, `card`, `button`, `select`, `input`, `field`, `toast`. Your own controls go in the `toolbar-start` and `toolbar-end` slots:

```html
<bowerbird-editor>
  <button slot="toolbar-end" onclick="publish()">Publish</button>
</bowerbird-editor>
```

### Site data

Sites often show the same facts in several places: an event's date, its schedule, its venues. Declare them as data groups and let sections read them, so one change reaches every place:

```ts
const registry = createRegistry({
  data: [
    defineData({ key: 'schedule', title: 'Schedule', description: '…', schema: z.array(item) }),
  ],
  components: [scheduleList], // render: (node, ctx) => ({ tag: 'ol', children: ctx.data('schedule').map(…) })
});
store.apply({ ops: [{ op: 'data.set', key: 'schedule', path: [0, 'time'], value: '14:30' }] });
```

`data.set` is a content-level op like any other: validated against the group's schema, attributed, undoable, synced, and open to agents (`get_data`). Components render data as generated elements (escaped, URL-sanitized, colours only through validated custom properties); in the editor they carry `data-bb-data` marks, and a click on one fires `bb-data-click` so the host can open the right field.

## Use the engine in code

```ts
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, outline } from '@bowerbirdjs/core';
import { renderDocument } from '@bowerbirdjs/html';

const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });

const result = store.apply({
  actor: { kind: 'agent', id: 'my-agent' },
  label: 'Landing page',
  ops: [
    { op: 'page.create', path: '/', title: 'Home' },
    {
      op: 'section.insert',
      section: 'hero',
      variant: { layout: 'split' },
      content: { heading: { text: 'Know where every hour goes' } },
    },
    { op: 'style.set', id: 'hero-1/heading', bp: 'lg', css: 'font-size: var(--text-6xl)' },
  ],
});
if (!result.ok) console.log(result.errors); // actionable, e.g. "Did you mean …"

console.log(outline(store.view)); // compact tree for agents
store.undo({ actorId: 'my-agent' }); // reverts the agent's change, keeps everyone else's
const html = renderDocument(store.doc, store.registry, 'home');
```

## Packages

| Package                                  | What it does                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@bowerbirdjs/core`](packages/core)     | Document model, operations, validation, transactions, per-actor undo/redo, policy (freedom levels, locks), outline                                          |
| [`@bowerbirdjs/css`](packages/css)       | Tokens → CSS variables; section and node styles → CSS with container-query breakpoints (published or editor mode)                                           |
| [`@bowerbirdjs/html`](packages/html)     | Pages → semantic HTML (escaped, URL-sanitised)                                                                                                              |
| [`@bowerbirdjs/blocks`](packages/blocks) | Default design tokens, dark theme and starter sections                                                                                                      |
| [`@bowerbirdjs/import`](packages/import) | HTML → nodes (sanitised; keeps token-based inline styles)                                                                                                   |
| [`@bowerbirdjs/agent`](packages/agent)   | Agent tools (`get_context`, `get_outline`, `get_nodes`, `list_sections`, `list_tokens`, `apply`, `import_html`, `lint`, `undo`, `get_layout`, `screenshot`) |
| [`@bowerbirdjs/layout`](packages/layout) | Rendered-layout snapshots and layout lint (overflow, clipping, overlap, contrast, tap targets), in the browser or headless                                  |
| [`@bowerbirdjs/mcp`](packages/mcp)       | MCP server (stdio), live preview server, CLI with file persistence                                                                                          |
| [`@bowerbirdjs/editor`](packages/editor) | `<bowerbird-editor>` (Lit): same-document canvas, overlays, inline editing, drag and drop, layers, insert, inspector, history                               |
| [`@bowerbirdjs/react`](packages/react)   | React wrapper                                                                                                                                               |
| [`@bowerbirdjs/vue`](packages/vue)       | Vue wrapper                                                                                                                                                 |
| [`@bowerbirdjs/sync`](packages/sync)     | Server-authoritative real-time sync with presence for people and agents (WebSocket, HTTP/SSE or in-memory transports)                                       |
| [`@bowerbirdjs/export`](packages/export) | Static site and React export, plus a JSON Schema catalog of sections and components for other generative-UI tools                                           |
| [`bench`](bench)                         | PageBench: page-editing tasks for agents, with a Claude runner and a scripted offline mode                                                                  |
| [`apps/showcase`](apps/showcase)         | Demo product embedding the editor with an assistant panel                                                                                                   |

## Core ideas

- **One way to change a page.** People, agents and host code all send transactions of typed operations. Each transaction is validated, checked against the host's policy, attributed to an actor, and applied all-or-nothing.
- **Big blocks you can open.** Inserting a section expands it into ordinary nodes with stable, readable ids (`hero-1/heading`, `pricing-1/tier-pro/price`). Agents fill a whole section in one op, then edit any part precisely.
- **Errors agents can act on.** Every error names the node, the field and the fix: `No node "hero-1/headline". Did you mean "hero-1/heading"?`
- **On-brand by default.** Styles are CSS declarations that must use design-token variables (`var(--space-lg)`) unless the host allows raw values. Sections expose their own CSS variables (`--hero-bg`) as style knobs.
- **Human edits are protected.** Every field records who changed it last. Agents are warned (or stopped, if the host prefers) before overwriting what a person wrote, and undo is per actor and three-way: undoing an agent's change keeps later edits by people.
- **Agents can propose instead of apply.** A changeset is validated and previewed on the canvas; a person accepts or rejects it op by op, and accepted changes stay attributed to the agent.
- **Linked components.** Turn a section into a symbol; edit its definition once and every instance follows, except fields an instance overrides.
- **Agents can see the result.** `get_layout` lays the page out at any width and reports problems the document can't show (overflow, clipped text, low contrast); `screenshot` returns an image.
- **Framework-free output.** Plain HTML and one CSS file with cascade layers; breakpoints are container queries, so sections respond correctly in any container.

## Development

```bash
pnpm build      # tsc project build
pnpm test       # vitest (runs against sources)
pnpm test:e2e   # builds the examples and showcase, drives them in Chromium (needs Playwright)
pnpm lint       # biome
pnpm format     # biome --write
```

Research and design notes: [`docs/research/`](docs/research) and [`docs/plan.md`](docs/plan.md).

## License

[MIT](LICENSE)
