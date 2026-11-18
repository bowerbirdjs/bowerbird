# Bowerbird: notes for agents working on this repo

An embeddable, agent-first visual page editor. Read `docs/plan.md` for decisions and the roadmap; `docs/research/` holds the landscape research.

## Commands

- `pnpm build`: TypeScript project build (`tsc -b tsconfig.build.json`, which lists every package; add new packages there). Needed before running the MCP CLI or smoke script. No shell globs or Unix-only commands in scripts: they must run on Windows too.
- `pnpm test`: Vitest. Tests import `@bowerbirdjs/*` from `src` through aliases in `vitest.config.ts`, so no build is needed.
- `pnpm test:e2e`: builds `examples/*` and `apps/showcase` with Vite and drives them with Playwright (skipped if Playwright isn't installed). Tests live in `e2e/`.
- `pnpm lint` / `pnpm format`: Biome.
- `pnpm --filter @bowerbirdjs/showcase dev`: the showcase (build the packages first).
- `node packages/mcp/scripts/smoke.mjs [--screenshots <dir>]`: end-to-end MCP check (build first).

## Architecture rules

- `core`, `css` and `html` are pure TypeScript: no DOM, no Node-only APIs. They must run in browsers, Node, edge and workers.
- **Every document change goes through `Store.apply` ops.** Don't mutate `SiteDoc` directly; add a new op (Zod schema in `core/src/ops.ts`, handler in `core/src/apply.ts`, policy level in `core/src/policy.ts`) if needed.
- Transactions are all-or-nothing. Handlers report problems with `fail(ctx, issue)` and never throw for user or agent errors.
- **Error messages are part of the API.** Say what's wrong, where (node id and path), and how to fix it (`hint`, `didYouMean`). Agents read them.
- Ids are readable and stable (`hero-1/heading`). Only section roots, keyed items (`item-2`, `tier-pro`) and symbol roots add an id scope.
- Transactions run in this order (`Store.run`): ops → human-edit protection (agents) → symbol instance sync (`core/src/symbols.ts`) → provenance stamps (`core/src/provenance.ts`) on commit. Undo/redo replay record changes and are checked with `Policy.checkChanges`.
- Symbol instances are linked copies (`BNode.link`); their structure only changes through the definition (ops refuse with code `instance`).
- Translations live in `BNode.l10n[locale]` (content props only); render with `{ locale }`. Rich text (`rich-text`, prop `html`) must go through `sanitizeRichText` when written and rendered.
- Sync (`packages/sync`) is server-authoritative: clients never change the server's document directly, only send ops. Anything new that changes a document must be an op so it syncs.
- Styles are CSS declarations validated against design tokens; raw values need policy permission. Never store Tailwind classes.
- Published HTML is light DOM, escaped and URL-sanitised; no scripts in output.
- Editor: the canvas is light DOM in the host document (no iframe; nothing editable inside a shadow root). Only the panels use the element's shadow root. Canvas chrome classes start with `bbx-` and are scoped under `.bbx-host`.
- What the editor shows must match published output: `e2e/hostile-css.e2e.ts` compares computed styles of the canvas with the published page. Run it after changing CSS generation or canvas styles.
- Editor UI changes go through `EditorController` (`packages/editor/src/controller.ts`), which calls `Store.apply` as the editor's actor. Keep the controller DOM-free so it stays unit-testable.
- Every piece of editor UI can be turned off by the host: give new UI a key in `EDITOR_FEATURES` (`packages/editor/src/features.ts`, documented in the README table) and check `controller.can(key)` where it renders. Actions (insert, move, duplicate, delete, components, undo) are also gated in the controller, so buttons, drag and drop and shortcuts all follow. Presets map onto policy levels; hiding is never a permission, the policy is.
- Keep dependencies MIT/BSD/Apache. No AGPL/GPL. Section content must be original (Tailwind Plus and Relume licences forbid builder use).

## Conventions

- ESM, TypeScript `NodeNext`: relative imports end in `.js`.
- Tests live in `packages/<name>/test/*.test.ts`; browser tests in `e2e/*.e2e.ts`.
- Agent-facing text (tool descriptions, `AGENT_GUIDE`) should be short and concrete: agents pay for every token.
