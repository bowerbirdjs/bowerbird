/** Instructions for agents, returned by `get_context`. Keep it short: agents pay for every token. */
export const AGENT_GUIDE = `## How to edit this site
1. Read first: get_outline shows one line per node (id first). Use get_nodes for full detail.
2. Change things with apply({ ops, baseRevision }). A call is all-or-nothing; if it fails, nothing changed and the errors say what to fix.
3. Prefer big blocks: section.insert adds a complete section, and "content" fills its parts in the same op.
4. Make small, precise edits with props.set or text.edit rather than rebuilding sections.
5. Use dryRun: true to check a risky change first. Use undo to revert your last apply.

## Ids
- Sections: <name>-<n> (hero-1). Parts: hero-1/heading. Repeated items are keyed: features-1/item-2/title, pricing-1/tier-pro/price.
- Ids are stable; moving a node keeps its id. Never guess ids: read them from the outline.

## Styling
- Use design tokens, not raw values: var(--space-lg), var(--color-accent), var(--text-2xl). Call list_tokens to see them.
- To rebrand, change the whole palette scale (e.g. color.brand.50…700): themes such as dark reference other steps of it.
- Section variables (e.g. --hero-bg) restyle a whole section: vars.set on the section root.
- Overriding a token on a node (vars.set "--color-surface") re-themes that subtree.
- Breakpoints are mobile-first container queries: "base" applies everywhere; md/lg override for wider layouts.
- States: default, hover, focus, focus-visible, focus-within, active, disabled.

## Op examples
{"op":"section.insert","section":"hero","page":"home","variant":{"layout":"split"},"content":{"heading":{"text":"Plan trips together"},"primary":{"text":"Start free","href":"/signup"}}}
{"op":"section.insert","section":"pricing","page":"home","after":"features-1"}
{"op":"props.set","id":"hero-1/heading","props":{"text":"A better headline"}}
{"op":"text.edit","id":"hero-1/subheading","find":"old phrase","replace":"new phrase"}
{"op":"style.set","id":"hero-1/heading","bp":"md","css":"font-size: var(--text-5xl)"}
{"op":"vars.set","id":"hero-1","vars":{"--hero-bg":"var(--color-surface-muted)"}}
{"op":"node.duplicate","id":"features-1/item-3"}
{"op":"node.move","id":"pricing-1","after":"hero-1"}
{"op":"node.remove","id":"features-1/item-6"}
{"op":"node.insert","parent":"hero-1/actions","node":{"type":"link","props":{"text":"Docs","href":"/docs"}}}
{"op":"token.set","path":"color.brand.600","value":"#0d9488"}
{"op":"page.create","path":"/about","title":"About us"}`;
