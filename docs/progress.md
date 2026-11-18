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
- [ ] Review pass and fixes

## Phase 2: sections and safety

- [ ] Linked components (definitions, instances, overrides, detach)
- [ ] Draft changesets (propose, accept or reject per op)
- [ ] Provenance (last editor per node) and protection of human edits
- [ ] Rendered layout lint, layout snapshot and screenshot tools
- [ ] Streaming op preview in the editor
- [ ] Review pass and fixes

## Phase 3: collaboration and reach

- [ ] Server-authoritative sync with presence (people and agents)
- [ ] Rich text
- [ ] Localised content
- [ ] Code export (static site, JSX)
- [ ] Importers (Puck) and interop (A2UI / json-render catalog export, MCP Apps view)
- [ ] Review pass and fixes

## Notes

- Phase 0 review fixes: prototype-safe lookups, CSS-injection hardening (property names, balanced value syntax, token/theme values, compile-time re-checks), lock checks on whole subtrees and pages, design-level checks for styling inside inserts, depth limit, ids never reused (per-prefix counters), undo that can't get stuck and merges tokens/themes per path, unique order keys after undo, section.variant rebuilt as a merge, shared URL sanitiser, importer hardening, preview host check, benchmark accounting.
- Drag and drop: native HTML5 drag and drop instead of `@dnd-kit/dom` (pre-1.0; native DnD works across the panels' shadow root into the light-DOM canvas).
- Showcase: Vite + React instead of Next.js. It needs no server beyond the API-key proxy, and React is the part that matters for the embedding story. Svelte example and code components rendered by the wrappers are deferred to Phase 2.
- Host CSS isolation: editor-mode CSS starts with `all: revert` on content (except SVG, media and `[data-bb-code]` subtrees), at a specificity that host element and single-class rules can't beat; base, section and node rules come after it at the same specificity. Host `!important` and very specific host selectors can still leak.

- No GitHub remote yet: `bowerbirdjs/bowerbird` must be created before pushing.
- No model API key in this environment: the benchmark runner is tested with a scripted agent.
