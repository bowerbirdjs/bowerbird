# PageBench

A benchmark of page-editing tasks that measures how reliably agents edit Bowerbird documents, and which edit formats work best. No published benchmark compares edit formats for pages yet. See `docs/plan.md`, Phase 0.

## Task format

Each task in `tasks/` is a JSON file:

```json
{
  "id": "landing-from-brief",
  "category": "build",
  "start": "empty",
  "prompt": "Build a landing page for a time-tracking app: nav, hero, three features, pricing, footer.",
  "checks": [
    {
      "type": "sectionOrder",
      "page": "home",
      "sections": ["nav", "hero", "features", "pricing", "footer"]
    },
    { "type": "textIncludes", "id": "hero-1/heading", "anyOf": ["time", "Time"] },
    { "type": "noErrorsLeft" }
  ]
}
```

`start` names a fixture document (`empty` or `saas-landing`). `checks` are deterministic assertions on the final document. LLM-as-judge is used only where nothing else works.

## Running it

```bash
pnpm build
pnpm bench                                  # all tasks, claude-opus-5-5, effort high
pnpm bench -- --task precise-pricing-edit --effort medium --out results.json
```

For each task the runner:

1. Loads a fresh fixture document (`empty` or `saas-landing`, see `src/fixtures.ts`).
2. Gives Claude the tools from `@bowerbirdjs/agent` and the task prompt, and runs a manual tool loop until the model stops or hits the turn limit.
3. Scores the checks and records turns, tool calls, tool errors, tokens (including cache reads), estimated cost and wall time.

The system prompt and tool definitions are identical for every task, so they're served from the prompt cache after the first request. Server-side refusal fallbacks are on by default. If a fallback model answers a task, the result is marked `served by …`, so it can be left out of a model comparison. Turn fallbacks off with `--no-fallbacks`.

Credentials come from `ANTHROPIC_API_KEY` or an `ant auth login` profile.

`scriptedAgent` replays fixed tool calls without a model. The tests use it to check the harness and the checks themselves.

## Check types

`sectionOrder`, `variant`, `textIncludes`, `propEquals`, `lastChildText`, `exists` / `notExists`, `hasPart` / `lacksPart` (part names, because ids stay the same when nodes move), `noPlaceholderText` (template example copy left in place), `unchangedExcept` (nothing outside the given subtrees changed), `noLintErrors`.

## Categories

- **build:** create a page from a brief.
- **precise:** small, exact edits.
- **restyle:** re-theme with tokens and variables.
- **responsive:** change styles per breakpoint.
- **policy:** recover from errors when a change is blocked.
- **concurrency:** a person edits while the agent works.
