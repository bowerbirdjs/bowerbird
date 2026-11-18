# Bowerbird

**An open-source visual page editor that people and AI agents edit together.**

Bowerbird is a page engine you embed in your own product. Pages are built from large, prebuilt sections (hero, pricing, footer …) that stay fully editable inside. People edit on a visual canvas; AI agents edit through a typed API and MCP. Both go through the same validated, attributed and undoable operations. Styles use CSS custom properties and design tokens, so the output is plain HTML and CSS and stays on-brand.

> **Status: early (Phase 1).** The headless engine, starter sections, HTML/CSS renderer, agent tools, MCP server and the visual editor (`<bowerbird-editor>`, with React and Vue wrappers) work. Linked components, draft changesets and visual tools for agents come next. See [`docs/plan.md`](docs/plan.md) and [`docs/progress.md`](docs/progress.md).

## See it

```bash
pnpm install
pnpm build
pnpm --filter @bowerbirdjs/showcase dev
```

The showcase is a fictional events product that embeds the editor next to an assistant. The scripted demo agent needs no key; to use Claude, start it with `ANTHROPIC_API_KEY` set. The key stays on the Vite server, which proxies `/api/anthropic`; the proxy only forwards `POST /v1/messages` from this machine (`SHOWCASE_ALLOW_REMOTE=1` opens it to your network, which lets anyone there spend your key). Smaller embeds live in [`examples/`](examples): plain HTML, Vue, and a host page with deliberately hostile CSS.

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

To run the scripted end-to-end check (a real MCP client building a page over stdio), optionally with screenshots:

```bash
node packages/mcp/scripts/smoke.mjs --screenshots ./shots
```

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

Pass your own `store` to load a saved document, set a policy or register your own sections. React and Vue wrappers set the same properties and turn the `bb-*` events into callbacks:

```tsx
import { BowerbirdEditor } from '@bowerbirdjs/react';

<BowerbirdEditor
  store={store}
  actor={{ kind: 'user', id: 'sam' }}
  onTransaction={({ doc }) => save(doc)}
/>;
```

The editor is themed with `--bb-editor-*` CSS variables. Everything it does goes through the same operations as agents, so people's changes are validated, attributed and undoable too.

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

| Package                                  | What it does                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`@bowerbirdjs/core`](packages/core)     | Document model, operations, validation, transactions, per-actor undo/redo, policy (freedom levels, locks), outline              |
| [`@bowerbirdjs/css`](packages/css)       | Tokens → CSS variables; section and node styles → CSS with container-query breakpoints (published or editor mode)               |
| [`@bowerbirdjs/html`](packages/html)     | Pages → semantic HTML (escaped, URL-sanitised)                                                                                  |
| [`@bowerbirdjs/blocks`](packages/blocks) | Default design tokens, dark theme and starter sections                                                                          |
| [`@bowerbirdjs/import`](packages/import) | HTML → nodes (sanitised; keeps token-based inline styles)                                                                       |
| [`@bowerbirdjs/agent`](packages/agent)   | Agent tools (`get_context`, `get_outline`, `get_nodes`, `list_sections`, `list_tokens`, `apply`, `import_html`, `lint`, `undo`) |
| [`@bowerbirdjs/mcp`](packages/mcp)       | MCP server (stdio), live preview server, CLI with file persistence                                                              |
| [`@bowerbirdjs/editor`](packages/editor) | `<bowerbird-editor>` (Lit): same-document canvas, overlays, inline editing, drag and drop, layers, insert, inspector, history   |
| [`@bowerbirdjs/react`](packages/react)   | React wrapper                                                                                                                   |
| [`@bowerbirdjs/vue`](packages/vue)       | Vue wrapper                                                                                                                     |
| [`bench`](bench)                         | PageBench: page-editing tasks for agents, with a Claude runner and a scripted offline mode                                      |
| [`apps/showcase`](apps/showcase)         | Demo product embedding the editor with an assistant panel                                                                       |

## Core ideas

- **One way to change a page.** People, agents and host code all send transactions of typed operations. Each transaction is validated, checked against the host's policy, attributed to an actor, and applied all-or-nothing.
- **Big blocks you can open.** Inserting a section expands it into ordinary nodes with stable, readable ids (`hero-1/heading`, `pricing-1/tier-pro/price`). Agents fill a whole section in one op, then edit any part precisely.
- **Errors agents can act on.** Every error names the node, the field and the fix: `No node "hero-1/headline". Did you mean "hero-1/heading"?`
- **On-brand by default.** Styles are CSS declarations that must use design-token variables (`var(--space-lg)`) unless the host allows raw values. Sections expose their own CSS variables (`--hero-bg`) as style knobs.
- **Human edits are protected.** Undo is per actor and three-way: undoing an agent's change keeps later edits by people.
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
