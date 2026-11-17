<!-- Raw research report: Architecture & technology foundations. Compiled 2026-11-17 by a research sub-agent; see ../landscape-and-direction.md for the synthesis. -->

# Research report: architecture and technology foundations for an embeddable, agent-first visual page editor

*Research date: 2026-11-17. Library versions and release dates come from the npm registry, queried directly today. Some vendor sites could not be fetched from this sandbox (puckeditor.com, tailwindcss.com, loro.dev, designtokens.org). For those I relied on search-engine summaries and on type definitions read from the published npm packages. I ran out of web-search budget near the end, so the last few items are marked as unverified.*

---

## TL;DR

- **Document model:** use a normalized flat map of nodes keyed by id. Each node stores its parent, its slot and a fractional order index. Sections are trees of primitives packaged as **component definitions**, with instances, variants, overrides and detach. Host "code components" are opaque nodes with typed props.
- **Edits:** every change, from humans and agents alike, goes through one closed set of semantic **operations**. Operations are grouped into transactions that record who made them, are checked against policy, and are undone by inverse ops. JSON Patch is an import/export format only.
- **Collaboration:** keep it out of the core. Ship one adapter, either Yjs (mature) or Loro (it has a real movable-tree CRDT). Let agents edit as ordinary participants with their own presence.
- **Schemas:** write one schema per component in Zod 4. From that single source, generate validation, the property panel, and the JSON Schema for LLM tools and MCP, through Standard Schema / Standard JSON Schema.
- **Styling:** store styles as **structured, token-referencing style declarations** per breakpoint and state, not as Tailwind class strings. Tokens use the DTCG 2025.10 format and compile to CSS variables. Import from Tailwind; don't store Tailwind.
- **Rendering:** a framework-agnostic TypeScript core with React first for the renderer and editor. The canvas runs in an iframe. Use Tiptap 3 for rich text and `@dnd-kit/dom` / `@dnd-kit/react` for drag and drop. Seed blocks only from MIT sources (shadcn/ui, HyperUI, Flowbite core, Magic UI free tier). **Tailwind Plus forbids website builders.**

---

## 1. Document model

### How existing editors model the document

| Editor | Shape |
|---|---|
| **Puck** (v0.24.0, 2026-10-29, MIT) | Nested: `Data = { root, content: ComponentData[], zones? }`, where `ComponentData = { type, props: { id, … } }`. Since 0.19, slots store children as arrays inside props ([Puck 0.19](https://puckeditor.com/blog/puck-019)). Sections are opaque React components with props. Migrations use `migrate()` / `transformProps()` helpers (read from the `@puckeditor/core` type definitions). |
| **Webstudio** (`@webstudio-is/sdk` 0.313, 2026-11-15, **AGPL-3.0**) | Fully normalized, as Zod schemas in the SDK. `instances` (`{id, component, tag, children: [{type:'id'|'text'|'expression'}]}`), `props` keyed by `instanceId`, and `styles` as declarations `{styleSourceId, breakpointId, state?, property, value}`. A style source is `token`, `local` or `tag`. `styleSourceSelections` maps each instance to its ordered style sources. Breakpoints are `{minWidth?, maxWidth?, condition?}`. Image values reference assets by id. |
| **Craft.js** | A flat `SerializedNodes` map keyed by id with `parent`, `nodes` and `linkedNodes` (from my own knowledge, partly confirmed in [issue #603](https://www.github.com/prevwong/craft.js/issues/603)). Last release was 0.2.12 on 2025-02-14. The maintainer has asked for funding ([#507](https://www.github.com/prevwong/craft.js/issues/507)). Treat it as **low maintenance**. |
| **GrapesJS** (0.23.9, 2026-11-03, BSD-3) | A component tree serialized like a virtual DOM, plus CSS rules. Symbols are main/instance components with `detachSymbol()`. Devices map to media queries with `mediaCondition` defaulting to `'max-width'`, so it is desktop-first (read from the type definitions). |
| **Builder.io** | Nested blocks. `component: {name, options}` holds a code component. `responsiveStyles: {large, medium, small, xsmall}` holds styles per breakpoint (read from the `@builder.io/sdk-react` 5.4.6 types). |
| **Figma** | `Map<ObjectID, Map<Property, Value>>`. The parent is a property on the child, ordering uses fractional indexing, and the server sets the order of writes and rejects cycles ([Figma multiplayer](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), [ordered sequences](https://www.figma.com/blog/realtime-editing-of-ordered-sequences/)). |
| **tldraw** | A record store keyed by id. Shapes carry `parentId` plus a fractional `index`. Migrations are scoped to a record or to the whole store ([store docs](https://tldraw.dev/sdk-features/store)). |
| **Notion** | Blocks with a downward `content` array of ids and an upward `parent` pointer, which it uses for permissions ([Notion blog](https://www.notion.com/blog/data-model-behind-notion)). |

### Nested tree vs. flat map

A flat map wins for an agent-first editor:

- Ids are stable addresses, so "set prop X on node Y" never relies on array positions that shift under concurrent edits.
- It maps directly onto CRDT maps and onto Figma-style per-property last-writer-wins.
- JSON-Patch paths such as `/nodes/{id}/props/title` become stable.
- Partial reads are cheap: an agent can ask for one section without loading the page.

Google's A2UI agent protocol chose a flat list of components referenced by id for exactly the LLM reason: models struggle to emit a perfectly nested tree in one pass, and ids let them stream components and fix them individually ([A2UI components](https://a2ui.org/concepts/components/), [v0.8 spec](https://a2ui.org/specification/v0.8-a2ui/)).

Keep a **derived nested "outline" view** for LLM context and human debugging. Don't use nesting for storage.

**How to store order:** either `children` id arrays on the parent (Webstudio, Craft) or `parent` plus a fractional index on the child (Figma, tldraw). The second handles concurrent moves and inserts better. Use [`fractional-indexing`](https://www.npmjs.com/package/fractional-indexing) (v4.0.0, 2026-06). Loro's `LoroTree` is a movable-tree CRDT that prevents cycles and can generate fractional indexes ([Loro movable tree](https://loro.dev/blog/movable-tree)).

### How sections relate to primitives

There are two families:

- **Opaque components with props.** Puck, Builder and Plasmic code components work this way. Agents find them easy (`hero.title`) and design stays consistent, but users can't make fine-grained changes beyond the exposed props and slots.
- **Composed of primitives, with component definitions and instances.** Figma, Framer, Webflow, Webstudio and GrapesJS work this way. Instances expose props, slots and variants, and can be **detached/unlinked** into raw primitives. Webflow: "structure and styles can only be edited on the main component", instances vary by props, slots and variants ([Webflow components](https://help.webflow.com/hc/en-us/articles/33961303934611)). Webflow's MCP lets agents unlink instances and manage variants ([changelog 2026-07-21](https://developers.webflow.com/home/changelog/2026/7/21)).

**Recommendation: support both, like Builder and Plasmic do.**

- A **section** is a `ComponentDef` whose body is a primitive subtree. It has an exposed prop schema (title, cta, items[]), named slots, and variant axes such as `layout: split|centered` and `tone: light|dark`.
- Inserting a section creates an **instance**, so agents and simple users edit through props.
- **Overrides** are sparse and keyed by the id of the node inside the definition (`{ [defNodeId]: { props?, styles?, hidden? } }`).
- **Detach** copies the definition tree into the page under new ids, which unlocks full control.
- **Global components / symbols** are the same mechanism with a shared definition. Editing the definition updates every instance.
- **Host code components** stay opaque nodes, validated by their schema.

Plasmic's guidance is a useful default: prefer slots over variants when consumers should supply content ([Plasmic best practices](https://docs.plasmic.app/learn/best-practices/)).

### Pages and site-level data

Store one document per **site**: `pages` (path, SEO metadata, root id), plus site-wide tokens, breakpoints, locales, components and assets. Large sites can lazy-load a page's nodes, which works naturally because the store is a keyed map.

### Versioning and migrations

- Put a `schemaVersion` on the document.
- Give each component definition a `version` and an ordered list of `migrations`, which upgrade props on load, as tldraw and Puck's `transformProps` do.
- tldraw sync goes further: it migrates incoming records up to the server's schema and outgoing diffs down to each client's version ([tldraw collaboration](https://tldraw.dev/sdk-features/collaboration)). This is worth copying if old editor builds and new ones must coexist, which is likely for an embeddable library.

---

## 2. Operations, history and collaboration

### Prior art

- **Puck** dispatches reducer actions addressed by index and zone (`insert`, `move`, `replace`, `remove`, `setData`, …). Its history is a list of **full-state snapshots** (`History { state, id }`). That is simple but makes attribution and merging hard.
- **Webstudio** syncs builder and canvas over `postMessage`, using nanostores and Immer-style patches through `immerhin` ([architecture](https://webstudio.is/blog/webstudios-architecture-an-overview)).
- **tldraw sync** is **server-authoritative with optimistic rebase**, not a CRDT ([tldraw collaboration](https://tldraw.dev/sdk-features/collaboration); third-party analysis by [Grida](https://grida.co/docs/wg/research/crdt/tldraw)).
- **Figma** uses server-ordered per-property last-writer-wins.

### Recommended design

- **A closed set of semantic ops**, listed in §10. Each op addresses nodes by id and is checked against the schema and the permission policy before it applies.
- **Transactions** have the shape `{ id, actor, label, origin, ops[] }`. The core builds an inverse op for every op, which gives undo/redo.
- **Undo is scoped per actor**, so a human can undo "the agent's last change" as one step, like the `trackedOrigins` option in Yjs's UndoManager.
- **JSON Patch** (RFC 6902) is only an interchange format: inputs from external tools, and output for streaming. [`rfc6902`](https://www.npmjs.com/package/rfc6902) 5.4.0 (2026-10) is maintained; `fast-json-patch` has not been released since 2022. Vercel's json-render streams JSON Patch lines for generative UI ([InfoQ, Mar 2026](https://www.infoq.com/news/2026/03/vercel-json-render)). Liveblocks offers a JSON-Patch REST endpoint for agents ([agentic editing](https://liveblocks.io/docs/products/sync/agentic-editing)).

### Collaboration options

| Option | Status (npm, Nov 2026) | Notes |
|---|---|---|
| **Yjs** | 13.6.33 stable. v14 ships as `@y/y`, still RC (14.0.0-rc.30 beta) | Largest ecosystem: Tiptap, Lexical, Hocuspocus 4.8 (MIT). v14 adds attributed history and track changes ([FOSDEM 2026](https://fosdem.org/schedule/event/8VKQXR-blocknote-yjs-prosemirror)). The v13 → v14 API transition is ongoing. |
| **Loro** | 1.18.0 (2026-11-16), stable format since 1.0 ([Loro 1.0](https://loro.dev/blog/v1.0)) | Movable tree CRDT, rich text, version history. `loro-prosemirror` is at 0.4.4. Smaller ecosystem. |
| **Automerge** | 3.5.0 | 3.0 cut memory use by more than 10× ([blog](https://automerge.org/blog/automerge-3/)). Good for document-per-file and offline-first use. |
| **Jazz** | 2.0 is still alpha (2.0.0-alpha.66) | A full database with permissions. Too unstable to build on. |
| **Liveblocks** | Clients Apache-2.0 (3.25.1). `@liveblocks/server` is AGPL, open-sourced Feb 2026, and aimed at local dev/CI so far ([post](https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server)) | "Sync for the agentic web": agents mutate storage server-side (`mutateStorage`) and publish presence (`setPresence`) ([announcement](https://liveblocks.io/blog/introducing-liveblocks-sync-the-sync-engine-for-the-agentic-web)). |
| **PartyKit → PartyServer** | `partykit` CLI unchanged since 2025-05. `partyserver` 0.5.10 (2026-08), `y-partyserver` 2.2.0 | Now Cloudflare-maintained and runs on Durable Objects; the README still calls it a work in progress ([repo](https://github.com/threepointone/partyserver)). |

**Recommendation:** keep the core sync-agnostic. Ops apply to a local store, and a `SyncAdapter` maps them to the CRDT and back.

- Ship `collab-yjs` first, for the ecosystem and Tiptap compatibility. Make tree moves safe with parent plus fractional index, and have the server reject cycles.
- Consider `collab-loro` second, for its native tree semantics.
- For hosted deployments, document Liveblocks and Hocuspocus as backends.

### Agent and human editing at the same time

1. **Agents are actors.** An agent connects as a server-side peer (Yjs/Hocuspocus client, or Liveblocks `mutateStorage`) and submits the same validated transactions a human does.
2. **Presence for agents.** Use awareness/presence fields such as `{actor:'agent', status, selection:[nodeIds], intent}`. The canvas shows an agent "cursor" or outline on the nodes being edited. tldraw's [agent starter kit](https://tldraw.dev/starter-kits/agent) shows an action-schema pattern where actions are validated, sanitized, then applied.
3. **Soft locks:** an agent claims a subtree for the length of a task. Human edits there either win, or are allowed with a warning.
4. **Suggestion mode:** agent transactions land on a branch or as pending changes the human accepts. A CRDT fork, or a stored transaction queue, makes this cheap.
5. **Server-side checks:** the agent's ops pass the same policy engine that guards human edits. A prompt alone does not stop a disallowed change.

---

## 3. Schemas and validation for component props

- **Standard Schema** has a **Standard JSON Schema** extension, `StandardJSONSchemaV1` in `@standard-schema/spec` 1.1.0 (2025-12-15). It offers `~standard.jsonSchema.input/output({target})` with targets draft-2020-12, draft-07 and openapi-3.0 (confirmed from the published `.d.ts`; [standardschema.dev](https://standardschema.dev)).
- Supported by Zod ≥ 4.2, ArkType ≥ 2.1.28, and Valibot ≥ 1.2 through `@valibot/to-json-schema` ([TanStack AI docs](https://tanstack.com/ai/latest/docs/reference/type-aliases/SchemaInput)).
- The **MCP TypeScript SDK** moved its tool schemas to `StandardJSONSchemaV1` ([PR #1473](https://github.com/modelcontextprotocol/typescript-sdk/pull/1473)). `@modelcontextprotocol/sdk` is at 1.32.2 (2026-10-23).
- **Zod 4** (4.6.7, 2026-10) has a native `z.toJSONSchema()` with an `io: "input"` option and `.meta()` / custom registries ([zod.dev/json-schema](https://zod.dev/json-schema)). Use a custom registry for editor metadata: field widget, label, group, inline-editable, `ai.instructions`, `ai.exclude` (Puck has per-field AI instructions/exclusion; [Puck AI configuration](https://puckeditor.com/docs/ai/ai-configuration)).
- **Other libraries:** TypeBox 1.x (`typebox` 1.4.7) is JSON-Schema-native, a good fit if you want JSON Schema as the canonical form. Valibot 1.5 and ArkType 2.2.9 are both maintained.

**Recommendation:**

- Write component prop schemas in **Zod 4** and accept any Standard Schema with JSON Schema support from hosts.
- From each schema, generate: (a) runtime validation of ops, (b) property panels through an AutoField-style mapping, (c) LLM and MCP tool schemas.
- **Don't send the agent one giant recursive page schema.** Anthropic's strict tool use and structured outputs do not support recursive schemas, numeric or length constraints, or `additionalProperties` other than `false`. They do support `$ref`/`$defs`, `anyOf` and `enum` (from Anthropic's structured-outputs documentation, via the bundled Claude API reference). Other providers impose similar subsets.
- Instead, expose **ops as tools** (`insert_section`, `set_props`, …), validate each component's props against its own non-recursive schema, and re-validate on the server with the full schema.

---

## 4. Styling model, tokens and responsive design

### Options

| Approach | Strengths | Weaknesses |
|---|---|---|
| **Tailwind classes** (Chai Builder; most block libraries) | LLMs write them fluently. The shadcn and HyperUI ecosystems use them. | Strings are hard to edit structurally or merge with a CRDT. Arbitrary values bypass tokens. Needs a JIT compiler at edit time. Per-breakpoint panel editing requires parsing. |
| **Structured style declarations** (Webstudio, Builder `responsiveStyles`, Framer, Webflow) | Per-property merges and overrides. Values can be forced to token references. Easy panel UI and diffs. Precise per-breakpoint and per-state layering. | You write your own CSS generator. LLMs need a documented vocabulary. |
| CSS-in-JS at runtime | — | Poor for SSR/RSC and export. Avoid. |

**Recommendation:**

- Store styles as **structured declarations**: `styles[breakpoint][state][cssProperty] = StyleValue`, where `StyleValue = {token:'color.brand.600'} | {unit, value} | {keyword} | {raw}`.
- Generate atomic or scoped CSS, and expose tokens as CSS custom properties.
- Provide a **Tailwind adapter**: parse class strings from block imports and agent shorthand into declarations, and optionally emit Tailwind on export.
- A host **style policy** can forbid `raw` values, so the agent is limited to tokens and stays on-brand. This is enforced in op validation, not in prompts.
- Offer a curated set of section **variants** and **themes** so agents choose among options rather than inventing styles. Puck makes the same "constrained UI" argument ([Puck blog](https://puckeditor.com/blog/ai-slop-vs-constrained-ui)).

### Design tokens

The DTCG **Format Module 2025.10** is the first stable version, published 2025-10-28 together with the Color and Resolver modules (Resolver handles light/dark themes and other contexts). It is a Community Group report, not a W3C standard ([announcement](https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/), [TR 2025.10](https://www.designtokens.org/tr/2025.10/)).

- Use DTCG JSON as the theme format.
- Tooling: Style Dictionary 5.8 (2026-11) and Terrazzo 2.10 (2026-10).
- Map themes to Resolver "contexts". Plasmic's global variants are a precedent ([docs](https://docs.plasmic.app/learn/global-variants/)).

### Breakpoints

How others handle them:

- **Webflow:** styles cascade both ways from a desktop base ([help](https://help.webflow.com/hc/en-us/articles/33961260724243)).
- **Framer:** other breakpoints inherit from the primary breakpoint unless overridden ([academy](https://framer.com/academy/lessons/breakpoints)).
- **Plasmic:** screen variants are a global variant group ([docs](https://docs.plasmic.app/learn/responsive-design/)).
- **GrapesJS:** desktop-first max-width media queries.
- **Builder:** fixed large, medium, small and xsmall.
- **Webstudio:** user-defined min or max widths, or a custom `condition`.

**Recommendation:** use a **mobile-first base with sparse overrides**, CSS-like and predictable for LLMs. A site has an ordered list of breakpoints. Each breakpoint has a `kind` of `viewport` or `container`. **Section roots default to container queries** (`container-type: inline-size`), because embedded hosts often render previews in narrow panes. Container queries are in Tailwind v4 core, but I could not confirm this on tailwindcss.com because the site is blocked here.

---

## 5. Rendering and framework coupling

- **Framework coupling:** GrapesJS and the tldraw store are framework-agnostic at the core. Puck, Craft, Chai and Plasmic are React-only. Builder's Mitosis (0.14.2, 2026-10) compiles components to many frameworks.
- **Recommendation:**
  - Keep the **core, ops, schema, CSS generation and HTML serializer in pure TypeScript**.
  - Ship **React** first for both the renderer and the editor UI.
  - Primitives render trivially in any framework. Code components are framework-specific by nature.
  - A web-components renderer can come later. Don't build Mitosis-style compilation.
- **Iframe canvas:** Puck (with `iframe.syncHostStyles`), GrapesJS and Webstudio all use one. It gives CSS isolation from the host app and **real viewport widths, which viewport media queries need**. The cost is cross-frame drag and drop, overlays, and event bridging. Put the editor chrome and overlays in the host document and compute rectangles from the iframe's elements.
- **SSR, RSC and static output:**
  - Make the renderer a pure function of `(doc, registry)`. Puck ships an `rsc` entry exporting `Render`, `resolveAllData`, `migrate` and `walkTree`.
  - Provide `renderToHTML()` for static export.
  - Webstudio exports projects to a framework app through its `webstudio` CLI.
- **Code export / round-trip:** offer one-way export (JSX + CSS, or a shadcn-registry format). True code ↔ visual round-tripping (Builder Fusion; Onlook-style editors) is a different product. Don't promise it.

---

## 6. Inline rich text

| Library | Status | Fit |
|---|---|---|
| **Tiptap 3** (ProseMirror) | `@tiptap/core` 3.34.0 (2026-11-13), MIT core | Puck uses it for its rich-text fields. `@tiptap/static-renderer` renders JSON to React or HTML **without an editor or DOM** ([docs](https://tiptap.dev/docs/editor/api/utilities/static-renderer)). Yjs binding available. |
| Lexical | 0.53.0 (2026-10-28), still pre-1.0 | Strong JSON serialization and headless mode ([docs](https://lexical.dev/docs/serialization/)). Smaller ecosystem for fields embedded inside other components. |
| Plate (Slate) | `platejs` 53.5.2, Slate 0.147 | React-only and heavy. Good AI features. Slate is still 0.x. |
| BlockNote | 0.57.0, MPL-2.0 core; **XL packages (AI, multi-column) GPL-3.0 or commercial** ([license](https://www.blocknotejs.org/legal/blocknote-xl-commercial-license)) | A Notion-style document editor. Too opinionated for inline fields. |

**Recommendation:**

- Use **Tiptap 3**.
- Store rich-text props as **ProseMirror JSON limited to a per-field schema** (allowed marks and node types come from the prop schema).
- Most short fields, like headlines and button labels, are plain inline text in a lightweight `contenteditable`; Puck also has inline text fields.
- In collaborative mode, each rich-text prop maps to a `Y.XmlFragment` (or LoroText).
- Agents send Markdown or an HTML subset, which is converted to JSON on the server and validated against the field schema.

---

## 7. Drag and drop and canvas interaction

- **`@dnd-kit/dom` / `@dnd-kit/react`** (the new dnd-kit): 0.5.3 (2026-10-31), still 0.x, released actively. It supports dragging across same-origin iframes ([repo](https://github.com/clauderic/dnd-kit)). Puck 0.18+ built its grid/flex-aware engine on it and pins 0.4.0 ([Puck 0.18](https://puckeditor.com/blog/puck-018)). The legacy `@dnd-kit/core` has not been released since 6.3.1 (Dec 2024).
- **Pragmatic drag and drop**: 4.0.0 (2026-09-24), Apache-2.0. Built on native HTML5 drag and drop, framework-agnostic, and good for external file drops. It inherits native limits on drag previews and cursors ([constraints](https://atlassian.design/components/pragmatic-drag-and-drop/web-platform-design-constraints)). I could not verify how well it handles iframes.
- **react-dnd**: last release 2022. Avoid.

**Recommendation:**

- Use **@dnd-kit/dom** wrapped behind your own `DndAdapter`, since it is pre-1.0, with custom collision detection for slots and grid/flex layouts.
- Draw selection, hover and resize handles as a custom overlay layer, using ResizeObserver, MutationObserver and the iframe's `getBoundingClientRect`.
- Use **Floating UI** (`@floating-ui/dom` 1.8, 2026-07) for toolbars.
- `react-moveable` is stale (last release 2023).
- Resize handles should write style declarations at the active breakpoint (width/height/gap/padding tokens), snapping to the token scale.

---

## 8. Sources for the section library and licensing

| Source | License | Can you ship it as builder blocks? |
|---|---|---|
| shadcn/ui (incl. blocks) | MIT ([LICENSE](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)) | **Yes**, keep the notice. Best structural seed. |
| HyperUI | MIT ([repo](https://github.com/markmead/hyperui)) | **Yes** |
| Flowbite (open-source core) | MIT ([repo](https://github.com/themesberg/flowbite)) | Core yes. **Flowbite Pro/Blocks terms unverified.** |
| Magic UI (free) | MIT ([repo](https://github.com/magicuidesign/magicui)) | Yes. Pro is separate. |
| daisyUI | MIT | Yes, but it is a component-class layer, not sections. |
| Once UI core | MIT ([repo](https://github.com/once-ui-system/core)) | Core yes. Some templates are **CC BY-NC** (e.g., magic-portfolio). |
| Preline UI | MIT plus a "Fair Use License" ([LICENSE](https://github.com/htmlstreamofficial/preline/blob/main/LICENSE)) | Page builders are allowed **with attribution**, provided they are **not marketed as competing with Preline**. Pro forbids "generators". Use with caution. |
| **Tailwind Plus** | Commercial | **No.** The license explicitly excludes "website builder" projects where end users build sites from its components ([license](https://tailwindcss.com/plus/license)). |
| Aceternity UI | Custom license; the MIT claim is unconfirmed ([licence](https://ui.aceternity.com/licence)) | Avoid redistributing. |
| Relume | Commercial ([agreement](https://www.relume.io/legal/licensing-agreement)) | Avoid (terms not fully read). |

**Recommendation:** build an **original block library** on your own primitives and tokens. Use MIT sources as structural references and keep a NOTICE file. Never copy Tailwind Plus or Relume markup, including into training examples or prompts for the agent.

---

## 9. Packaging and the host API

- **Monorepo:** pnpm + Turborepo + Changesets. The package layout is in §10.
- **Headless core with optional UI.** Provide a `createEditor()` store object, in the style of tldraw and Lexical, plus a React shell with replaceable panels. Puck's `overrides` and plugins (`Plugin { overrides, fieldTransforms, render }`) are good precedent.
- **Controlled vs. uncontrolled:**
  - Support `defaultDocument` and `onChange` (debounced), like Puck's `data` / `onChange` / `onPublish`.
  - **The main integration point is an operation stream:** `editor.on('transaction', tx => …)` for persistence, audit and analytics.
  - Fully controlled mode, where the host replaces the whole document on every change, should be optional because it is expensive.
- **Events:** transaction, selection, presence, validation-error, publish, asset-requested.
- **Permissions and locking:**
  - Precedents: Puck's `permissions {drag, duplicate, delete, edit, insert}` plus `resolvePermissions`; GrapesJS's `removable`, `draggable`, `droppable`, `stylable: string[]`, `locked`; Webflow's MCP, which inherits the user's roles.
  - Implement a **policy engine in the core**. It evaluates `(actor, op, node)` and supports locks on node, prop and style property, allowed child types per slot, and separate capability scopes for agents.
- **i18n:** two separate concerns.
  - Editor UI strings: a dictionary, as Puck added in 0.23.
  - Content: props flagged `localized` are stored as per-locale overlays, the same way breakpoint overrides are.
- **Assets:** the host provides an adapter with `upload`, `resolve(ref) → url`, `search` and `transform`. The document stores asset ids, as Webstudio does.
- **Plugins:** `{ name, components?, fields?, panels?, commands?, opMiddleware?, agentTools? }`. Op middleware (validate, transform, reject) gives hosts policy hooks.
- **Agent surface:** an `@x/agent` package that builds tool definitions and context, and an `@x/mcp-server` wrapping the same core.
  - Competitors already do this: Puck AI 0.8+ (cloud-hosted; `@puckeditor/plugin-ai` has **no OSS license field**), Webflow's MCP Designer tools, GrapesJS's AI Chat plugin ([post](https://grapesjs.com/blog/ai-chat-plugin-visual-editor-integration)), and Plasmic MCP.
  - An open, self-hostable agent API is a real point of difference.

---

## 10. Recommended stack and architecture sketch

### Packages

- `@x/core`: types, Zod schemas, store, ops, transactions, inverse ops/undo, policy engine, migrations, queries, outline serializer.
- `@x/css`: style declarations → CSS, DTCG tokens → CSS variables, Tailwind import.
- `@x/richtext`: Tiptap 3 schema factory and static rendering.
- `@x/react`: `<Render>`, safe for SSR/RSC.
- `@x/editor`: React shell, iframe canvas, overlays, dnd-kit adapter, panels; themable with CSS variables.
- `@x/collab-yjs` (later `@x/collab-loro`).
- `@x/agent`: tool schemas, op validation, context builder, screenshot hook.
- `@x/mcp-server`.
- `@x/blocks`: primitives and the section library.
- `@x/export`: HTML, JSX, shadcn registry.
- `apps/showcase` (Next.js) and `apps/docs`.

### Core types

```ts
type NodeId = string; type CompId = string; type BpId = string;

interface SiteDoc {
  schemaVersion: number;
  pages: Record<string, { id: string; path: string; rootId: NodeId; meta: Record<string, unknown> }>;
  nodes: Record<NodeId, Node>;                 // all pages + component bodies
  components: Record<CompId, ComponentDef>;    // sections & global symbols
  tokens: DTCGTokenFile; themes?: Record<string, DTCGResolverContext>;
  breakpoints: { id: BpId; kind: 'viewport' | 'container'; minWidth?: number; condition?: string }[];
  locales: { default: string; others: string[] };
}

interface Node {
  id: NodeId;
  type: string;                    // 'Box' | 'Text' | 'Image' | code component | '$instance'
  parent: NodeId | null; slot?: string; order: string;  // fractional index
  props: Record<string, PropValue>;
  styles?: Partial<Record<BpId, Partial<Record<StateKey, Record<string, StyleValue>>>>>;
  instance?: { of: CompId; variant?: Record<string, string>;
               overrides?: Record<NodeId, { props?: Record<string, PropValue>; styles?: Node['styles']; hidden?: boolean }> };
  meta?: { name?: string; lock?: LockSpec };
}

type PropValue = JsonValue | { $token: string } | { $asset: string } | { $rich: PMDoc }
               | { $loc: Record<string, JsonValue> } | { $bind: string };
type StyleValue = { token: string } | { unit: string; value: number } | { keyword: string } | { raw: string };

interface ComponentDef {
  id: CompId; name: string; version: number; rootId: NodeId;
  props: StandardJSONSchemaV1; slots: string[];
  variants: Record<string, string[]>; migrations: Migration[];
}
```

### Operations

```ts
type Op =
  | { op: 'node.insert'; node: NewNode; parent: NodeId; slot?: string; before?: NodeId }
  | { op: 'section.insert'; component: CompId; parent: NodeId; before?: NodeId; props?: object; variant?: object }
  | { op: 'node.move'; id: NodeId; parent: NodeId; slot?: string; before?: NodeId }
  | { op: 'node.remove' | 'node.duplicate'; id: NodeId }
  | { op: 'prop.set'; id: NodeId; key: string; value: PropValue; locale?: string }
  | { op: 'prop.unset'; id: NodeId; key: string }
  | { op: 'style.set'; id: NodeId; bp: BpId; state?: StateKey; prop: string; value: StyleValue | null }
  | { op: 'text.set'; id: NodeId; key: string; doc: PMDoc | string /* md */ }
  | { op: 'instance.variant' | 'instance.override' | 'instance.detach' | 'instance.resetOverrides'; id: NodeId; [k: string]: unknown }
  | { op: 'component.create' | 'component.update'; [k: string]: unknown }
  | { op: 'token.set'; path: string; value: unknown }
  | { op: 'page.create' | 'page.update' | 'page.remove'; [k: string]: unknown };

interface Transaction { id: string; actor: { kind: 'user' | 'agent' | 'system'; id: string };
                        origin: 'ui' | 'agent' | 'api' | 'remote'; label?: string; ops: Op[]; dryRun?: boolean }
```

### Agent and MCP tools

- `get_site_outline`, `get_node(id, depth)`
- `list_components`, which returns each component's JSON Schema, variants and description
- `list_tokens`
- `apply_transaction(ops, dryRun)`, which returns structured validation and policy errors
- `render_preview(pageId, bp)`, which returns a screenshot
- `undo_actor`

Each prop schema is flat and non-recursive. Tree structure is expressed through ops.

### Key trade-offs

1. **Flat map + ops is more machinery than Puck's nested JSON**, but it gives you stable addressing, concurrent editing, fine-grained permissions and per-actor undo, which an agent-first editor needs.
2. **Structured styles instead of Tailwind** gives up some LLM fluency in exchange for token enforcement, CRDT merges and panel UX. A Tailwind import adapter recovers most of that fluency.
3. **The section-as-component-with-detach model** is complex to build (override resolution, detach, migrations), but it delivers both "agent edits props" and "designer edits pixels".
4. **An iframe canvas** gives accurate breakpoints and isolation at the cost of complex cross-frame drag and drop.
5. **Pre-1.0 dependencies** (`@dnd-kit/dom` 0.5, Lexical, Yjs v14) need adapter layers. Tiptap 3, Zod 4 and Loro 1.x are stable.
6. **License hygiene:** keep the core MIT. Avoid AGPL dependencies (Webstudio, the Liveblocks server) and GPL dependencies (BlockNote XL) in shipped packages.

---

## Things I could not verify

- **Unreachable sites:** puckeditor.com, tailwindcss.com, loro.dev and designtokens.org could not be fetched from this sandbox. Facts about them come from search-engine summaries, or from npm type definitions and changelogs where noted.
- **License terms not fully read:** Flowbite Pro/Blocks, the full Relume agreement, and Aceternity's free-tier terms.
- **Unconfirmed claims:** Pragmatic DnD inside iframes; the exact Tailwind v4 container-query syntax; Webflow's "unlink" wording (from a mirror site); Builder Fusion's "100% open source" claim; tldraw production pricing; Puck AI internals; Chai Builder's data model.
- **Not researched:** WebMCP status. My web-search budget ran out. A follow-up message can continue the searching.
