# Progress

The working log for building Bowerbird phase by phase. Each phase ends with a review pass and fixes, then a commit. The phase definitions are in [`plan.md`](plan.md).

## Phase 0: prove the engine

- [x] Core document model, ops, transactions, per-actor undo, policy, outline
- [x] CSS compiler, HTML renderer, starter sections, agent tools, MCP server, preview, smoke test
- [x] `section.variant` op (re-expand a template, keeping content by part path)
- [x] Document lint (accessibility and content checks) + `lint` agent tool
- [x] `import_html` (HTML → nodes) + agent tool
- [x] Value-aware token hints for raw values; warnings for dangling token references
- [x] CSS package tests; type-check tests
- [x] PageBench runner (Claude API) with a scripted offline mode
- [x] Review pass and fixes: two independent reviews, 29 findings (27 reproduced), all fixed with regression tests

## Phase 1: editor and showcase

- [x] `@bowerbirdjs/editor`: `<bowerbird-editor>` (Lit), same-document canvas, overlays, selection, inline text editing, drag and drop, layers / insert / inspector / history panels, breakpoint switcher, zoom, theme preview, undo/redo, keyboard shortcuts, host API and events
- [x] `@bowerbirdjs/react` and `@bowerbirdjs/vue` wrappers
- [x] Showcase app (fictional events product embedding the editor) with an assistant panel (scripted demo agent, or Claude through a dev-server proxy), role switch, palettes, developer panel, HTML export
- [x] Examples: plain HTML, Vue, hostile host CSS
- [x] Scoped reset so host element CSS doesn't reach the canvas (content and chrome)
- [x] End-to-end tests (`pnpm test:e2e`: Vitest + Playwright against built apps); controller unit tests
- [x] Review pass and fixes: two independent reviews, 39 findings (37 reproduced), fixed with regression tests

## Phase 2: sections and safety

- [x] Linked components (symbols): `symbol.create/insert/detach/reset/update/remove`; definitions are node subtrees outside pages; definition edits sync to instances inside the same transaction, field by field, keeping overrides; instance structure is locked
- [x] Draft changesets: `store.propose`, preview, accept or reject per op with dependencies; created ids pinned and rebased if taken; accepted changes attributed to the agent and approved by the person
- [x] Provenance (`BNode.edited` stamps per field) and protection of people's edits (`protectHumanEdits: warn | confirm`); undo restores stamps
- [x] Rendered layout: `@bowerbirdjs/layout` (measure, lint, compact format), `get_layout` and `screenshot` agent tools; Playwright provider in the MCP server, DOM provider in browsers
- [x] Streaming op preview in the editor (`controller.showPreview`), review tab with per-op accept, linked-component UI (insert, make linked, edit definition, overrides, detach), "last changed by" in the inspector, image upload through an asset adapter
- [x] MCP: `--review` and `--protect`, review panel in the live preview
- [x] Review pass and fixes: two independent reviews, 38 findings (36 reproduced), fixed with regression tests

## Phase 3: collaboration and reach

- [x] Server-authoritative sync with presence (`@bowerbirdjs/sync`): optimistic clients that replay pending changes on the server's state, undo/review on the server, presence for people and for agents working on the server store; in-memory, WebSocket and HTTP/SSE transports; the MCP preview serves sync so an editor can work alongside an MCP agent (`examples/mcp-editor`); two-person example (`examples/collab`)
- [x] Rich text: `rich-text` primitive with a sanitized inline subset (sanitized on write and on render); inline Ctrl+B / Ctrl+I / Ctrl+K in the editor
- [x] Localised content: `locale.set`, translations of content props per node (`props.set`/`text.edit` with `locale`), rendering, outline and lint per language, editor language switcher, per-language static export with `hreflang`
- [x] Code export (`@bowerbirdjs/export`): static multi-page site (one stylesheet, clean URLs, sitemap) and React components; `bowerbird-export` CLI
- [x] Interop: Puck importer (`importPuck` with mappers, slots and legacy zones), JSON Schema catalog export (`exportCatalog`) for A2UI/json-render-style generators, MCP Apps view (`show_page` with a `ui://bowerbird/page` resource)
- [x] Review pass and fixes: two independent reviews, 34 findings (all reproduced or traced), fixed with regression tests

## After Phase 3

- [x] Windows: build scripts without shell globs (`tsconfig.build.json`)
- [x] Editor UI customization: every part of the editor can be turned off (`ui.features`, keys in `EDITOR_FEATURES`); presets `full` / `layout` / `content`, and by default the editor offers what the store policy allows its actor (`Policy.level`, `Store.onPolicy`); allowlists for insertable sections and elements and for style properties; `toolbar-start`/`toolbar-end` slots and `::part()` styling; React/Vue `ui` and `preset` props; showcase roles show the three levels
- [x] Site data: `SiteDoc.data` groups declared with `defineData` (zod schemas), the `data.set` op (content level; undo, sync, diffs), data-aware rendering (`render(node, ctx)` with `ctx.data`, generated elements, validated custom properties), `bb-data-click` in the editor, `get_data` for agents
- [x] Policy-aware editor actions: delete, duplicate and move are offered only when the policy would allow them (dry runs)
- [x] Editing everything on the canvas: site data marked with `ElementSpec.edit` is edited in place (plain text) or in a small form (times, dates, links, colours, choices); list items (`ElementSpec.item`) get move/copy/remove; `ElementSpec.add` buttons add the first item of an empty list or a missing value and start editing it; the selected element's other content props (photo, alt text, link) get fields on the canvas (`data`, `data.items`, `canvas.fields` features)
- [x] Editor design and theming: redesigned chrome (own icon set, segmented screen sizes, layers with type icons, inspector header, cards, history avatars, messages); every colour, size, corner and shadow comes from design tokens (`EDITOR_TOKENS`, `--bb-editor-*`, light and dark defaults) that also reach the canvas chrome and field panel; `ui.appearance` (`light`/`dark`/`auto`), `ui.density` (`comfortable`/`compact`) and `ui.tokens`, as attributes and React/Vue props too; the page keeps its published look in a dark editor
- [x] Wedding planner POC (`apps/wedding`): event facts, the brief's 18 blocks, three designs with contrast-safe accents, a structured-editing policy, Details and Design panels, preview and publish

## Notes

- Phase 0 review fixes: prototype-safe lookups, CSS-injection hardening (property names, balanced value syntax, token/theme values, compile-time re-checks), lock checks on whole subtrees and pages, design-level checks for styling inside inserts, depth limit, ids never reused (per-prefix counters), undo that can't get stuck and merges tokens/themes per path, unique order keys after undo, section.variant rebuilt as a merge, shared URL sanitiser, importer hardening, preview host check, benchmark accounting.
- Drag and drop: native HTML5 drag and drop instead of `@dnd-kit/dom` (pre-1.0; native DnD works across the panels' shadow root into the light-DOM canvas).
- Showcase: Vite + React instead of Next.js. It needs no server beyond the API-key proxy, and React is the part that matters for the embedding story. Svelte example and code components rendered by the wrappers are deferred to Phase 2.
- Phase 1 review fixes: tags validated at render time (stored documents could inject `<style>`/`<script>`); undo/redo/revert checked against the policy; editors release their store when removed and set up on first update (framework props apply first); React wrapper renders the element client-side only (hydration) and sets props only when they change; drag payloads tied to their editor and cleared on every dragend; keyboard shortcuts limited to canvas and layers and off in preview; ARIA tree keyboard navigation; focus kept in the editor after deletes; inline edits keep line breaks and don't overwrite concurrent changes; page/selection events kept in sync; preview widths clamped to breakpoint ranges; JSON fields for array/object props. Canvas: the page root starts from initial values (no inherited editor or host fonts), node rules outrank section rules as in published CSS, rem is converted to px, pseudo-elements and media are reset, chrome is scoped under `.bbx-host`; an e2e test compares editor and published computed styles. Showcase: API proxy limited to `POST /v1/messages` from loopback, Claude loop drops dangling tool calls and rolls back stopped requests, runs stop when leaving an event.
- Host CSS isolation: editor-mode CSS starts with `all: revert` on content (except SVG, media and `[data-bb-code]` subtrees), at a specificity that host element and single-class rules can't beat; base, section and node rules come after it at the same specificity. Host `!important` and very specific host selectors can still leak.

- Phase 2 review fixes: undo/redo/revert are gated by review and protect people's edits (including nodes an undo would delete); instance sync runs after every op, uses an index (linear in instances), respects locks, protection and the depth limit, and also runs on undo; dangling links are dropped; definition roots and retired ids are never reused; partial changeset accepts keep later ops pointing at rebased ids; rebasing and dependencies only look at id fields; agents can't approve; dry runs work under review; token and theme edits are stamped and protected; `symbol.reset` needs design access; layout lint ignores intended overflow, reports left overflow, handles inline links, opacity and images behind text; screenshots load lazy images, crop tall images (and say so) and explain hidden nodes; the browser restarts after a crash; proposals persist in the MCP site file; the preview can show proposed pages.
- Phase 2 notes: symbols can't contain other symbols yet (create and insert refuse nesting). Ops that create nodes without an explicit id (`node.duplicate`) may refer to different ids after a changeset is rebased. Only fields a person changed are protected, not everything they created (inserting a template section doesn't make its placeholder copy theirs). Deferred to Phase 3: host code components rendered by the wrappers, an extension API for custom fields and panels, section thumbnails, and a Svelte example.
- Phase 3 notes: sync is server-authoritative rather than CRDT-based (the store already validates and merges by record); clients keep only their own pending changes, which are replayed on each server commit. Hosts must authenticate sync clients (`createSyncServer({ authenticate })`); the default only checks the claimed actor's shape. Translations cover content props only; changing the default language is refused once translations exist. Rich text stays inline (no lists or headings inside one node; use separate nodes). The catalog is a neutral JSON Schema format, not a specific A2UI or json-render schema version. Still deferred: host code components rendered by the wrappers, an extension API for custom fields and panels, section thumbnails, a Svelte example.
- Phase 3 review fixes (sync): the preview's sync endpoint needs a per-run key (the printed sync URL; `BOWERBIRD_SYNC_KEY` keeps it across restarts) and caps connections; review actions only work from this machine. `httpChannel` reconnects by itself and the client resends unconfirmed changes; the server remembers handled change ids so nothing applies twice. Optimistically created ids are pinned and renamed on the server if taken (the client rewrites later changes and the editor's selection), and changes after a creating one wait for its confirmation. Offline edits are kept and sent later; undo, redo and review need a connection. `authenticate(claimed, context)`, with the decided actor sent in `welcome`. Undo flags, token provenance and warnings reach clients; refusals show in the editor; confirmations are marked `echo`. Agent presence expires on a timer and covers proposals and MCP tool calls. Still open: `node.duplicate` can't pin the id it creates, so a concurrent clash there isn't renamed.
- Phase 3 review fixes (text/languages/export): the sanitizer tokenizes like a browser in linear time (quoted attributes, first href wins, block boundaries become <br>) and its size limit applies to the sanitized HTML; rich text inside a link renders without its own links; the inline editor pastes sanitized content and toggles <strong>/<em> itself (no execCommand styles). Page titles and descriptions are one line and translatable (`page.update` with `locale`); `/about` and `/about/` are one path, and page paths can't clash with a language's /<code>/ tree. `locale.set` remove respects locks, keeps a declared default, and refuses adding only the default; "en" is the implicit default for `locale`. Undo reverts languages as a set. Instances that override text stop showing the definition's translation of it. Outline and lint share one "untranslated" check; outline validates its locale; lint understands rich-text headings and link text and checks translated URLs. Exports refuse clashing output paths, translate titles, `lang` and internal links per language, and the React export keeps inline spaces and empty attributes, imports `.jsx` in JS mode, avoids case-only name clashes and exports every language. `get_nodes` shows translations; `show_page` uses own-property lookups, takes `locale`, and names a per-call view (`ui://bowerbird/page?page=…`). The Puck importer cuts zone loops and deep nesting and ignores prototype names. Still open: translated page paths (slugs) and data binding.
- No GitHub remote yet: `bowerbirdjs/bowerbird` must be created before pushing.
- No model API key in this environment: the benchmark runner is tested with a scripted agent.
