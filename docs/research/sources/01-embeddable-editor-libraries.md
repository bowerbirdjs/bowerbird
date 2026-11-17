<!-- Raw research report: Embeddable visual editor libraries & SDKs. Compiled 2026-11-17 by a research sub-agent; see ../landscape-and-direction.md for the synthesis. -->

I covered about 30 tools. Two limits on the sources: puckeditor.com, grapesjs.com and other vendor doc sites are blocked in this session's network, and the shared web-search budget ran out partway through. The facts below come from GitHub pages, the npm registry (versions and dates) and the type definitions and offline docs inside the published npm packages, plus earlier search results. Where something comes from search only or from memory, it says so.

# Competitive landscape: embeddable visual page-builder libraries and SDKs (as of 2026-11-17)

## 1. Comparison table

| Tool | License / business | Stars · latest release | Framework | How a page is stored | Nesting | Styling / responsive | Renders outside editor | Programmatic API / history | AI / agents |
|---|---|---|---|---|---|---|---|---|---|
| **Puck** | MIT core. Paid Puck Cloud adds AI, a pages API and auth. | 13.7k · `@puckeditor/core` 0.24.0 (2026-10-29); 0.25 canaries daily | React only | `{root, content[], zones}`. Each component is `{type, props:{id,…}}`. | `slot` fields hold child arrays inside props, with allow/disallow lists | **None built in.** Viewports are only preview widths. | `<Render>`, including React Server Components; `resolveAllData` | `dispatch(PuckAction)` addressed by index/zone; `history.back/forward/setHistories`; pure `walkTree`, `transformProps`, `migrate` | Puck AI: closed source, cloud-hosted, OpenAI models, bring-your-own-key. Has a headless `generate()` and an agent-oriented CLI. No MCP server found. |
| **GrapesJS** core | BSD-3 | 26.4k · 0.23.9 (2026-11-03), still 0.x | Framework-agnostic (Backbone), works on HTML/CSS | Project JSON: pages → frames → component tree, plus a separate array of CSS rules | Any DOM nesting; symbols (reusable synced components) | Style Manager writes CSS rules per selector, with media queries per device | `getHtml()`/`getCss()` | `headless: true` mode, UndoManager, full JS API, DataSources | None in core |
| **GrapesJS Studio SDK** | Proprietary license key; free tier plus enterprise | `@grapesjs/studio-sdk` 1.2.1 (2026-08-27) | Same as core, plus a React renderer plugin | Same as core | Same as core | Same as core, plus Tailwind | Same as core | Same as core | AI Chat plugin. The agent streams **HTML/Tailwind** into the canvas. Bring-your-own provider key. |
| **Craft.js** | MIT | 8.8k · 0.2.12 (2025-02-14). **No commits since Feb 2025.** | React | Flat map of nodes (`ROOT`, `nodes[]`, `linkedNodes{}`) | `isCanvas` nodes and linked nodes | You build it yourself | No SSR and no HTML export (both among top open issues) | `actions`/`query`, undo/redo with throttle/ignore | None |
| **Builder.io** | SDKs MIT; editor is SaaS. Embedding the editor needs an enterprise contract. | 8.9k · `sdk-react` 5.4.6 (2026-11-17) | React, Vue, Svelte, Qwik, React Native and others | `BuilderBlock` JSON with `responsiveStyles` | `children` | Style panel stores styles per breakpoint: large / medium / small / xsmall | SDK fetches content and renders it, with SSR | REST content/write APIs | Fusion (AI on your codebase) and a Builder Code MCP server for agent runs, projects and branches |
| **Plasmic** | MIT outside `platform/`; AGPL for `platform/`. Hosted Studio. | 7.2k · `loader-react` 2.0.26 (2026-11-12) | React (runtime loader or code generation) | Studio's internal model, delivered as bundles | Slots, but the AI tooling can't nest them | Full style panel, variants, tokens, breakpoints | Loader or generated code | Only through Studio | MCP means `chrome-devtools-mcp` driving `window.PLASMIC_AI_TOOLS` (`read`, `insertHtml`, `changeElement`) in a browser |
| **Makeswift** | Runtime MIT; editor is SaaS (owned by BigCommerce) | 248 · runtime 0.29.3 (2026-11-10) | React/Next.js; React Router, Hono and Vite RSC are experimental | Hosted | `Slot` control | `Style` control with per-device values | Runtime renders the hosted data | REST API (narrow) | MCP server covers the docs only and can't edit sites |
| **Webstudio** | AGPL plus hosted SaaS | 9.2k · 0.313.0 (2026-11-15) | A builder app, not a library; exports to React Router/Remix | Normalised tables (instances, props, styles …), validated with Zod | Full DOM tree; "content blocks" | Webflow-style full CSS, tokens, breakpoints and states | CLI export or self-hosting | Data schema in `@webstudio-is/sdk` | None found |
| **ChaiBuilder Core** (new) | BSD-3; there is a paid "pro" edition | 495 · `@chaibuilder/core` 0.1.0 (2026-11-16); the old `sdk` repo is archived | Next.js 15.3+, React 19, Tailwind 4 | Blocks carrying a Tailwind `styles` prop | Wrapper blocks | Tailwind classes | Server render entry points | Not documented | Vercel AI SDK; per-block `aiProps`; the vendor's site says an MCP server is included |
| **Gutenberg** (WordPress block editor) | GPL | 11.8k · `@wordpress/block-editor` 20.0.0 (2026-11-04) | React editor tied to WordPress; rendering in PHP | HTML with JSON block comments | InnerBlocks, `allowedBlocks`, `parent`/`ancestor` | `supports` plus theme.json presets/tokens | Saved markup or PHP render | `wp.data` dispatch and REST API | Abilities API and MCP Adapter (WordPress 6.9/7.0) |

## 2. Per-tool notes

### Puck — the closest direct competitor
- **Package and activity.** It moved from `@measured/puck` (last release 0.20.2, Sept 2025) to `@puckeditor/core`. Since then: 0.21 (Jan 2026) added a richtext field and slot `as`; 0.22 (June) added CSS-variable theming; 0.23 (Aug) reworked drag-and-drop and added a Dictionary/i18n API; 0.24 (Oct 29) added field groups/tabs, checkbox fields and drag handles. Slots arrived in 0.19 (June 2025) and replaced DropZones; `migrate()` converts old data.
  - https://github.com/puckeditor/puck/releases
  - CHANGELOG inside the npm package
- **Data model** (the slot `actions` is stored inside props; its zone id is `"Hero-8f2a:actions"`):
  ```json
  {"root":{"props":{"title":"Home"}},
   "content":[{"type":"Hero","props":{"id":"Hero-8f2a","title":"Ship faster",
     "actions":[{"type":"Button","props":{"id":"Button-11c0","label":"Start"}}]}}],
   "zones":{}}
  ```
- **Component config.** Each component has `fields`, `defaultProps`, `render`, `resolveData`, `resolveFields` and `resolvePermissions`. Permissions are drag / duplicate / delete / edit / insert.
- **Field types.** text, textarea, number, select, radio, checkbox, array, object, external, custom, slot, richtext.
- **Plugins.** A plugin is `{name, label, icon, render, overrides, fieldTransforms}`.
- **Editing API.** `PuckAction` includes insert, move, replace, remove, setData and others. They are addressed by `destinationZone` + index, and they need a mounted editor.
- **Styling.** There is no style system at all. The canvas is an iframe that syncs the host app's CSS (offline docs bundled in `@puckeditor/cli/dist/docs`).
- **Puck AI.** Timeline: closed beta Nov 6, 2025; headless `generate()` in 0.3; file attachments in 0.7 (May 2026); 0.8 (July 28, 2026) added a new agent, "design mode", bring-your-own-key and four pricing plans. (Dates from search results; the blog itself was blocked.) https://puckeditor.com/blog/puck-ai-08
  - From the 0.9.0 type definitions (2026-11-11): `@puckeditor/plugin-ai` ships with **no license file**, and `@puckeditor/cloud-client` exposes `generate({prompt, config, pageData, context, tools, fieldTypes, mode, maxIterations ≤50, model:`openai/…`})`.
  - Each component and field can carry an `ai` block: `instructions`, `exclude`, `required`, `stream`, a JSON `schema`, and `bind`.
  - The agent streams operations addressed by component id: `add{id,index,zone,type,props}`, `update{id,props,appends}`, `updateRoot`, `move`, `delete`, `duplicate`, `reset`. It can also ask the client for `getPageData` and `takeScreenshot`.
  - "Design mode" lets the AI invent new components and store them in `root.props._dynamicConfig`; `withDynamicConfig()` renders them.
  - `@puckeditor/cli init --yes --json` is "built for coding agents".
- **Most-upvoted open issues.** Multi-framework support #302, field validation #362, image uploader #13, official Grid component #843, copy/paste between editors #1113, canvas zoom #1666, a separate Render package #636, error boundaries #1211. https://github.com/puckeditor/puck/issues?q=is%3Aissue+is%3Aopen+sort%3Areactions-%2B1-desc

### GrapesJS and GrapesJS Studio SDK
- **Core.** The project data type is loosely typed (`ProjectData {[key:string]: any}`). The docs say to persist the JSON, not the HTML. Abridged shape (from memory):
  ```json
  {"pages":[{"frames":[{"component":{"type":"wrapper","components":[{"type":"text","attributes":{"id":"i3k9"},"components":[{"type":"textnode","content":"Hello"}]}]}}]}],
   "styles":[{"selectors":["#i3k9"],"style":{"padding":"40px"}},{"selectors":["#i3k9"],"atRuleType":"media","mediaText":"(max-width: 768px)","style":{"padding":"16px"}}],
   "assets":[],"symbols":[],"dataSources":[]}
  ```
  - Components are defined with model/view types and "traits" (property controls).
  - Old top complaints are mostly closed: the text component/RTE, a jQuery bounty, namespaced CSS, a memory leak, the deprecated backbone-undo.
  - https://github.com/GrapesJS/grapesjs/blob/dev/docs/modules/Storage.md
- **Studio SDK.**
  - **License.** Proprietary: revocable, may require a key, may show a watermark, can't be redistributed standalone. https://github.com/GrapesJS/studio/blob/main/LICENSE.md
  - **Pricing.** Search snippets mention a free plan (1,000 sessions/month) and an enterprise tier. Not verified. https://grapesjs.com/sdk/pricing
  - **Plugins.** `@grapesjs/studio-sdk-plugins` 1.0.39 includes `aiChat`, `rendererReact`, `canvasScreenshot`, `dataSourceHandlebars`, `listPagesComponent`, `presetBlockLibrary` and others.
  - **AI tools.** `addNewComponent{plan, componentId, position}`, `editComponent`, `removeComponent`, `moveComponent`, `getPageContent`, `addNewPage`, `listPages`, `fetchWebsite`, `generateImage`, `runCommand(showCode|importCode|publish…)`. The server prompts include `getTailwindInstructions()`, so the model writes HTML and Tailwind rather than structured component data.

### Craft.js, Reka.js, Easyblocks — effectively dormant
- **Craft.js.** Stored data, from its types:
  ```json
  {"ROOT":{"type":{"resolvedName":"Container"},"isCanvas":true,"props":{"padding":20},"parent":null,"nodes":["n1"],"linkedNodes":{},"hidden":false,"custom":{}},
   "n1":{"type":{"resolvedName":"Text"},"isCanvas":false,"props":{"text":"Hi"},"parent":"ROOT","nodes":[],"linkedNodes":{}}}
  ```
  - Top open issues: HTML export #42 (38 👍), "Future of Craft.js" #507, cloning a node tree, SSR #200/#140.
  - Last commit Feb 14, 2025. https://github.com/prevwong/craft.js
- **Reka.js** (same author). An AST-based state with expressions, externals and Yjs collaboration. 808 stars; last release Jan 2025. https://github.com/prevwong/reka
- **Easyblocks.** AGPL. "No-code components" with variants and constraints. 582 stars; last commit Jul 24, 2024. https://github.com/easyblockshq/easyblocks

### Builder.io
- **Block format**, from `BuilderBlock` in sdk-react:
  ```json
  {"@type":"@builder.io/sdk:Element","id":"builder-3f1","component":{"name":"Hero","options":{"title":"Ship faster"}},
   "responsiveStyles":{"large":{"paddingTop":"80px"},"small":{"paddingTop":"32px"}},"bindings":{},"children":[]}
  ```
- **Components.** Registered with `registerComponent` and an `inputs` list. "Components-only mode" restricts editors to your own components.
- **Not embeddable.** The editor is hosted. Staff on the forum point non-enterprise customers to a link to the hosted editor instead, and one user reported the documented embed web component didn't work. https://forum.builder.io/t/is-it-possible-to-embed-the-builder-interface-in-a-next-js-app/4989
- **AI.** The Builder Code MCP server (`mcp.builder.io/mcp/fusion`) targets agent work on code, not editing page content. https://www.builder.io/c/docs/builder-code-mcp-server
- **Agent-Native.** An open-source TypeScript framework, beta Oct 2026, built around a shared "action layer" for humans and agents. It's a good idea to copy. https://www.openpr.com/news/4661957/builder-io-launches-agent-native-an-open-source-typescript

### Plasmic
- **How the agent connects.** Through `chrome-devtools-mcp` (`evaluate_script`, `take_screenshot`) calling `window.PLASMIC_AI_TOOLS`.
- **Agent API.** `identify()`, `_meta` (each tool's description and inputSchema), `read`, `insertHtml` (HTML that may contain `<plasmic-component data-props>`), `changeElement`.
- **Agent constraints.** Flexbox only (no CSS Grid); tokens referenced as `var(--token-<uuid>)`; breakpoints written as `@media` rules; slots can't be nested; big changes to widely used components need user approval.
- https://raw.githubusercontent.com/plasmicapp/plasmic/master/ai/skills/plasmic-designer/SKILL.md
- https://docs.plasmic.app/learn/plasmic-mcp/

### Makeswift
- **Controls.** `runtime.registerComponent` with Checkbox, Color, Combobox, Font, Group, IconRadioGroup, Image, Link, List, Number, RichText, Select, Shape, Slider, **Slot**, **Style**, StyleV2 (unstable), TextInput (from the 0.29.3 types).
- **Platform.** The editor and data are hosted.
- **MCP.** The MCP server (Sept 28, 2026) only searches the docs. https://docs.makeswift.com/developer/changelog

### Webstudio
- **Not a library.** It's an app (Webflow alternative) you can self-host or export with its CLI.
- **Data model.** The schema in `@webstudio-is/sdk` 0.313 is normalised into tables: `instances`, `props`, `styleSourceSelections`, `styles`, `breakpoints`, `dataSources`, `resources`. Each style declaration is keyed by (`styleSourceId`, `breakpointId`, `state?`, `property`).
- **Licensing.** AGPL, and the animation package is under a proprietary EULA, so it can't be embedded in proprietary products. https://github.com/webstudio-is/webstudio

### Newer and adjacent projects
- **ChaiBuilder Core.**
  - `registerChaiBlock(Component, {type, label, group, props: registerChaiBlockProps(...), i18nProps, aiProps})`; Tailwind via `stylesProp("…")`; AI through the Vercel AI SDK. https://github.com/chaibuilder/core
  - The vendor page claims an MCP server, and says agent changes are saved as drafts for human review and limited to that user's permissions. Not confirmed in the README. https://www.chaibuilder.com/open-source
- **Silex.** AGPL, built on GrapesJS, v3.10.0 (2026-11-13). Silex Desktop (alpha) runs an MCP server at `localhost:6807/mcp`, tuned for small local models; tool names aren't documented. https://github.com/silexlabs/Silex
- **json-render** (Vercel Labs). Apache-2.0, about 19.8k stars, 0.23.1 (2026-11-16).
  - It has a component catalog (Zod props plus descriptions), a flat `{root, elements}` map, streamed patches, and about 15 renderers.
  - **It has no visual editor.** It's the strongest evidence of demand for "AI writes constrained JSON". https://github.com/vercel-labs/json-render
- **A2UI** (Google). An Apache-2.0 spec where the agent emits declarative JSON validated against client catalogs. v0.8 used JSONL; v1.0 is a candidate. https://a2ui.org/specification/v1.0-a2ui/
- **Onlook.** 27.2k stars, Apache-2.0. A desktop app that edits code through Claude Code or Codex, not an embeddable library. https://github.com/onlook-dev/onlook
- **Destack.** 1.8k stars; dormant since 2024.
- **Webflow MCP 2.0** (July 21, 2026). The SaaS benchmark for agents editing live sites. https://webflow.com/updates/introducing-mcp-2-0

### Email builder SDKs (business-model reference)
- **Pattern.** A thin open-source wrapper (Unlayer `react-email-editor`, MIT, 5.3k stars; `@beefree.io/sdk`, Apache-2.0, 11.8.0 on 2026-11-05) around a **hosted proprietary editor**. Auth is a projectId or clientId/secret, with a free tier and usage-based plans.
- **API.** `loadDesign`, `saveDesign`, `exportHtml`; designs are row/column/module JSON.
- **Not verified:** 2026 AI or MCP features, pricing, and anything about Stripo.

### CMS visual-editing layers
- **Payload** (45.9k, MIT, 3.94.0). The `blocks` field stores `{blockType: slug, blockName?, …fields}`; block references are reusable; there's live preview.
- **TinaCMS** (13.9k, Apache-2.0). Git-backed; blocks use `_template` (from memory).
- **Contentful Experiences SDK** (3.8.11). `ComponentDefinition{id, variables{type, group:'style'|'content', validations, description}, slots, builtInStyles, children}`; plus `defineDesignTokens`, `defineBreakpoints` (mobile-first or desktop-first), and **patterns** with exposed parameters.
- **Prismic.** Slice Machine is **archived**, replaced by the Prismic CLI and Type Builder; slices are `slice_type`/`variation`/`primary` (from memory).
- **Storyblok.** `{component, _uid, …, nested bloks}` with the Bridge preview iframe (from memory). It has an MCP server.
- **Sanity.** Presentation tool with stega-encoded click-to-edit. A Content Agent and MCP server appeared in its changelog (July 2026, from search). https://www.sanity.io/docs/changelog/ddad92cc-cc1b-471a-b64e-98b95e105f32
- **Hygraph, Elementor, Bricks:** not researched; the search budget ran out.

### WordPress / Gutenberg — prior art
- **Block definitions.** `block.json` has `attributes` (with `source`/`selector`), `supports`, `allowedBlocks`, `parent`/`ancestor`, `variations` and `example`. Patterns are reusable groups of blocks. theme.json defines tokens.
- **Serialised form:**
  ```html
  <!-- wp:group {"style":{"spacing":{"padding":{"top":"var:preset|spacing|50"}}}} --><div class="wp-block-group"><!-- wp:heading {"level":1} --><h1 class="wp-block-heading">Ship faster</h1><!-- /wp:heading --></div><!-- /wp:group -->
  ```
- **Agents.** The Abilities API plus the MCP Adapter (1.9k stars) expose three meta-tools: `discover-abilities`, `get-ability-info`, `execute-ability`. Abilities are private by default, and there are no built-in block-editing abilities. https://github.com/WordPress/mcp-adapter
- **Known pain point** (from memory): "invalid block content" errors when markup drifts — exactly what LLM-written block markup triggers.

## 3. Patterns worth stealing
1. **Describe every component for the model.** A registry that exports JSON Schema plus a description for every prop, with `ai.instructions/exclude/schema/bind/stream` per field (Puck AI), `aiProps`/`i18nProps` (Chai), `group: style|content` and validations (Contentful), and Zod plus description (json-render). Make one schema power the UI form, validation, the agent tools and the docs.
2. **Edit by id, not by position.** Puck's own AI layer abandons its public index/zone actions for `add/update/move/delete/duplicate` keyed on ids, with streamed string `appends`. Make that the public API, shared by the UI, undo/redo, collaboration and agents.
3. **Slots as named props** (Puck `slot`, Contentful `slots`), with allow/disallow rules (Puck) and the `allowedBlocks`, `parent` and `ancestor` constraints from Gutenberg's block.json.
4. **Sections as first-class patterns with exposed parameters and variations.** Prior art: Contentful patterns, Gutenberg patterns and variations, Prismic slice variations, GrapesJS symbols, Webstudio content blocks. This is the "hero / pricing / footer" layer.
5. **A normalised style layer.** Rows keyed by (source, breakpoint, state, property) as in Webstudio, or a breakpoint map as in Builder's `responsiveStyles`, combined with token references (`var:preset|spacing|50`, `defineDesignTokens`). Agents patch single declarations instead of rewriting CSS.
6. **Permission modes.** Content mode vs. design mode: Puck `resolvePermissions`, Gutenberg template locks, Plasmic's "ask before large changes". Scope agents the same way.
7. **Pure data functions plus a headless runtime.** Puck's `walkTree`/`transformProps`/`migrate`/`resolveAllData` and GrapesJS's `headless: true`. Version the schema and ship migrations.
8. **Discoverable tools.** WordPress's discover / get-info / execute meta-tools and Plasmic's `identify()` plus `_meta`.
9. **Visual feedback for the agent.** Puck AI's `takeScreenshot` client request, GrapesJS `canvasScreenshot`, Plasmic `take_screenshot`.
10. **Agent-friendly developer experience.** Puck's CLI `--json` contract and its offline `docs` command.

## 4. Gaps none of them fill well, especially for AI agents
1. **No open, transactional document API that works without a mounted editor.**
   - Puck's dispatch needs React state and is index-based; Craft.js is dormant; GrapesJS is headless but centred on HTML and Backbone.
   - What's missing: one id-addressed operation set that runs in Node or on the server, with batched transactions, undo groups, and per-operation attribution to human or agent.
2. **AI is closed, cloud-bound, or driven through a browser.**
   - Puck AI is unlicensed cloud software limited to OpenAI models; GrapesJS AI Chat is proprietary; Plasmic goes through Chrome DevTools; Makeswift's MCP only reads docs; Builder's MCP targets code.
   - No permissively licensed, embeddable editor ships a first-class MCP server or tool schema. Chai (a vendor claim) and Silex (alpha, AGPL) come closest.
3. **Constraint vs. flexibility.**
   - GrapesJS and Plasmic agents write raw HTML/CSS, which escapes the design system.
   - Puck's structured approach has no style or responsive model, so there's no fine-grained customisation.
   - Nobody combines typed components, token-constrained style overrides per breakpoint and state, and an escape hatch in a single schema.
4. **Validate-and-repair loop.** No tool returns machine-readable validation errors (JSON pointer, rule, suggested fix). Puck's field validation request (#362) is still open; Gutenberg's errors are opaque.
5. **A section catalog an agent can read.** Agents need intents, variants, slot descriptions, examples and thumbnails, and a "compose page from sections" operation. Contentful patterns and Gutenberg patterns exist but are tied to their platforms.
6. **Token-efficient reading.** There is no compact outline representation, subtree fetch, or schema-on-demand. GrapesJS's `getPageContent` returns HTML.
7. **Human-in-the-loop changes.** Agent edits as reviewable change sets with diffs and per-operation accept/reject, alongside live co-editing. Only Reka (dormant, Yjs) and Chai's claimed drafts touch this.
8. **Visual QA returned to the agent.** Screenshots per breakpoint plus diagnostics such as overflow, contrast, headings and accessibility. Today this is internal (Puck AI) or a separate plugin (Puck's heading analyzer).
9. **Framework coupling.** The most-upvoted Puck issue asks for multi-framework support. json-render (many renderers, 19.8k stars) shows that a renderer-agnostic document format is in demand.
10. **Licensing gap.** The strongest embeddable options with AI are commercial (Studio SDK, Puck Cloud, Beefree, Unlayer). The open ones are AGPL (Webstudio, Easyblocks, Silex), which blocks embedding in proprietary products. A permissive, agent-native embeddable editor is open space.

## Not verified
- Unlayer, Beefree and Stripo 2026 AI features and pricing.
- GrapesJS Studio SDK pricing numbers.
- Storyblok, Hygraph, Elementor and Bricks details.
- Chai's MCP server and Ycode's MCP support.
- The status of Automattic's Isolated Block Editor (Gutenberg outside WordPress).
- Webstudio AI features.
- The Puck AI blog pages (the details here come from search results and the package types).

To verify these, allow puckeditor.com, grapesjs.com, the docs.* vendor sites and the other vendor domains in the session's network settings, and send a follow-up to continue searching.
