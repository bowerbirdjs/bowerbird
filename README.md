# Bowerbird

**An open-source visual page editor that people and AI agents edit together.**

Bowerbird is a page engine you embed in your own product. Pages are built from large, prebuilt sections (hero, pricing, footer …) that stay fully editable inside. People edit on a visual canvas; AI agents edit through a typed API and MCP. Both go through the same validated, attributed and undoable operations. Styles use CSS custom properties and design tokens, so the output is plain HTML and CSS and stays on-brand.

> **Status: early (Phase 0).** The headless engine, starter sections, HTML/CSS renderer, agent tools and MCP server work. The visual editor (web components) comes next. See [`docs/plan.md`](docs/plan.md).

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

| Package                                  | What it does                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`@bowerbirdjs/core`](packages/core)     | Document model, operations, validation, transactions, per-actor undo/redo, policy (freedom levels, locks), outline                   |
| [`@bowerbirdjs/css`](packages/css)       | Tokens → CSS variables; section and node styles → CSS with container-query breakpoints (published or editor mode)                    |
| [`@bowerbirdjs/html`](packages/html)     | Pages → semantic HTML (escaped, URL-sanitised)                                                                                       |
| [`@bowerbirdjs/blocks`](packages/blocks) | Default design tokens, dark theme and starter sections                                                                               |
| [`@bowerbirdjs/agent`](packages/agent)   | Agent tools (`get_context`, `get_outline`, `get_nodes`, `list_sections`, `list_tokens`, `apply`, `undo`) and JSON Schema definitions |
| [`@bowerbirdjs/mcp`](packages/mcp)       | MCP server (stdio), live preview server, CLI with file persistence                                                                   |
| [`bench`](bench)                         | PageBench task format (runner planned)                                                                                               |

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
pnpm lint       # biome
pnpm format     # biome --write
```

Research and design notes: [`docs/research/`](docs/research) and [`docs/plan.md`](docs/plan.md).

## License

[MIT](LICENSE)
