# Decisions and build plan

Date: 17 Nov 2026. This document builds on [`landscape-and-direction.md`](./research/landscape-and-direction.md). Project name: **Bowerbird**. GitHub organisation `bowerbirdjs`, npm scope `@bowerbirdjs/*`, custom elements `<bowerbird-*>`, CSS prefix `bb-`.

## 1. Decisions

| #   | Question         | Decision                                                                                                   | What follows from it                                                                                                                                                                                                            |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Who embeds this? | **Anyone**: SaaS products, CMSs, internal tools, and any app that edits websites or web-app UIs            | No framework lock-in, no backend assumptions (storage and assets go through host adapters), host-registered code components that render inside the host's own runtime, strong permission and theming hooks                      |
| 2   | Styling          | **CSS custom properties**, with no CSS-framework dependency                                                | Tokens compile to CSS variables, sections expose their own variables as their style knobs, and the output is plain CSS (see §3). The earlier Tailwind-shorthand idea is dropped. Tailwind becomes an optional importer at most. |
| 3   | Framework        | **Recommended: web components for the editor, a pure-TypeScript core, and plain HTML/CSS output** (see §2) | One editor build runs in React, Vue, Svelte, Angular or plain HTML                                                                                                                                                              |
| 4   | License          | **MIT**                                                                                                    | No AGPL/GPL dependencies. Lit is BSD-3, which is compatible. Original section library.                                                                                                                                          |
| 5   | Build vs. extend | **Build our own engine**                                                                                   | Phase 0 proves the engine before any UI exists                                                                                                                                                                                  |
| 6   | Canvas           | **Same document, light DOM: no iframe, and no shadow DOM around content**                                  | Container queries handle breakpoints; host components keep their app context (see §2.1)                                                                                                                                         |

---

## 2. Framework recommendation: web components plus a pure-TypeScript core

The project splits into layers, and only one of them, the editor UI, actually needs a UI framework.

| Layer                                                                            | Built with                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core: document, operations, validation, policy, history, agent tools, MCP server | **Pure TypeScript, no DOM**                                                                                                              | Runs in Node, edge, workers and browsers. Agents can edit without a UI.                                                                                                                                                                                                                                                     |
| Sections and primitives                                                          | **Framework-free data**: templates made of primitives                                                                                    | The same section works in every renderer and every host                                                                                                                                                                                                                                                                     |
| Output renderer                                                                  | **Pure TS → semantic HTML and CSS** (light DOM)                                                                                          | Best for SEO, performance and accessibility. Interactive primitives (tabs, accordion) are small light-DOM custom elements that add behaviour on top of working HTML. No shadow DOM in published content.                                                                                                                    |
| Editor UI                                                                        | **Lit 3 custom elements** (`<bowerbird-editor>`). At most **one** shadow root, around the editor panels only, and it can be switched off | One build works everywhere (React 19 has full custom-element support). The panels' boundary shields them from host CSS. CSS variables cross it, so the editor is themable the same way as content, which fits decision 2.                                                                                                   |
| Canvas                                                                           | **A light-DOM element in the host document** (`<bowerbird-canvas>`), never inside an iframe or a shadow root                             | See §2.1                                                                                                                                                                                                                                                                                                                    |
| Host code components                                                             | **Custom elements** as the universal format, plus **native rendering through the framework wrappers** (e.g., React portals)              | Every major framework can compile components to custom elements (Vue `defineCustomElement`, Svelte `customElement`, Angular Elements, Lit, Stencil, React through wrappers). Because the canvas is in the same document, the wrappers can render the host's own components natively, with full access to the app's context. |
| Wrappers                                                                         | Thin `@bowerbirdjs/react` and `@bowerbirdjs/vue` (Svelte and Angular later)                                                              | Typed props and events; render custom fields, panels and code components with the host's own framework                                                                                                                                                                                                                      |

**Why not React-first.**

- It forces a React runtime on Vue, Angular and plain-HTML hosts, which conflicts with decision 1.
- Puck already holds the React-only position, and its most-upvoted issue (#302) asks for multi-framework support. Framework independence is a real differentiator.
- The canvas design in §2.1 is the same either way, so React-first would buy nothing there.

**The costs of web components, and how to handle them.**

| Cost                                                                                                                                                 | Mitigation                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smaller UI-component ecosystem                                                                                                                       | Build editor controls with Lit plus Floating UI. Evaluate Web Awesome (MIT, 3.15, active) for form controls, but expect a small custom set, so theming stays fully under our CSS variables and the bundle stays small. |
| Lit releases slowly (3.3.3, May 2026)                                                                                                                | It is a thin, stable, Google-maintained layer, so the risk is low. Keep state out of Lit: the core store has its own subscription API, so the UI layer could be swapped.                                               |
| ARIA references can't cross shadow roots                                                                                                             | There is at most one shadow root (around the panels), so all internal panels share one tree and references work. Test with Playwright, which reads open shadow roots, and axe.                                         |
| Editing through shadow roots is painful: selection, `elementFromPoint`, event targets and focus are redirected; ProseMirror/Tiptap are fragile there | **Nothing editable lives in shadow DOM.** See §2.1.                                                                                                                                                                    |
| React hosts expect React components for custom fields                                                                                                | `@bowerbirdjs/react` mounts React components into named slots through portals                                                                                                                                          |
| No server rendering of the editor                                                                                                                    | Not needed: the editor is client-only. Output SSR is pure-TS string rendering, not Lit SSR.                                                                                                                            |

**State.** The core exposes `subscribe(selector, cb)` and a transaction event stream, and no signals library leaks into the public API. Lit uses a `ReactiveController`. The React wrapper uses `useSyncExternalStore`. The Vue wrapper uses `shallowRef`.

### 2.1 Canvas: same document, light DOM, no iframe

The page being edited renders directly in the host document as an ordinary light-DOM subtree (`<bowerbird-canvas>`). It is never in an iframe and never inside a shadow root: if the editor panels use a shadow root, the canvas is a slotted light-DOM child. Every standard editing API works normally, including `contenteditable`, Tiptap/ProseMirror, `getSelection`, `elementFromPoint`, `getBoundingClientRect`, MutationObserver and drag and drop. Nodes carry `data-bb-node="hero-1"`, so a click maps straight to a node id.

**How each thing an iframe would provide is handled instead:**

| What an iframe gives                            | Same-document replacement                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real widths for breakpoints                     | Breakpoints compile to **container queries** (§3). The canvas is a container (`container-type: inline-size`) set to the previewed width (e.g., 390, 768 or 1280px), so sections respond exactly as they will when published. Zooming the canvas (`transform: scale()`) doesn't change the container's layout width, so breakpoints stay correct at any zoom.                                 |
| Viewport units (`100vh`)                        | Generated CSS expresses viewport sizes through variables (`--bb-viewport-height`, which defaults to `100vh` in published output). The canvas sets them to the simulated device size.                                                                                                                                                                                                         |
| `position: fixed` / `sticky` (headers, banners) | The canvas uses `contain: layout paint`, which makes it the containing block for fixed elements, so they stick to the canvas instead of the browser window. Sticky elements work because the canvas is the scroll container.                                                                                                                                                                 |
| Content CSS must not leak into the host         | We generate all content CSS, so in editor mode every selector is prefixed with the canvas root (`[data-bb-canvas] .hero`), and tokens are defined on the canvas root instead of `:root`. Published output has no prefix.                                                                                                                                                                     |
| Host CSS must not leak into content             | **Best effort.** A scoped normalise resets common elements under the canvas, and content rules carry the canvas-root prefix so they outrank typical host selectors. In editor mode content CSS is emitted **without cascade layers**, because unlayered host CSS always beats layered CSS whatever its specificity. Host `!important` rules can still leak; this is a documented limitation. |
| Script isolation                                | Content never runs arbitrary scripts inside the editor. `embed` blocks (third-party widgets, custom HTML/JS) show a placeholder or a sandboxed preview of that block alone. This also stops agent-generated content from executing code in the host app.                                                                                                                                     |

**What we gain:**

- **One document.** Drag and drop, keyboard shortcuts, clipboard, focus and accessibility work without bridges between frames.
- **Host components render inside the host's runtime** with access to its context: React context, stores, router, auth, i18n. The React wrapper renders host components into the canvas through portals, which keep that context. This matters most for editing web apps.
- **Host fonts and design-system CSS variables apply naturally**, with no style syncing.
- **Faster start and less memory**, and none of the CSP, same-origin or `srcdoc` problems of iframes.
- Precedent: Craft.js renders in the same document, and Puck's iframe can be switched off.

**What we give up:**

- Host or third-party components that use **viewport media queries** respond to the browser window, not the canvas width. Our own content uses container queries, and the docs ask registered components to do the same.
- Isolation from host CSS is best effort, not guaranteed.
- Exact device fidelity for such components is out of the editing path. If a host ever needs it, an opt-in "device preview" can open the published HTML at a real viewport. The agent's screenshot tool already renders published HTML at real viewports on the server.

**Where each part lives in the DOM:**

| Area                                      | DOM                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas content                            | Light DOM in the host document, with `data-bb-node` ids                                                                                                                                                                                                                 |
| Selection and hover overlays, drag ghosts | A layer inside the canvas scroll container with `pointer-events: none`, so it scrolls with the content                                                                                                                                                                  |
| Editor panels                             | Custom elements, with an optional single shadow root (on by default; `isolation="none"` turns it off)                                                                                                                                                                   |
| Host code components                      | Opaque leaves, selected as a whole and edited through the props panel. Their **slotted children are light DOM**, so content placed in their slots stays fully editable. Their internal template (which may use its own shadow DOM) is implementation, not page content. |
| Published output                          | Plain HTML                                                                                                                                                                                                                                                              |

> If you'd rather keep option value, the only thing that changes with React-first is the editor panels. The core, sections, output, canvas approach and agent API are the same either way, and Phase 0 contains no UI. **The final call on the panels can wait until Phase 1 starts.**

---

## 3. Styling model: CSS custom properties all the way down

There are three levels, each a stable target for humans, agents and host code.

**1. Global tokens.** Authored as DTCG JSON and compiled to variables. Themes are alternate values.

```css
@layer tokens {
  :root {
    --color-brand-600: #4f46e5;
    --color-surface: #ffffff;
    --color-on-surface: #111114;
    --space-sm: 0.5rem;
    --space-lg: 1.5rem;
    --space-3xl: 6rem;
    --text-4xl: 2.5rem;
    --text-5xl: 3.25rem;
    --font-heading: "Inter", system-ui, sans-serif;
    --radius-md: 8px;
  }
  [data-theme="dark"] {
    --color-surface: #0b0b0f;
    --color-on-surface: #f4f4f5;
  }
}
```

**2. Section style contracts.** Each section declares a few named, typed variables whose defaults reference tokens. These are the section's main customization knobs, and they're ideal for panels and agents.

```css
@layer sections {
  .hero {
    --hero-bg: var(--color-surface);
    --hero-fg: var(--color-on-surface);
    --hero-pad-block: var(--space-3xl);
    --hero-gap: var(--space-lg);
    background: var(--hero-bg);
    color: var(--hero-fg);
    padding-block: var(--hero-pad-block);
  }
}
/* instance override: one variable on one node */
@layer overrides {
  [data-bb-node="hero-1"] {
    --hero-bg: var(--color-brand-600);
  }
}
```

**3. Node styles** for fine-grained control. Any node can carry CSS declarations per breakpoint and state. Values must be `var(--token)` references or keywords, and raw values are allowed only if the host's policy permits.

**How agents write styles.** Agents write **plain CSS declarations**, which LLMs know better than any framework:

```json
{
  "op": "style.set",
  "id": "hero-1/heading",
  "bp": "md",
  "css": "font-size: var(--text-5xl); text-wrap: balance"
}
```
The validator parses the declarations and checks:

- the property is allowed for this node type and freedom level;
- every referenced variable exists, with a "did you mean `--text-4xl`?" suggestion if not;
- raw values are rejected unless policy allows them.

**Output details.**

- **Cascade layers in published output** (`@layer tokens, base, sections, overrides`) let host CSS override anything predictably. In editor mode the same rules are emitted with the canvas prefix and without layers (see §2.1).
- **Breakpoints** are mobile-first and compile to **container queries** (`container-type: inline-size` on the page root and on section roots). Sections therefore respond to the width they're given, both on the canvas and inside narrow embedded previews. Viewport media queries are optional. Variables can't be used inside query conditions, so breakpoint widths are compiled in.
- The output is **one plain CSS file** (tokens, section base styles, node rules) plus HTML. A host can re-theme a published page by overriding variables, with no build step.
- **Editor chrome** is themed with its own `--bb-editor-*` variables.

---

## 4. Sections: templates first, linked components later

To keep Phases 0–1 small without losing the "big blocks, full control" goal:

- **Section templates (Phases 0–1).** Inserting a section **expands it into primitive nodes the page owns**. Each part has a stable name, so every part is addressable: `hero-1/heading`, `pricing-1/tier-pro/badge`. There's no override or detach machinery, because everything is already open.
  - The section root remembers `template: "hero@1"`, its variant and its variable contract. The UI can show a "section settings" panel (variables plus key parts), and the agent sees the section as one unit in the outline.
  - Switching variant re-expands the template, keeping each part's content by name.
- **Linked components (Phase 2).** Shared headers and footers and design-system components: instances with props, slots, overrides and detach. Updating the definition updates every instance.

Webflow (layouts vs. components) and Figma (components vs. detached frames) both draw the same line.

**Primitives** (about 10): `box` (tag: section, div, header, nav, footer…), `text` (h1–h6, p, span), `rich-text`, `image`, `link`, `button`, `list`, `icon`, `embed`, `form` (Phase 1+). Each maps to semantic HTML.

**Section definitions are framework-free:**

```ts
export const hero = defineSection({
  name: 'hero',
  version: 1,
  description:
    'Top-of-page introduction: headline, supporting text, primary call to action, optional media.',
  variants: { layout: ['centered', 'split'] },
  vars: {
    '--hero-bg': { type: 'color', default: 'var(--color-surface)' },
    '--hero-pad-block': { type: 'space', default: 'var(--space-3xl)' },
  },
  css: `.hero { background: var(--hero-bg); padding-block: var(--hero-pad-block); }`,
  template: ({ variant }) =>
    box({ tag: 'section', part: 'root', class: 'hero' }, [
      text({ tag: 'h1', part: 'heading' }, 'Your headline'),
      text({ tag: 'p', part: 'subheading' }, 'Supporting copy'),
      link({ part: 'cta', href: '#' }, 'Get started'),
      variant.layout === 'split' && box({ part: 'media', slot: true }),
    ]),
});
```

**Host code components** are registered with a schema, plus a custom-element tag and/or a native renderer supplied through a framework wrapper:

```ts
editor.registry.component({
  name: 'pricing-table',
  tag: 'acme-pricing-table',
  description: 'Live pricing table bound to the billing API.',
  props: z.object({ plan: z.enum(['monthly', 'yearly']), highlight: z.string().optional() }),
});
// React host, rendered natively with the app's context:
// <Editor components={{ 'pricing-table': PricingTable }} />
```

---

## 5. Phase 0: prove the engine (about 3–4 weeks, no visual editor)

**Goal.** An AI agent builds and edits pages through MCP, reliably, while a browser tab shows the live result. A benchmark measures how reliable it is.

| Package  | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core`   | Document types and Zod schemas; readable, type-prefixed ids (`hero-1`); store with `subscribe`; the operations (`section.insert`, `node.insert/move/remove/duplicate`, `props.set`, `text.edit`, `style.set`, `vars.set`, `token.set`, `page.*`); atomic transactions with an actor, label, `baseRevision` and `dryRun`; inverse operations; per-actor undo; policy engine (freedom levels: content / layout / design / code); validation errors that include fix hints; outline serializer and `get_nodes(depth)` |
| `css`    | DTCG tokens → CSS variables and themes; CSS-declaration parser and validator (token existence, allowed properties, raw-value policy); node styles → CSS with container queries, in two modes: **published** (layered) and **editor** (canvas-prefixed, unlayered)                                                                                                                                                                                                                                                  |
| `html`   | `renderPage(doc, pageId) → { html, css }`, a pure function                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `blocks` | About 10 primitives, about 10 sections (nav, hero, logos, features, testimonial, pricing, FAQ, CTA, footer, content), and one default token theme                                                                                                                                                                                                                                                                                                                                                                  |
| `agent`  | Tool definitions (JSON Schema from Zod) and handlers: `get_context`, `outline`, `get_nodes`, `search_catalog`, `apply`, `edit_text`, `import_html`, `lint`, `revert`. A `SKILL.md` agent guide.                                                                                                                                                                                                                                                                                                                    |
| `mcp`    | MCP server (stdio and streamable HTTP) plus a **live preview server** that pushes re-rendered HTML to the browser over server-sent events (SSE), so you can watch the agent work                                                                                                                                                                                                                                                                                                                                   |
| `bench`  | About 30 tasks with automatic checks: build from a brief, precise edits, restyle with tokens, responsive fixes, policy-blocked edits. A runner reports success rate, tokens, cost and latency per model. **The model API key is supplied by whoever runs it** (the Claude API by default; other providers through adapters).                                                                                                                                                                                       |

**Tooling:** pnpm workspaces, TypeScript, tsdown for builds, Vitest, Biome, Changesets, Playwright (screenshots and later end-to-end tests).

**Done when:**

- Claude Code, connected over MCP, builds a five-section landing page from a brief and then makes ten precise follow-up edits with no hand-fixing.
- A frontier model passes at least 90% of bench v0 tasks.
- Every invalid operation returns an error the agent can act on.
- A human can undo the agent's work in one step through the API.

---

## 6. Phase 1: the editor and the showcase (about 6–8 weeks)

> **As built** (see [`progress.md`](progress.md)): drag and drop uses native HTML5 drag and drop instead of `@dnd-kit/dom`; the canvas is a light-DOM child of `<bowerbird-editor>` rather than a separate `<bowerbird-canvas>` element; the showcase is Vite + React instead of Next.js. Storage and asset adapters, the extension API, section thumbnails, the Svelte example and host components rendered on the canvas move to Phase 2.

- **`editor`** (Lit):
  - `<bowerbird-editor>` shell with a **same-document canvas** (`<bowerbird-canvas>`: a container-query viewport with zoom), hover and selection overlays, and drag and drop (`@dnd-kit/dom`) behind an adapter.
  - Panels: layers, section catalog with thumbnails, auto-generated panels for props and variables, a style panel with token pickers.
  - A breakpoint switcher, undo/redo, inline text editing, and a policy-aware UI (locked items explain why).
  - **Host API:** attributes and properties for configuration, DOM events (`bb-transaction`, `bb-selection`, `bb-change`), controlled and uncontrolled modes, adapters for storage and assets, and an extension API for custom fields, panels and code components.
- **Wrappers:** `@bowerbirdjs/react` and `@bowerbirdjs/vue`, including native rendering of host components on the canvas.
- **`showcase`** app (Next.js, the most common host). A fictional events product that embeds the editor. It includes:
  - an in-app agent chat (bring your own key), with agent operations streaming onto the canvas and the agent's presence highlighted;
  - a transaction timeline with "undo agent";
  - a "Connect your own agent" MCP endpoint;
  - role switching (marketer vs. designer);
  - a theme lab (swap token sets);
  - a developer inspector (operations JSON and outline);
  - HTML export.
- **`examples/`:** minimal embeds in plain HTML, Vue and Svelte, which prove decision 1, plus one deliberately "hostile CSS" host page to test isolation.

> **Phase 2 as built:** see [`progress.md`](progress.md). Linked components are stored as linked copies (every instance node points at its definition node) rather than as references expanded at render time, so ids, selection, CSS and every existing op keep working on instances.

Phases 2–3 are unchanged from the landscape document: linked components, draft changesets, provenance protection, screenshots and layout snapshots for agents, Yjs collaboration with agent presence, Tiptap rich text, i18n, data binding, importers (Puck, HTML, Tailwind) and interop (json-render/A2UI catalog export, MCP Apps view, AG-UI).

---

## 7. Needed before scaffolding

1. **A project name and npm scope.** Availability needs checking.
2. **Where the repository lives.** A GitHub repo to push to. This session isn't a git repo yet.
3. **A model API key** for running the benchmark and the showcase's built-in agent. Not needed until the end of Phase 0.
