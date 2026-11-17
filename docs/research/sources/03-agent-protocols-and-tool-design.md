<!-- Raw research report: Agent protocols, generative-UI specs & agent tool design. Compiled 2026-11-17 by a research sub-agent; see ../landscape-and-direction.md for the synthesis. -->

I researched protocols and agent APIs and wrote the report below. Two limits affected sourcing:

- **Fetch access was blocked for most vendor docs.** That includes a2ui.org, copilotkit.ai, developers.webflow.com, developers.figma.com, builder.io, sanity.io, liveblocks.io, tldraw.dev, arxiv.org, developers.openai.com and developers.googleblog.com. Where I could, I used primary sources on GitHub and anthropic.com instead. Claims I only have from search-engine summaries are marked *(via search)*.
- **The web-search budget for this turn ran out partway through.** The items I could not check are listed at the end.

---

# Agent ↔ page-document protocols: prior art and API design (as of 2026-11-17)

## (a) Generative-UI specs: summary

| Spec | Document shape | How the component catalog is defined | Streaming / incremental updates | Status and adoption |
|---|---|---|---|---|
| **json-render** (Vercel Labs, Apache-2.0) | A flat map: `{root, elements:{id:{type, props, children:[ids]}}}`, plus `$state`/`$bindState` bindings, `visible` conditions, `emit` actions | Zod, through `defineCatalog(...)`. `catalog.prompt()` generates the system prompt from it | "SpecStream": JSONL lines, each an RFC 6902 patch. Editing an existing spec supports `patch`, `merge` (RFC 7396) or `diff` modes. Also ships `validateSpec`/`autoFixSpec` | About 19.8k stars and 34 packages, including React/Vue/Svelte/RN/PDF/email renderers and an MCP Apps package ([repo](https://github.com/vercel-labs/json-render), [core README](https://github.com/vercel-labs/json-render/blob/main/packages/core/README.md)) |
| **A2UI** (Google, Apache-2.0) | JSONL messages: `createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface` (v0.9). Components are a flat list (`id`, `component`, `children:[ids]`) and one must have `id:"root"`. Data is bound with JSON Pointer `path` | A JSON Schema catalog document, referenced by `catalogId` (a URI) | Messages can arrive in any order. Rendering starts once root exists, with placeholders for missing children. Also has a compact text grammar, "A2UI Express" (`Express.g4`) | v1.0 marked stable in the repo. Google announced 1.0 on **Nov 11, 2026** *(via search: [SD Times](https://sdtimes.com/user-interface/google-releases-a2ui-1-0-for-generative-ui/))*, but Gemini and the Android renderer were still on 0.9.1. Renderers: Lit, Angular, React, Flutter, SwiftUI. About 17.6k stars ([repo](https://github.com/google/A2UI), [v0.9 protocol](https://github.com/google/A2UI/blob/main/specification/v0_9/docs/a2ui_protocol.md)) |
| **MCP Apps** (SEP-1865) | Arbitrary HTML in a sandboxed iframe. A tool's `_meta.ui.resourceUri` points to a `ui://` resource with MIME type `text/html;profile=mcp-app` | None. The view is code. Per-tool `visibility: ["model","app"]` controls who can call what | Host↔view JSON-RPC over postMessage, including `ui/notifications/tool-input-partial` (best-effort partial arguments), `tool-result` and `ui/update-model-context` | Spec stable at **2026-01-26**. Hosts: Claude, ChatGPT, VS Code, Goose, Postman and others ([ext-apps](https://github.com/modelcontextprotocol/ext-apps), [spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)) |
| **MCP-UI** | `UIResource` (`ui://`, HTML) | n/a | n/a | The precursor to MCP Apps; it now implements that standard. About 5.3k stars ([repo](https://github.com/MCP-UI-Org/mcp-ui)) |
| **OpenAI Apps SDK** | MCP plus `window.openai` | n/a | `structuredContent` corresponds to `toolOutput` | OpenAI now says new UI should use the MCP Apps bridge and keep `window.openai` for ChatGPT-only features (MCP Apps compatibility shipped Feb 2026) *(via search: [reference](https://developers.openai.com/apps-sdk/reference))* |
| **Vercel AI SDK UI** | Typed message parts `tool-<name>` with states (`input-available`, `output-available`, `output-error`) | Zod `inputSchema` on each tool. The developer maps parts to components | Streams tool parts | RSC `streamUI` is still "experimental"; production guidance is AI SDK UI ([docs](https://raw.githubusercontent.com/vercel/ai/main/content/docs/04-ai-sdk-ui/04-generative-user-interfaces.mdx)) |
| **AG-UI** (CopilotKit-led) | An event protocol, not a UI spec. 31 event types; it carries A2UI, MCP Apps and Open-JSON-UI payloads | n/a | `STATE_SNAPSHOT` / `STATE_DELTA` (RFC 6902, applied atomically, resync on inconsistency) | 1.0 with a frozen JSON Schema. About 19.9k stars. Integrates with LangChain, ADK, Mastra, Claude Agent SDK and others ([repo](https://github.com/ag-ui-protocol/ag-ui), [state docs](https://raw.githubusercontent.com/ag-ui-protocol/ag-ui/main/docs/concepts/state.mdx)) |
| **Thesys C1 / OpenUI Lang** | C1 is an OpenAI-compatible API that returns a UI DSL. OpenUI Lang is a compact, line-oriented language | Zod component contracts | A streaming-first parser renders progressively | MIT, about 15.3k stars. Its own benchmark claims 52.8% fewer tokens than json-render across 7 scenarios ([repo](https://github.com/thesysdev/openui)) |
| **Tambo** | React components registered with a Zod `propsSchema`; each registration becomes an LLM tool. Two kinds: "generative" and "interactable" (persistent) | Zod | Props stream into components | About 11.2k stars. **Tambo Cloud shuts down Oct 31, 2026** (self-hosting remains) ([repo](https://github.com/tambo-ai/tambo)) |
| **Open-JSON-UI** | Described as OpenAI's internal declarative schema | ? | ? | I found **no primary OpenAI source**; only CopilotKit and AG-UI docs mention it |
| **Adaptive Cards** (Microsoft) | A JSON card schema (v1.6) with `${}` templating. "Host config" keeps presentation separate from semantics | A fixed schema | None | Mature, but hosts support different versions (Teams is capped at 1.5) *(via search: [Copilot Studio guidance](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/adaptive-cards-overview))* |

Small examples. json-render, streamed as JSONL patches:
```jsonl
{"op":"add","path":"/root","value":"card-1"}
{"op":"add","path":"/elements/card-1","value":{"type":"Card","props":{"title":"Hello"},"children":["btn-1"]}}
```
A2UI v0.9:
```jsonl
{"version":"v0.9","createSurface":{"surfaceId":"p","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"}}
{"version":"v0.9","updateComponents":{"surfaceId":"p","components":[{"id":"root","component":"Column","children":["name"]},{"id":"name","component":"Text","text":{"path":"/user/name"}}]}}
{"version":"v0.9","updateDataModel":{"surfaceId":"p","path":"/user/name","value":"Jane"}}
```
A2UI Express. This snippet is my own illustration built from the grammar's rules, not taken from a doc:
```
email = TextField(label = "Email", value = $/form/email, checks = [?required])
```

**What these specs agree on, and why it matters for us:**
1. **Flat maps of nodes keyed by ID, with children listed as ID arrays.** json-render, A2UI and tldraw all do this. It lets updates stream in any order, and an edit addresses a node without walking the tree.
2. **The catalog is a schema and the prompt is generated from it.** Zod in JS libraries, JSON Schema for the wire.
3. **RFC 6902 is the common incremental format** (json-render, AG-UI, Contentful `patch_entry`).
4. **There is a push toward compact text DSLs for LLM output** (OpenUI Lang, A2UI Express) that compile into a JSON wire format, because JSON costs a lot of tokens.

None of these specs covers a persistent, editable page: responsive styles, SEO, CMS bindings, undo or collaboration. They describe short-lived agent-to-user surfaces.

## (b) What existing site and design tools expose to agents

| Tool | Surface and granularity | Notes |
|---|---|---|
| **Webflow MCP** | Batched "action array" tools: `element_builder` (nested element schema plus `creation_position` before/after/append/prepend), `element_tool` (13 actions such as `set_text`, `set_style`, `query_elements` and `remove_element`, which is flagged dangerous), `whtml_builder` (**inserts elements from HTML+CSS strings**, 1–5 actions per call), and `element_snapshot_tool` (**returns a PNG**). Element IDs are `{component, element}` ([source](https://github.com/webflow/mcp-server/blob/main/src/tools/deElement.ts)) | v2.0 (Jul 21, 2026) runs most tools headless; the Bridge app is now needed only for snapshots. v2.0.1 **split two oversized tools into three focused ones** (`data_element_settings_tool`, `data_component_props_tool`, `data_component_variants_tool`). v2.1 (Sep 2026) added GSAP interactions *(via search: [changelog](https://developers.webflow.com/home/changelog/2026/7/21))*. Webflow's own post-mortem: thin API wrappers were "too chatty", task-level tools caused "tool explosion", and they settled on layered domain, workflow and guide tools. Telemetry: 58.7% of sessions fall into 3 workflows and a silent error hit more than 10% of sessions *(via search, from a daily.dev summary of [Designing APIs for agents](https://webflow.com/blog/designing-apis-for-agents))*. Reviewers say the agent still "can't check its own output" |
| **Figma MCP** | Reads: `get_metadata` (a lightweight XML outline of IDs, types and bounds), `get_design_context` (React+Tailwind plus a screenshot), `get_screenshot`, `get_variable_defs`. Writes: **`use_figma` runs agent-written JavaScript against the Plugin API** (remote server only, beta since about Mar 24, 2026) ([guide](https://github.com/figma/mcp-server-guide)) | Ships 17 agent skills. The `figma-use` skill says: inspect before creating; reuse existing components and variables; build a skeleton with placeholders, then fill it in; "MUST return ALL created/mutated node IDs"; budget the size of returned data and never truncate silently; check `safeToRetryWithoutCanvasRead` after an error; take screenshots capped at 1024px and check for clipped text and overlaps ([SKILL.md](https://raw.githubusercontent.com/figma/mcp-server-guide/main/skills/figma-use/SKILL.md)) |
| **Framer** | An official remote MCP that creates pages, edits layout and content, manages the CMS and checks SEO. Its Server API matches the Plugin API's capabilities. The older `@framer/agent` CLI still exists | I found no public official tool list ([help](https://www.framer.com/help/articles/what-you-can-do-with-framer-mcp/)) |
| **Builder.io** | A "Publish" MCP at `mcp.builder.io/mcp/publish` (content entries and models, OAuth with dynamic client registration), plus a separate Fusion MCP for branches and design-system docs ([docs](https://www.builder.io/c/docs/mcp-builder-server)) | Tool list not verified |
| **Sanity Agent Actions** | Schema-aware Generate, Transform, Translate, Prompt and **Patch** (Patch uses no LLM and validates against the schema, unlike `client.patch`), aimed at document paths. **By default it never writes to published documents.** The HTTP API is experimental *(via search: [docs](https://www.sanity.io/docs/agent-actions/introduction))* | — |
| **Storyblok** | **Discovery pattern**: `search` → `describe` → `execute_readonly` / `execute_mutating` / `execute_destructive`. Splitting by risk lets clients set different approval policies per tier *(via search: [docs](https://www.storyblok.com/docs/libraries/mcp-server))* | — |
| **Contentful** | A flat list of 63 tools, including `get_initial_context`, `patch_entry` (JSON Patch), opt-in `PROTECTED_ENVIRONMENTS`, a two-phase confirm for cancellation, and list results capped at 10 ([repo](https://github.com/contentful/contentful-mcp-server)) | — |
| **Payload** | Official `@payloadcms/plugin-mcp`: CRUD per collection, respects access control, `afterToolCall` hooks. Does not yet support `readOnlyHint` annotations *(via search)* | — |
| **Wix** | The Wix MCP (docs search, API calls, create and publish sites), plus a per-site "Site MCP" for visitors' agents *(via search)* | — |
| **Notion** | Page reads and writes in Markdown. Ellipsis-anchored `replace_content_range` is now legacy; `update_content` / `replace_content` are recommended. Deleting child pages requires `allow_deleting_content` *(via search: [guide](https://developers.notion.com/guides/data-apis/working-with-markdown-content))* | — |
| **Canva** | Editing is wrapped in transactions (`start-editing-transaction` / `cancel-editing-transaction`). Only partly verified, through third-party listings | — |
| **Puck / GrapesJS** | Puck AI (with 0.8, Jul 28, 2026) is an embedded agent on Puck Cloud; I found no official MCP. GrapesJS has no official MCP; the community "DesignJS" project bridges stdio MCP → WebSocket → the GrapesJS API in the browser *(via search)* | — |

**Patterns from other domains.** The **tldraw agent starter kit** ([README](https://github.com/tldraw/agent-template)) gives the model a screenshot plus three levels of detail: "BlurryShape" (id, type, bounds, text) for the viewport, "FocusedShape" (most properties) for shapes in focus, and "PeripheralShapeCluster" (bounds and a count) for everything off-screen. It also sends lints, rounds numbers to save tokens, runs every action through `sanitizeAction` (ensure the ID exists and is unique; return null to cancel), and has a `Streaming<T>` type with a `complete` flag. Its actions include higher-level operations (align, distribute, stack) and "schedule a review". **The Excalidraw MCP App** has a "read me first" format reference tool and a `create_view` tool that streams elements as partial JSON *(via search)*. **The Tiptap AI Toolkit** has `readNodeRange`, `insertContent` (HTML) and `applyDiff`, addressed by top-level node index *(via search)*. **Liveblocks** treats agents as presence participants: they show up through `setPresence`, edit through `mutateStorage`, and can leave comments *(via search)*.

## (c) Design principles for an agent-facing page-editing API

1. **Address nodes by stable, short, readable IDs, never by array index.** Use `hero-1`, `pricing-1`, and keyed maps for repeating items (`tiers: {starter:…, pro:…}`). Why: JSON Whisperer (EMNLP 2025 Industry) found that patch generation cuts tokens by about 31% while staying within about 5% of full regeneration's quality. It also found that models miss updates and struggle with array index arithmetic, which it fixes ("EASE") by turning arrays into dictionaries with stable keys *(via search: [ACL Anthology](https://aclanthology.org/2025.emnlp-industry.88/))*. Anthropic also reports that replacing UUIDs with readable IDs reduced hallucinations ([Writing effective tools, Sep 11 2025](https://www.anthropic.com/engineering/writing-tools-for-agents)). Index-addressed APIs such as Tiptap ranges and Google Docs indices shift under concurrent edits.

2. **Expose semantic operations, batched and atomic. Keep raw JSON Patch for interop.** A single `apply_ops` call would take operations like `insertBlock`, `setProps` (merge), `moveNode`, `removeNode`, `duplicate`, `setStyleToken`, `bindData` and `editText` (old/new string), plus `baseRevision`, `dryRun` and `label`. The call is all-or-nothing and returns results per operation. This follows Webflow's action arrays and build labels, Canva's transactions and AG-UI's atomic deltas. JSON Merge Patch cannot express moves or array edits, and raw RFC 6902 paths are fragile. Still, record every change internally as RFC 6902 and accept patch or merge as an advanced mode, as json-render's `editModes` does. Search-and-replace is the most consistent format for strong models ([Diff-XYZ, via search](https://arxiv.org/html/2510.12487v2)), and changing the edit format alone moved results a lot in Can Bölük's "Harness Problem" (Feb 12, 2026: Grok Code Fast 1 went from 6.7% to 68.3%; a blog post, not peer-reviewed). Aider found models do worse when code is wrapped in JSON ([Aider, Aug 2024](https://aider.chat/2024/08/14/code-in-json.html)). Together these favour small, targeted operations and search-and-replace for prose, not regenerating the whole tree.

3. **Offer two write granularities: big blocks and fine-grained operations.** "Insert the `PricingTiers` block with these props" should be one operation. Fine-grained props and style tokens are separate operations. Also accept **HTML/Tailwind or JSX as an import format** that converts to blocks. LLMs write HTML fluently, and Webflow ships `whtml_builder` while Figma's main read tool emits React+Tailwind.

4. **Make the catalog the contract, and let agents discover it.** Define blocks in Zod and export JSON Schema. Each block gets a description, examples, allowed child types per slot, and token enums. Generate the prompt from the catalog, as json-render does with `catalog.prompt()`. For large catalogs, use search then describe (Storyblok's pattern, Anthropic's Tool Search). Tool Search raised MCP-eval accuracy from 49% to 74% on Opus 4, and `input_examples` raised accuracy on complex parameters from 72% to 90% ([Advanced tool use, Nov 24 2025](https://www.anthropic.com/engineering/advanced-tool-use)).

5. **Return compact reads by default and let the agent drill down.** `page_outline` should return one line per node (ID, type, headline text, child count) with `depth` and `rootId` options and a `concise|detailed` format. `get_nodes(ids)` returns full detail. This mirrors Figma (`get_metadata`, then `get_design_context` on a subtree) and tldraw's three detail levels. Anthropic's concise format used about a third of the tokens, and Claude Code caps tool output at 25k tokens. Never truncate silently; say what was left out and how to page through it (figma-use). Consider an optional compact text serialization for reads, in the spirit of OpenUI Lang and A2UI Express.

6. **Write validation errors that let the agent fix itself.** Check against the catalog schema and the structure: dangling references, child types a slot does not allow, missing required props, broken bindings. Each error should name the node ID, the field, what was expected and what was received, the valid values, and a "did you mean". Separate lossless auto-fixes (apply them) from lossy ones (send back to the agent), as json-render's `autoFixSpec` does. Sanity's schema-aware patch exists because ordinary patches "don't fail" on schema violations. **Never fail silently**; Webflow's silent error affected more than 10% of sessions.

7. **Support dry runs, diffs and optimistic concurrency.** `dryRun:true` returns the resulting diff plus lint results without committing. Every commit returns the new `revision` and the IDs that changed. Writes carry `baseRevision`, and a stale write gets a conflict error that includes a fresh outline. (Google Docs' `WriteControl.requiredRevisionId` is precedent; I know this from training, not this session.)

8. **Make every agent call one labelled, undoable transaction, and write to a draft by default.** A human should be able to undo an agent's change in one step, and the agent can call `revert(txId)`. Publishing is a separate tool in its own risk tier. Precedents: Sanity never writes to published documents by default, Contentful has protected environments, and Webflow agents write to the live site, so guides advise testing on a duplicate site first.

9. **Group tools by risk and keep the set small.** Aim for about 10–15 tools across read, mutate, destructive and publish tiers, with MCP annotations (`readOnlyHint`, `destructiveHint`) so hosts can auto-approve reads (Storyblok's split). Webflow's history shows both failure modes: wrapping every API call is too chatty, and huge multi-action tools had to be split again in v2.0.1.

10. **Let the agent see the result, starting with the cheapest check.** Provide (a) a rules-based **layout lint** (overflow, clipped text, contrast, empty slots, missing alt text, breakpoint collisions); (b) a text **layout snapshot** of computed boxes and the accessibility tree, which Playwright documents as much cheaper and more precise than screenshots ([Playwright](https://playwright.dev/mcp/snapshots), via search); (c) a **PNG per node or breakpoint**, capped around 1024px (Webflow's `element_snapshot_tool`, Figma). Anthropic ranks rules-based feedback above visual feedback, and both above LLM-as-judge ([Agent SDK post, Sep 29 2025](https://claude.com/blog/building-agents-with-the-claude-agent-sdk)).

11. **Stream operations into the editor.** Accept a JSONL stream of operations, as json-render and A2UI do. Apply only complete operations and show the in-flight one as a ghost preview with placeholders (A2UI, tldraw's `complete` flag, MCP Apps `tool-input-partial`).

12. **Offer a sandboxed code mode as an escape hatch, not the main path.** Bulk changes like "make every CTA primary" are cheaper as a script against a typed editor API. Figma's `use_figma`, Anthropic's code execution with MCP (150k → 2k tokens, [Nov 4 2025](https://www.anthropic.com/engineering/code-execution-with-mcp)) and Programmatic Tool Calling all point this way. The script's mutations should still go through the same validator and transaction log.

13. **Use design tokens, not raw CSS, by default.** Props should take `color:"primary"` or `space:"lg"`. Allow raw CSS only in a field that gets linted. This keeps agent output on-brand and checkable (Figma's skills say "reuse variables and components"; Adaptive Cards keeps presentation in host config).

14. **Keep content separate from structure.** Bind block props to a data or CMS model through JSON Pointer, as A2UI's `updateDataModel` and json-render's `$state` do. Agents can then edit copy without touching layout, and sensitive values can stay out of the model's context.

15. **Ship docs written for agents.** Provide a `get_initial_context`/guide tool (Contentful; Excalidraw's "read me first"), an Agent Skill with workflow rules (Figma ships 17; Webflow publishes skill-migration notes), and llms.txt plus llms-full.txt. llms.txt use is limited (about 8.6% of the top 100k domains) and it does not improve how often a site is cited in AI answers, but coding agents and developer tools do read it *(via search)*.

Here is what one write and its responses could look like:
```json
{"baseRevision":41,"label":"Add pricing","dryRun":false,"ops":[
 {"op":"insertBlock","block":"PricingTiers","id":"pricing-1","parent":"page","after":"features-1",
  "props":{"heading":"Simple pricing","tiers":{"starter":{"price":"$0"},"pro":{"price":"$29"}}}},
 {"op":"setProps","id":"hero-1","props":{"ctaLabel":"Start free"}}]}
→ {"revision":42,"changed":["pricing-1","hero-1"],"lint":[{"id":"pricing-1","rule":"contrast","msg":"..."}]}
→ (on error) {"applied":0,"failedOp":1,"error":"Unknown prop 'ctaText' on Hero; valid: heading, subheading, ctaLabel, ctaHref. Did you mean 'ctaLabel'?"}
```

## (d) Recommendations on standards

1. **Expose the editor as an MCP server. This is essential.** Every serious site and design tool now has one. Structure it in layers: an in-process typed API (`editor.agent.*`), then thin adapters for MCP (remote HTTP, plus a browser bridge for the embedded library, like Webflow's Bridge app or DesignJS), the AI SDK, LangChain and the Claude Agent SDK.
2. **Ship an MCP Apps view** (`ui://…/preview`) so Claude, ChatGPT and VS Code can show the live page inline and humans can adjust it there. Use `visibility:["app"]` for tools only the UI calls, and `tool-input-partial` for streaming previews. `@json-render/mcp` shows this pattern working.
3. **Don't use A2UI or json-render as the page model, but stay compatible with both.** They describe short-lived surfaces with no styles, SEO, history or collaboration. Our model uses the same flat ID map, JSON Schema catalog and JSON Pointer bindings, so adapters are cheap: (a) export our block catalog as an A2UI catalog and a json-render catalog; (b) import A2UI `updateComponents` messages and json-render specs as page sections; (c) optionally render pages as A2UI surfaces. A2UI has the strongest cross-platform and big-company backing (1.0 on Nov 11, 2026, though renderer support is uneven). json-render has the most JS/React momentum.
4. **Use AG-UI for an in-editor copilot.** It is the most widely adopted runtime protocol in the sources I checked (CopilotKit and many agent frameworks). Sync document state with `STATE_SNAPSHOT`/`STATE_DELTA`, which matches using RFC 6902 as our internal change log.
5. **Ship agent docs.** An Agent Skill (SKILL.md) plus llms.txt are cheap and expected.
6. **Avoid depending on:** Open-JSON-UI (no primary spec found), Thesys C1 (a proprietary endpoint, though the OpenUI Lang ideas are worth borrowing), Tambo Cloud (shutting down), and AI SDK RSC `streamUI` (experimental).
7. **For live human-plus-agent co-editing,** build on a CRDT such as Yjs and show the agent's presence (cursor or "editing section X") as Liveblocks does. Agent transactions then merge with human edits instead of overwriting them.

## Not verified in this session

- **Primary docs I could not open.** These rely on search summaries: A2UI 1.0's release date and adopters (Atlassian, Bloomberg, ByteDance and others; the README's stable/RC status also conflicts between sources), Webflow's "Designing APIs for agents" telemetry, the Sanity, Storyblok, Notion, Payload, Wix and Canva details, and Playwright's token comparisons.
- **Canva:** I could not confirm how an editing transaction is committed.
- **Tool lists:** Framer, Builder.io and Wix publish no official tool list; third-party counts disagree.
- **Not re-checked after the search budget ran out:** Google Docs `batchUpdate`/`WriteControl`, the Agent Skills open standard, and Lexical/ProseMirror AI integrations (this comes from my training knowledge or is missing).
- **Benchmarks:** OpenUI's token benchmark is the vendor's own. The "Harness Problem" figures come from a blog post. The JSON Whisperer numbers come from the abstract (the dataset repo doesn't describe the method). I found **no direct benchmark of LLM accuracy editing JSON trees versus HTML for pages**; building a small one would be worthwhile.
- **Open-JSON-UI:** I found no OpenAI primary source.

You can send a follow-up to resume searching, or allow the blocked domains in network settings, to fill these gaps.
