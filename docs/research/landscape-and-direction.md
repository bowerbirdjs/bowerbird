# Agent-first embeddable visual website editor: landscape and direction

Research date: 17 Nov 2026. The four detailed reports behind this summary are in [`sources/`](./sources), with about 200 links to primary sources:

| File                                                                                       | Covers                                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-embeddable-editor-libraries.md`](./sources/01-embeddable-editor-libraries.md)         | Puck, GrapesJS, Craft.js, Builder, Plasmic, Webstudio, Chai, CMS visual editors, Gutenberg, email SDKs                                      |
| [`02-ai-website-builders.md`](./sources/02-ai-website-builders.md)                         | v0, Lovable, Bolt, Replit, Framer, Webflow, Wix, Figma, Onlook, Puck AI, Relume, Prismic, and what users complain about                     |
| [`03-agent-protocols-and-tool-design.md`](./sources/03-agent-protocols-and-tool-design.md) | json-render, A2UI, MCP Apps, AG-UI, OpenUI; the MCP servers of Webflow, Figma, Sanity, Storyblok and others; how to design tools for agents |
| [`04-architecture-foundations.md`](./sources/04-architecture-foundations.md)               | Document model, operations and CRDTs, schemas, styling and tokens, rendering, rich text, drag and drop, section licensing, packaging        |

> **Caveat:** some vendor sites (puckeditor.com, grapesjs.com, several docs.* domains) were blocked from the research environment. For those, facts come from GitHub, npm package type definitions and search summaries. Anything not confirmed from a primary source is flagged in the source reports.

---

## TL;DR

- **Existing tools fall into four groups, and none is an open, embeddable editor that agents can drive well:**
  1. **Embeddable editor libraries** (Puck, GrapesJS, Craft.js). You can embed them, but their APIs assume a mounted UI and a human user. AI is either a closed, paid cloud add-on (Puck AI, GrapesJS Studio) or missing.
  2. **Closed visual platforms** (Framer, Webflow, Wix, Plasmic, Builder.io). They invested heavily in agents and MCP in 2026, but you can't embed them in your own product.
  3. **Code generators** (v0, Lovable, Bolt, Replit). Strong at "prompt → site", weak at precise edits. All of them added "select an element and edit it", and all of them get complaints about drift, overwritten edits and credit costs.
  4. **Generative-UI specs** (json-render, A2UI, MCP Apps, AG-UI). They standardise how agents emit UI from a component catalog, but only for temporary chat UI: no editor, no styles, no pages, no history.
- **The opening:** an MIT-licensed, _headless_ page engine with a first-class agent API (in-process and MCP), plus a React visual editor on top. Humans, agents and host code all edit through **the same validated, id-addressed, undoable operations.**
- **The design bets that matter most:**
  - Store pages as a structured document, and give agents a compact, code-like way to read and write it.
  - Make sections components you can open up: every node inside them stays addressable.
  - Style through tokens by default, with a Tailwind-like shorthand as the agent's input language.
  - Protect human edits: track who changed what, undo per actor, and stage agent edits as draft changesets.
  - Build verification in: validation messages that tell the agent how to fix the error, layout lint, and screenshots.
- **Recommended first step:** build the headless core, the agent tools and a small evaluation suite _before_ the canvas. Prove agents edit reliably, then build the visual editor on the same engine.

---

## 1. Landscape

### 1.1 Embeddable editor libraries (direct competitors)

| Tool                                                             | License / model                          | Activity (Nov 2026)                                   | Data model                                                                       | Styling                                          | AI / agents                                                                                                                                                              | Assessment                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Puck**                                                         | MIT core; Puck Cloud (AI) is paid        | 13.7k★, `@puckeditor/core` 0.24 (29 Oct), very active | Nested JSON; slots are child arrays inside props                                 | **None.** The canvas inherits the host's CSS.    | Puck AI: closed source (the plugin has no license), cloud-hosted, OpenAI models, bring-your-own-key. Headless `generate()`; "assembly" and "design" modes. No MCP found. | **Closest competitor.** Great developer experience and momentum. Weak on styling, responsive design and open AI. |
| **GrapesJS**                                                     | BSD-3 core; Studio SDK is proprietary    | 26.4k★, 0.23.9, still 0.x                             | HTML-like component tree plus separate CSS rules                                 | Full CSS style manager; media queries per device | Studio's AI Chat streams **HTML/Tailwind** into the canvas                                                                                                               | Mature and framework-agnostic, but HTML-centric (Backbone) and hard to constrain                                 |
| **Craft.js**                                                     | MIT                                      | 8.8k★, **no commits since Feb 2025**                  | Flat node map                                                                    | Build your own                                   | None                                                                                                                                                                     | Dormant                                                                                                          |
| **Webstudio**                                                    | AGPL                                     | 9.2k★, active                                         | Normalised tables; Webflow-grade styles (source × breakpoint × state × property) | Full                                             | MCP that edits the real project and checks the result visually                                                                                                           | A standalone app, and AGPL, so it can't be embedded. Its style model is worth copying.                           |
| **ChaiBuilder Core**                                             | BSD-3 plus a pro edition                 | 495★, **0.1.0 (16 Nov 2026)**                         | Blocks styled with Tailwind                                                      | Tailwind                                         | AI SDK, per-block `aiProps`; claims an MCP server (unverified)                                                                                                           | Newest and closest in spirit, but very early. Watch it.                                                          |
| **Builder.io / Plasmic / Makeswift**                             | Hosted editors with MIT SDKs             | —                                                     | Hosted                                                                           | Full                                             | Builder Fusion targets code. Plasmic's agent path drives the browser through Chrome DevTools MCP. Makeswift's MCP only covers docs.                                      | Not embeddable (Builder: enterprise contracts only)                                                              |
| **Email SDKs** (Unlayer, Beefree)                                | Thin open wrapper around a hosted editor | —                                                     | Row/column JSON                                                                  | —                                                | Unlayer has a hosted MCP                                                                                                                                                 | Proven business model for "editor as an SDK"                                                                     |
| **CMS layers** (Payload, Storyblok, Sanity, Contentful, Prismic) | Various                                  | —                                                     | Blocks / slices / patterns                                                       | Contentful has tokens and patterns               | Prismic: agents build only from approved slices, and edits are saved as drafts                                                                                           | Prior art for sections and governance                                                                            |
| **Gutenberg** (WordPress)                                        | GPL                                      | —                                                     | HTML with JSON comments                                                          | theme.json tokens                                | Abilities API plus MCP Adapter                                                                                                                                           | The largest block model in use. Prior art for `allowedBlocks`, patterns and locks.                               |

### 1.2 How AI edits websites today

- **Code generators: generate code, then edit it by selection.**
  - v0 Design Mode "is not a deterministic DOM patch API". A model translates the change into code, so users report neighbouring elements getting restyled and about $1.50 spent changing one `<h1>`.
  - Lovable and Onlook map the clicked DOM element back to its JSX and patch the syntax tree directly, without a model. Faster and more reliable.
- **Visual platforms: agents plus MCP.**
  - Framer 3.0 (Jun 2026) added on-canvas agents, branching and external agents, then an official MCP server.
  - Webflow MCP 2.0 (Jul 2026) works headless and offers element snapshots.
  - Wix Harmony (Jan 2026) combines the Aria agent with drag-and-drop.
  - Then **Webflow Source** (Sep 2026) gave agents direct access to _code_ "without the constraints of an abstraction layer". The leading visual-abstraction vendor is hedging toward code.
- **Assembling from a section library.** Relume (sitemap → wireframe from more than 1,000 components), Puck AI "assembly mode", Prismic slices, Shopify AI theme blocks, Webflow Flowkit.

### 1.3 Agent-to-UI protocols

| Spec                                   | What it is                                                                                                                   | Relevance                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **json-render** (Vercel, about 19.8k★) | Zod component catalog → flat `{root, elements}` map, streamed as RFC 6902 patches; about 15 renderers                        | Validates "the LLM writes constrained JSON". No editor.                         |
| **A2UI** (Google, v1.0 Nov 2026)       | JSONL messages, a flat component list, JSON Schema catalogs, data binding with JSON Pointer, a compact "Express" text syntax | Cross-platform with big-company backing; it describes temporary chat interfaces |
| **MCP Apps** (stable since Jan 2026)   | MCP tools can return a sandboxed HTML interface (`ui://`); supported in Claude, ChatGPT and VS Code                          | Lets you show the live editor _inside_ chat clients                             |
| **AG-UI** (1.0)                        | Event protocol between agent and frontend, with state snapshots and RFC 6902 deltas                                          | Use it for an in-editor copilot                                                 |
| **OpenUI Lang** (Thesys)               | Compact streaming UI language; claims about 53% fewer tokens than json-render                                                | Evidence that compact DSLs beat verbose JSON                                    |

All of these converge on **flat id maps, schema-defined catalogs and patch streams**. None models a persistent, editable page with styles, responsiveness, SEO, history or collaboration. They are things to interoperate with, not the page model.

---

## 2. What the research shows

1. **MCP is now expected.** In 2026, Framer, Webflow, Wix, Lovable, Plasmic, Prismic, WordPress, Elementor, Unlayer, Google Stitch and Subframe all shipped agent APIs, mostly MCP. The dominant pattern is "bring your own agent": the editor becomes a tool server, and Claude Code, Codex or Cursor is the agent.

2. **Generating a page is a commodity; editing is where the value is.** Framer: "53% of website work is maintenance and edits." Hostinger launched with "It's not about who can generate a homepage in 30 seconds."

3. **Small edits that go through a model are the top complaint.** Users report slow edits, credit charges, and changes spilling onto neighbouring elements (v0, Figma Make, Framer credits). Humans should never need a model call to change padding. **Deterministic operations for precise edits; the model only plans.**

4. **Regenerating overwrites human edits** (Lovable, v0, Durable's "regenerate section"). Nobody has solved tracking who changed what and protecting it.

5. **Structured document vs. code is a false choice.** The most mature agent harness, Framer's, keeps a structured tree. But Framer _invented a compact language to express the tree and its edits_, and in "Harness 2" has the agent write JavaScript against a method API that runs while the model streams: 33% cheaper and 20% faster. Plasmic (`PLASMIC_AI_TOOLS`) and Figma (`use_figma` runs agent-written JavaScript) converge on the same pattern. **Structured storage, code-like agent interface.**

6. **The trend toward code is real, but it targets developer-owned sites.** Webflow Source, Frigade leaving Framer to rebuild in code with Claude in a week, and Figma Make users moving to Claude Code all show it. An embeddable library's hosts serve **non-developers in multi-tenant products**, where running arbitrary generated code is unacceptable. That market needs a constrained document. Still, ship clean code export so users have an exit.

7. **Opaque sections block agents.** Claude couldn't change labels on a Framer marketplace component because component instances "don't expose their internals through the API". Every node inside a large block must be addressable.

8. **Generating from a fixed catalog is the reliability consensus** (json-render, A2UI, Puck assembly mode, Prismic slices, Shopify blocks). One practitioner reports 8–12% malformed output when generating HTML versus under 1% with strict-schema JSON (anecdotal). Aider found models write worse _code_ when it's wrapped in JSON. **No benchmark compares edit formats for pages.** That is an opening (see §7).

9. **The lessons on tool design are concrete:**
   - Readable, stable ids reduce hallucination (Anthropic).
   - Turn arrays into keyed maps. Patches use about 31% fewer tokens than regenerating, and index arithmetic is error-prone (JSON Whisperer, EMNLP 2025).
   - Keep the tool set small and grouped by risk. Webflow's post-mortem: thin API wrappers were "too chatty", task-level tools multiplied out of control, two oversized tools had to be split, and a silent error hit more than 10% of sessions.
   - Read at increasing levels of detail: Figma's `get_metadata` comes before `get_design_context`; tldraw's agent kit uses three detail levels.
   - Validation errors should say "did you mean…".
   - Let the agent see its result (Webflow snapshots, Webstudio's vision check).
   - Default to drafts (Sanity, Prismic, Elementor).

10. **Puck's own AI layer shows what the public API should be.** Internally, Puck AI streams _id-addressed_ operations: `add`, `update`, `move`, `delete`, `duplicate`, plus streaming text appends. Its public `dispatch` API is index/zone-addressed and needs a mounted editor.

11. **Licensing leaves a gap.** The open, embeddable options are AGPL (Webstudio, Easyblocks, Silex) or keep their AI closed (Puck, GrapesJS Studio). **Tailwind Plus's license explicitly forbids website builders**, and Relume's library is commercial. You need an original section library; MIT sources such as shadcn/ui, HyperUI and Flowbite core are fine as structural references.

---

## 3. Positioning

> **An open-source page engine that agents and humans edit together.** A headless, typed page document with one operation API shared by your UI, your code and any AI agent (MCP included), plus a React visual editor you embed in your product. Large sections when you want speed, every node editable when you need precision, and design tokens so the output stays on-brand.

| Need                                                          | Today                                                                       | This project                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Edit pages without a mounted UI (server, edge, agent runtime) | GrapesJS headless (HTML-centric); Puck needs React state                    | Pure TypeScript core that runs anywhere                                      |
| Open, model-agnostic agent API                                | Puck AI closed and OpenAI-only; Studio AI proprietary; Plasmic needs Chrome | MIT agent package plus MCP server; any model                                 |
| Big sections with full control                                | Opaque props (Puck, Builder) or raw HTML (GrapesJS)                         | Sections are components with an exposed prop contract, overrides and detach  |
| Brand-safe AI styling                                         | Puck has no style system; GrapesJS and Plasmic agents write raw CSS         | Token-bound style declarations; the host decides how much freedom is allowed |
| Human edits survive AI edits                                  | Unsolved everywhere                                                         | Provenance, per-actor undo, draft changesets, locks                          |
| Agents check their own work                                   | Mostly internal to vendors                                                  | Validation, layout lint, layout snapshot and screenshot tools                |
| Permissive license                                            | AGPL or closed AI                                                           | MIT                                                                          |

---

## 4. Directions considered

| Option                                                      | Advantages                                                              | Drawbacks                                                                                    | Verdict                                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **A. Build on Puck** (plugin or fork)                       | Fastest start, existing users                                           | No style or responsive model; nested, index-addressed data; you'd compete with their paid AI | Not as a base. **Offer a Puck data importer** to win its users. |
| **B. Agent-first headless engine plus React editor**        | Owns the gap above; a clean API is the product                          | Most work; you build the canvas yourself                                                     | ✅ **Recommended**                                              |
| **C. Framework-agnostic web-component editor from day one** | Broadest reach (Puck's most-requested issue is multi-framework support) | Roughly double the UI work                                                                   | Defer. Keep the core pure TypeScript so it stays possible.      |
| **D. Build on GrapesJS**                                    | Mature, BSD, framework-agnostic                                         | The HTML/CSS model is hard to constrain to tokens and schemas; Backbone                      | Fallback if time-to-market matters most                         |
| **E. Build an AI site-builder product**                     | —                                                                       | Crowded and well funded (Lovable reportedly about $500M ARR); not what you described         | No                                                              |

---

## 5. Recommended product shape: seven principles

### 5.1 One engine for humans, agents and host code

```
 Human (canvas, panels) ─┐
 Agent (MCP / tools)  ───┼──► Transaction{actor, ops[]} ─► validate ─► policy ─► apply ─► history/sync ─► render
 Host code (TS API)   ───┘                                   │
                                          structured errors with fixes ◄┘
```
Every change from every source is a transaction of typed operations. It is validated against component schemas, checked against host policy, recorded with its author, and undoable. Visual edits never call a model.

### 5.2 Sections you can open up

- A **section** (hero, pricing, footer…) is a component definition made of primitives. It exposes a prop contract (`heading`, `cta`, `tiers{}`), named slots, and variant axes (`layout: split|centered`, `tone: light|dark`).
- Agents and casual users edit through props: cheap and safe.
- Designers (or agents, when policy allows) **override inner nodes without detaching**, addressed by an instance-scoped path such as `pricing-1/tier-pro/badge`. They can also **detach** a section for full control.
- Section catalog entries carry what an agent needs: intent ("when to use"), variants, slot descriptions, example content and a thumbnail.

### 5.3 Constrained by default, free when the host allows it

- Styles are stored as structured declarations per breakpoint and state. Values are **token references** using the DTCG 2025.10 format, compiled to CSS variables.
- The **agent writes a Tailwind-like shorthand** (`py-2xl md:py-3xl bg-surface-inverse`), which is parsed into token-bound declarations. LLMs already know Tailwind well, and storage stays structured and mergeable. Arbitrary values (`p-[37px]`) are rejected unless policy allows raw values.
- Host-defined **freedom levels**:
  - _content_: text and images only
  - _layout_: add, move and remove sections
  - _design_: styles and overrides
  - _code_: custom components

  Levels can be set per role and per actor type, and are enforced in the core rather than in prompts.

### 5.4 An API agents can use well

- **Stable, readable ids** (`hero-1`, `pricing-1`) and keyed maps instead of arrays.
- **Read at increasing detail.** A compact outline language first, then `get_nodes(ids, depth)`:

  ```
  page home "/"
    hero-1      Hero[split]          "Ship pages with your agent" · cta "Start free"
    logos-1     LogoCloud            6 logos
    features-1  FeatureGrid[cols=3]  items: fast, typed, open
    pricing-1   Pricing[dark]        tiers: starter $0 · pro $29 (badge "Popular") · team $99
    footer-1    Footer               4 link groups
  ```
- **One atomic batch write** with `baseRevision` and `dryRun`. It returns per-operation results, the new revision, changed ids and lint results. Errors name the node, the field, the expected and actual values, and a "did you mean". Text edits use search/replace. **HTML/JSX import** converts markup the model wrote into catalog nodes and validates it.
- **A sandboxed script mode** for bulk edits ("make every CTA primary"), following Framer, Figma and Anthropic's code-execution pattern. It still goes through the same validator and transaction log.
- About 12 tools grouped by risk with MCP annotations:
  - **Read:** `get_context`, `outline`, `get_nodes`, `search_catalog`
  - **Write:** `apply`, `edit_text`, `import_html`
  - **Verify:** `lint`, `snapshot`, `screenshot`
  - **History:** `revert`
  - **Publish:** `publish`, off by default
- Plus an Agent Skill (SKILL.md) and llms.txt documentation.

### 5.5 Human edits are protected

- Every node and property records its last author (human or agent).
- Human-pinned values can't be overwritten without an explicit flag, and the agent is told why its change was refused.
- **Undo per actor:** "undo the agent's last change" is a single step.
- Agent work can land as a **draft changeset** the human accepts or rejects per operation.
- With real-time collaboration, the agent appears as a presence on the canvas ("editing pricing-1").

### 5.6 Verification is built in

Cheapest check first:

1. Schema and reference validation, which runs on every write.
2. A rules-based **layout lint**: overflow, clipped text, contrast, empty slots, missing alt text, heading order.
3. A text **layout snapshot**: computed boxes plus the accessibility tree.
4. A **screenshot** per node or breakpoint, rendered server-side with Playwright because the renderer is a pure function of the document.

### 5.7 Embeddable, and the host stays in control

- Controlled or uncontrolled usage, with a **transaction event stream** as the main integration point.
- Hooks for a policy engine, an asset adapter, i18n, a plugin system, a themable editor UI, and replaceable panels.
- A server-side render (SSR) and static-HTML renderer; code export to React or Next.js as the exit path.

---

## 6. Architecture sketch

The detailed reasoning and library versions are in `sources/04`.

```
packages/
  core        # pure TS: doc types, Zod schemas, store, ops, transactions, inverse ops, policy, migrations, outline serializer
  css         # style declarations → CSS; DTCG tokens → CSS vars; Tailwind-shorthand parser
  react       # <Render> (SSR/RSC-safe)
  editor      # React shell: iframe canvas, overlays, dnd adapter, auto-generated prop/style panels
  richtext    # Tiptap 3 schema factory + static renderer
  agent       # tool definitions, context builder, eval harness hooks
  mcp-server  # MCP adapter (stdio + streamable HTTP) over core; MCP Apps preview view
  blocks      # primitives + original section library
  export      # HTML / JSX / shadcn-registry export
  collab-yjs  # (phase 3) sync adapter; agent presence
apps/
  showcase    # Next.js demo (see §7)
  docs
bench/        # page-editing eval suite
```

**Main technology choices:**

| Area                             | Choice                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Language, monorepo               | TypeScript; pnpm, Turborepo, Changesets                                                                 |
| Schemas                          | Zod 4, exported through Standard Schema / JSON Schema (one source for validation, panels and LLM tools) |
| Rich text                        | Tiptap 3                                                                                                |
| Drag and drop                    | `@dnd-kit/dom`, wrapped behind an adapter because it is pre-1.0                                         |
| Positioning (toolbars, popovers) | Floating UI                                                                                             |
| Ordering                         | `fractional-indexing`                                                                                   |
| Collaboration (later)            | Yjs (Loro as an alternative)                                                                            |
| Tokens                           | DTCG 2025.10 with Style Dictionary or Terrazzo                                                          |
| Screenshots                      | Playwright                                                                                              |

**Core types:**

```ts
interface SiteDoc {
  schemaVersion: number;
  revision: number;
  pages: Record<PageId, { path: string; rootId: NodeId; meta: SeoMeta }>;
  nodes: Record<NodeId, Node>; // flat, normalized
  components: Record<CompId, ComponentDef>; // sections & global symbols
  tokens: DTCGTokens;
  themes?: Record<string, DTCGContext>;
  breakpoints: { id: string; kind: 'viewport' | 'container'; minWidth: number }[]; // mobile-first
}
interface Node {
  id: NodeId;
  type: string;
  parent: NodeId | null;
  slot?: string;
  order: string; // fractional index
  props: Record<string, PropValue>; // $token | $asset | $rich | $loc | $bind | JSON
  styles?: {
    [bp: string]: {
      [state: string]: Record<
        CssProp,
        { token: string } | { value: number; unit: string } | { raw: string }
      >;
    };
  };
  instance?: {
    of: CompId;
    variant?: Record<string, string>;
    overrides?: Record<string /* inner path */, Partial<Node>>;
  };
  meta?: { name?: string; lock?: LockSpec; lastEditedBy?: ActorRef };
}
type Op =
  | {
      op: 'section.insert';
      component: CompId;
      parent: NodeId;
      after?: NodeId;
      props?: object;
      variant?: object;
    }
  | { op: 'node.insert' | 'node.move' | 'node.remove' | 'node.duplicate' /* … */ }
  | { op: 'props.set'; id: NodeId; props: object; locale?: string } // merge
  | {
      op: 'style.set';
      id: NodeId;
      bp?: string;
      state?: string;
      style: string | Record<string, unknown>;
    } // shorthand or object
  | { op: 'text.edit'; id: NodeId; key: string; find: string; replace: string }
  | { op: 'instance.override' | 'instance.detach' | 'instance.variant' /* … */ }
  | { op: 'token.set' | 'page.create' | 'page.update' /* … */ };
interface Transaction {
  id: string;
  actor: { kind: 'user' | 'agent' | 'system'; id: string };
  baseRevision?: number;
  label?: string;
  ops: Op[];
  dryRun?: boolean;
  draft?: boolean;
}
```

**Key trade-offs:**

1. A flat map with operations is more machinery than Puck's nested JSON. It buys stable addressing, concurrent edits, fine-grained permissions and per-actor undo.
2. Structured styles cost some LLM fluency. The Tailwind-shorthand input recovers most of it.
3. Sections with overrides and detach are the hardest part to build, so they come in phase 2. Phase 1 can ship sections as composed nodes that are inserted from templates.
4. An iframe canvas gives real breakpoints and style isolation, at the cost of more complex drag and drop.

---

## 7. Showcase app

Build it as a **fictional SaaS product that embeds the editor** (e.g., an events product where organisers build event pages). That proves the library works inside someone else's product, not just as a standalone editor. Then show off:

1. **Agent and human together.** Chat pane plus canvas. Agent operations stream in as ghost previews. The agent's presence highlights the section it's working on. A timeline shows each transaction by actor, with "undo agent" and accept/reject of draft changesets.
2. **Bring your own agent.** The app exposes an MCP endpoint. Point Claude Code (or any MCP client) at it and watch it build a page live, while you edit a headline at the same time and nothing gets overwritten. This is the headline demo.
3. **Large to small.** "Add a pricing section with three tiers" (one operation), then "make the Pro tier's badge red" (an inner override), then detach.
4. **Freedom levels and brand lock.** Switch role between _marketer_ (content only) and _designer_. Watch the agent's refused edits come back with explanations.
5. **Theme lab.** Swap DTCG token sets, and the same page is restyled instantly.
6. **Developer inspector.** Live view of the operations JSON, the outline language and host-API snippets, so integrators see exactly what's happening.
7. **Export.** Static HTML and a Next.js project.
8. **Benchmark page.** Public results from the evaluation suite below. It doubles as marketing and as a regression test.

**The evaluation suite ("PageBench").** Roughly 30–100 page-editing tasks with automatic checks: build from a brief, precise edits, refactors, brand-compliance and responsive fixes. It measures success rate, tokens, cost and latency across models, and across edit formats (operations vs. HTML import vs. script mode). Nobody has published this comparison. It turns the API design questions into measurements, and it's good publicity.

---

## 8. Roadmap

Durations are rough guesses for a small team.

| Phase                                     | Scope                                                                                                                                                                                                                                             | Done when                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **0. Prove the engine** (about 3–4 weeks) | Core model, operations and transactions, validation with fix hints, outline language, about 10 primitives and 8 sections, HTML renderer, MCP server, PageBench v0                                                                                 | A frontier model passes at least 90% of the v0 tasks headless. The style-input format is chosen from measurements. |
| **1. Editor MVP** (about 6–8 weeks)       | React editor with iframe canvas, selection overlay, drag and drop, auto-generated prop panels, token style panel, breakpoints, undo/redo; host API (controlled/uncontrolled, events, policy); about 25 sections; showcase v1 with an in-app agent | Someone else's app embeds it in under an hour                                                                      |
| **2. Sections and safety**                | Component definitions, instances, overrides, detach; draft changesets; provenance protection; lint, snapshot and screenshot tools; streaming ghost previews                                                                                       | The "agent + human, nothing overwritten" demo works                                                                |
| **3. Collaboration and reach**            | Yjs adapter with agent presence, Tiptap rich text, i18n, data binding, code export, imports (Puck, HTML), json-render/A2UI catalog export, MCP Apps view, AG-UI copilot, web-component renderer                                                   | —                                                                                                                  |

---

## 9. Risks

| Risk                                                                                          | Mitigation                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Puck adds open agent tooling or MCP; it is moving fast (0.24, AI 0.9, a CLI built for agents) | Compete on the headless engine, style and token model, sections you can open up, provenance and model-agnostic MIT tooling. Provide a Puck importer.                              |
| "Agents just write code" makes structured editors irrelevant                                  | Target hosts serving non-developers in multi-tenant products, where generated code is unacceptable. Offer code export as the exit. Use PageBench to measure reliability honestly. |
| Scope grows into building a Webflow                                                           | Phase strictly. No collaboration, rich-text extras or custom-component authoring before phase 2–3.                                                                                |
| LLMs handle your format worse than HTML                                                       | Compact outline language, HTML import tool, script mode, Tailwind-shorthand styles, all measured in PageBench from day one                                                        |
| Pre-1.0 dependencies (`@dnd-kit/dom`, Yjs v14, Lexical)                                       | Wrap them behind adapters; choose stable options where they exist (Tiptap 3, Zod 4)                                                                                               |
| License contamination                                                                         | Keep the core MIT; no AGPL or GPL dependencies; write an original section library; never use Tailwind Plus or Relume markup                                                       |

---

## 10. Decisions that are yours

> **Update, 17 Nov 2026:** decided. The audience is anyone, styling uses CSS custom properties, the license is MIT, and the engine is built from scratch. Web components are recommended for the editor. See [`docs/plan.md`](../plan.md). The Tailwind-shorthand idea in §5.3 is replaced by plain CSS declarations that reference design tokens. The iframe canvas in §6 is replaced by a same-document, light-DOM canvas that uses container queries.

1. **Who embeds this?** For example: SaaS products that give their customers page building (CRM, email, commerce, events, link-in-bio), CMS vendors, internal tools, or agencies. This decides the first section library and feature priorities.
2. **How styles are stored.** Recommended: structured token-bound declarations with a Tailwind-like shorthand for input. The alternative is plain Tailwind class strings, which is faster to an MVP and what Chai does, but harder to constrain and to merge.
3. **Framework.** Recommended: React first on a pure-TypeScript core. The alternative is web components from day one.
4. **License and business model.** Recommended: an MIT core, possibly with a paid cloud later (hosted collaboration, hosted agent runtime, premium section and theme packs), the model used by Puck, Tiptap and Liveblocks. The alternative is fully open.
5. **Build your own engine or extend GrapesJS.** Recommended: your own engine. GrapesJS is the fallback if speed matters most.
