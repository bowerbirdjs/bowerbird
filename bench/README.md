# PageBench

A benchmark of page-editing tasks that measures how reliably agents edit Bowerbird documents: building pages from a brief, making small exact edits, restyling with tokens, changing styles per breakpoint, working inside a policy, and editing while a person edits the same page. No published benchmark compares edit formats for pages yet. See `docs/plan.md`, Phase 0.

**v0: 35 tasks.** Every task has deterministic checks and a reference solution, so the suite itself is tested: each solution passes, and doing nothing fails every task. No model results are checked in: running against a model needs your API key.

| Category      | Tasks | What it measures                                                                                                |
| ------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `build`       | 6     | Pages from a brief: the right sections in order, filled in, shared navigation and footer, a block from HTML     |
| `precise`     | 10    | Small exact edits that leave the rest alone: typos, reordering, list items, links, translations, form fields    |
| `restyle`     | 5     | Tokens, themes, section variables and states instead of raw values or one-off styles                            |
| `responsive`  | 5     | The right breakpoint: mobile-first base styles and `md`/`lg` overrides                                          |
| `policy`      | 5     | Recovering when a change is refused (tokens only, content-only access, locks), proposals, people's edits        |
| `concurrency` | 4     | A person changes the page while the agent works: stale revisions, removed nodes, text rewritten under the agent |

## Running it

```bash
pnpm build
pnpm bench                                  # all tasks, claude-opus-5-5, effort high
pnpm bench -- --category policy --effort medium --out results.json
pnpm bench -- --task precise-pricing-edit --model claude-sonnet-5-5
pnpm bench -- --scripted                    # replay the reference solutions (no key, no model)
```

For each task the runner:

1. Loads a fresh fixture document (`src/fixtures.ts`) under the task's policy and applies its `setup` changes.
2. Gives the agent the tools from `@bowerbirdjs/agent` and the task prompt, and runs a manual tool loop until the model stops or hits the turn limit. Changes listed under `during` are applied as another person at the moment the agent first calls a given tool.
3. Scores the checks and records turns, tool calls, tool errors, tokens (including cache reads), estimated cost, wall time and the agent's last message.

The system prompt and tool definitions are identical for every task, so they're served from the prompt cache after the first request. Server-side refusal fallbacks are on by default. If a fallback model answers a task, the result is marked `served by …`, so it can be left out of a model comparison. Turn fallbacks off with `--no-fallbacks`.

Credentials come from `ANTHROPIC_API_KEY` (the environment, or a `.env` file in the current directory or the repository root) or an `ant auth login` profile.

## Task format

Each task in `tasks/` is a JSON file; `solutions/<id>.json` holds the tool calls of an agent that solves it.

```json
{
  "id": "concurrent-text-edit",
  "category": "concurrency",
  "start": "saas-landing",
  "during": [
    {
      "before": "apply",
      "actor": { "kind": "user", "id": "sam", "name": "Sam" },
      "ops": [
        {
          "op": "props.set",
          "id": "hero-1/subheading",
          "props": { "text": "Tracked hours become invoices automatically." }
        }
      ]
    }
  ],
  "prompt": "In the hero's subheading, change the word \"invoices\" to \"paid invoices\". Leave the rest of the sentence alone.",
  "checks": [
    {
      "type": "propEquals",
      "id": "hero-1/subheading",
      "prop": "text",
      "value": "Tracked hours become paid invoices automatically."
    },
    { "type": "unchangedExcept", "ids": ["hero-1/subheading"] }
  ]
}
```

| Field    | What it is                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| `start`  | Fixture: `empty`, `saas-landing`, `saas-contact` (with a contact form), `two-pages`                                |
| `policy` | `PolicyOptions` for the store: `levels`, `lockedNodes`, `review`, `protectHumanEdits`, `allowRawValues`            |
| `setup`  | Changes applied before the agent starts, each as an actor (a person's edit the agent must respect, a typo to fix)  |
| `during` | Changes another actor makes while the agent works, applied just before the agent's first call of `before` (a tool) |
| `checks` | Deterministic assertions on the final document and its open proposals; LLM-as-judge is used nowhere                |

## Check types

Checks accept every correct way of doing a task they can: pages are named by id or path, new nodes are found by what they are (`find`, `texts`, `children`) rather than by a guessed id, and style values list accepted spellings.

- **Structure:** `sectionOrder`, `pageChildren`, `pageExists`, `variant`, `exists` / `notExists`, `hasPart` / `lacksPart` (part names, because ids stay the same when nodes move), `childCount`, `children` (a node's children in order, each matching a query), `find` (how many nodes match a query: `root`, `page`, `type`, `section`, `part`, `props`, `textIncludes`), `linked` (nodes that are instances of one linked component).
- **Content:** `propEquals`, `propNot`, `textIncludes`, `textMatches`, `texts` (texts of the nodes a query picks, in page order), `lastChildText`, `noPlaceholderText` / `noPlaceholderIn` (template example copy left in place), `localeExists`, `translated`.
- **Style:** `styleEquals` / `styleAbsent` (per breakpoint and state), `varEquals`, `tokenEquals` (base or per theme; an alias and the variable it compiles to are the same value), `noRawValues`.
- **Scope:** `unchangedExcept` (nothing outside the given subtrees changed; `allow` lets tokens, pages, languages, new nodes or linked components through), `proposals` (open changesets: how many, and what they propose), `noLintErrors`.
- **Combining:** `anyOf`.

## Adding a task

1. Write `tasks/<id>.json`. Say in the prompt everything a check relies on (exact texts, order, which breakpoint).
2. Write `solutions/<id>.json`: the calls a careful agent would make, including the refused call if recovering from it is the point (then list the task in `EXPECTED_ERRORS` in `test/bench.test.ts`).
3. `pnpm test bench`: the solution must pass and a run that changes nothing must fail. Add a case to "checks catch plausible mistakes" for the wrong answer you expect most.
