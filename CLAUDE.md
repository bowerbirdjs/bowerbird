# Bowerbird: notes for agents working on this repo

An embeddable, agent-first visual page editor. Read `docs/plan.md` for decisions and the roadmap; `docs/research/` holds the landscape research.

## Commands

- `pnpm build`: TypeScript project build (`tsc -b tsconfig.build.json`, which lists every package; add new packages there). Needed before running the MCP CLI or smoke script. No shell globs or Unix-only commands in scripts: they must run on Windows too.
- `pnpm test`: Vitest. Tests import `@bowerbirdjs/*` from `src` through aliases in `vitest.config.ts`, so no build is needed.
- `pnpm test:e2e`: builds `examples/*` and `apps/showcase` with Vite and drives them with Playwright (skipped if Playwright isn't installed). Tests live in `e2e/`.
- `pnpm lint` / `pnpm format`: Biome.
- `pnpm bench -- --scripted`: PageBench without a model (build first): every task's reference solution must pass its checks. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, this, the browser tests, and build and tests on Windows.
- `pnpm --filter @bowerbirdjs/showcase dev`: the showcase (build the packages first).
- `pnpm --filter @bowerbirdjs/wedding dev`: the wedding planner POC (`apps/wedding`, structured event-site editor; see its README).
- `node packages/mcp/scripts/smoke.mjs [--screenshots <dir>]`: end-to-end MCP check (build first).

## Architecture rules

- `core`, `css` and `html` are pure TypeScript: no DOM, no Node-only APIs. They must run in browsers, Node, edge and workers.
- **Every document change goes through `Store.apply` ops.** Don't mutate `SiteDoc` directly; add a new op (Zod schema in `core/src/ops.ts`, handler in `core/src/apply.ts`, policy level in `core/src/policy.ts`) if needed.
- Transactions are all-or-nothing. Handlers report problems with `fail(ctx, issue)` and never throw for user or agent errors.
- **Error messages are part of the API.** Say what's wrong, where (node id and path), and how to fix it (`hint`, `didYouMean`). Agents read them.
- Ids are readable and stable (`hero-1/heading`). Only section roots, keyed items (`item-2`, `tier-pro`) and symbol roots add an id scope.
- Transactions run in this order (`Store.run`): ops → human-edit protection (agents) → symbol instance sync (`core/src/symbols.ts`) → provenance stamps (`core/src/provenance.ts`) on commit. Undo/redo replay record changes and are checked with `Policy.checkChanges`.
- Symbol instances are linked copies (`BNode.link`); their structure only changes through the definition (ops refuse with code `instance`).
- Shared facts (e.g. an event's schedule) are site data: groups declared with `defineData` and changed with `data.set`; components read them in `render(node, ctx)` via `ctx.data`. Generated elements go through the same escaping and URL rules; colours only via `ElementSpec.vars`.
- Translations live in `BNode.l10n[locale]` (content props only); render with `{ locale }`. Rich text (`rich-text`, prop `html`) must go through `sanitizeRichText` when written and rendered.
- Sync (`packages/sync`) is server-authoritative: clients never change the server's document directly, only send ops. Anything new that changes a document must be an op so it syncs.
- Styles are CSS declarations validated against design tokens; raw values need policy permission. Never store Tailwind classes.
- Published HTML is light DOM, escaped and URL-sanitised; no scripts in output.
- SVG reaches a page only as an icon: a name in the registry's icon set (`registerIcons`, `parseIcon` in `core/src/icons.ts`), stored as checked shape data, never as markup. Don't add another way to output SVG or raw HTML.
- Forms are `form` + `field` nodes. A `field` owns its label and control (one node), `action` goes through the URL sanitiser, `formaction` is always dropped, and there are no password or file fields. Rules that span props or need the registry go in `ComponentDef.validate` (returns `PropProblem[]`, reported as `invalid_props`), not in `render`.
- Starter sections (`packages/blocks`): original copy and pictures, classes `bb-<section>__<part>`, colours and sizes from tokens, and each one must pass the Chromium layout lint in every variant, both themes and at 390/820/1280px (`packages/mcp/test/browser.test.ts`, needs Playwright).
- Editor: the canvas is light DOM in the host document (no iframe; nothing editable inside a shadow root). Only the panels use the element's shadow root. Canvas chrome classes start with `bbx-` and are scoped under `.bbx-host`.
- What the editor shows must match published output: `e2e/hostile-css.e2e.ts` compares computed styles of the canvas with the published page. Run it after changing CSS generation or canvas styles.
- Code components can be drawn by the host (`hostComponents`, mounts in `canvas.ts`), children included: a mount element must stay the same across canvas renders (frameworks keep roots in it) and is renewed only after an in-place edit inside it. Page CSS (base and editor resets) never reaches inside `[data-bb-code]` or onto the page frame (`data-bb-frame`); keep new page-wide rules scoped with `OWN` in `css/src/index.ts`. Read edited text with `editableText`, never `innerText` (it applies `text-transform`). Words on the canvas come from `EditorStrings` (`strings.ts`, `ui.strings`); add new canvas text there, not inline.
- Editor UI changes go through `EditorController` (`packages/editor/src/controller.ts`), which calls `Store.apply` as the editor's actor. Keep the controller DOM-free so it stays unit-testable.
- Editor chrome takes every colour, size, corner and shadow from the design tokens in `packages/editor/src/theme.ts` (`var(--bbe-<name>)`; hosts set `--bb-editor-<name>`). Add a token there (with light and dark defaults, documented in the README table) rather than hard-coding a value; `theme.test.ts` checks. Icons come from `icons.ts` (hosts may replace them via `ui.icons`). Brand looks are themes outside the editor package (tokens, `::part()` rules, `ui.icons`), like `apps/wedding/src/joy`; if a brand needs a hook, add a token or part rather than brand-specific code.
- Section previews in Insert (`packages/editor/src/thumbnails.ts`) are the published markup of a scratch document (ids `thumb-N…`) with editor-mode CSS scoped to `.bb-thumbs`, inside an `inert` element in the panels' shadow root. They are rebuilt only when tokens, themes, breakpoints or data change, after a quiet moment. Keep them inert and keep page CSS out of the panels.
- Every piece of editor UI can be turned off by the host: give new UI a key in `EDITOR_FEATURES` (`packages/editor/src/features.ts`, documented in the README table) and check `controller.can(key)` where it renders. Actions (insert, move, duplicate, delete, components, undo) are also gated in the controller, so buttons, drag and drop and shortcuts all follow. Presets map onto policy levels; hiding is never a permission, the policy is.
- Keep dependencies MIT/BSD/Apache. No AGPL/GPL. Section content must be original (Tailwind Plus and Relume licences forbid builder use).

## Conventions

- ESM, TypeScript `NodeNext`: relative imports end in `.js`.
- Tests live in `packages/<name>/test/*.test.ts`; browser tests in `e2e/*.e2e.ts`.
- A PageBench task is `bench/tasks/<id>.json` plus a reference solution `bench/solutions/<id>.json`; `bench/test/bench.test.ts` checks that the solution passes and that doing nothing fails. Checks must accept any correct solution, not only the reference one.
- Agent-facing text (tool descriptions, `AGENT_GUIDE`) should be short and concrete: agents pay for every token.
