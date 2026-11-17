# PageBench (planned)

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

`start` names a fixture document: `empty`, or a saved site file. `checks` are deterministic assertions on the final document. LLM-as-judge is used only where nothing else works.

## Runner (to do)

For each model and each edit format (ops, HTML import, script mode) the runner will:

1. Load the start document into a store.
2. Give the agent the tools from `@bowerbirdjs/agent` and the task prompt.
3. Run the tool loop until the agent stops or hits the turn limit.
4. Score the checks. Record success, number of turns, tokens, cost and latency.

The model API key is supplied by whoever runs the benchmark.

## Categories

- **build:** create a page from a brief.
- **precise:** small, exact edits.
- **restyle:** re-theme with tokens and variables.
- **responsive:** change styles per breakpoint.
- **policy:** recover from errors when a change is blocked.
- **concurrency:** a person edits while the agent works.
