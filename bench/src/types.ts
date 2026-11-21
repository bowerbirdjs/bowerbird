import type { Actor, PolicyOptions } from '@bowerbirdjs/core';

/** Picks nodes by what they are, for checks on nodes whose ids the task can't know in advance. */
export interface NodeQuery {
  /** Only this node and its subtree. */
  root?: string;
  /** Only nodes on this page (its id, or its path such as `/about`). */
  page?: string;
  type?: string;
  /** Section roots of this section. */
  section?: string;
  part?: string;
  /** Props that must equal these values. */
  props?: Record<string, unknown>;
  /** The node's text (or rich text) contains this, ignoring case. */
  textIncludes?: string;
}

export interface Count {
  equals?: number;
  min?: number;
  max?: number;
}

export type Check =
  /** Section names of a page's top-level nodes, in order. Pages are named by id or by path. */
  | { type: 'sectionOrder'; page: string; sections: string[] }
  /** A page's top-level nodes in order: section names, or node types for other nodes. */
  | { type: 'pageChildren'; page: string; kinds: string[] }
  | { type: 'pageExists'; path: string; title?: string; description?: string }
  /** A section root's variant; the root by id, or the first node a query picks. */
  | { type: 'variant'; id?: string; query?: NodeQuery; variant: Record<string, string> }
  | { type: 'textIncludes'; id: string; anyOf: string[] }
  /** A text prop matches a regular expression (`prop` defaults to `text`). */
  | { type: 'textMatches'; id: string; pattern: string; flags?: string; prop?: string }
  | { type: 'propEquals'; id: string; prop: string; value: unknown }
  /** The prop has changed from this value (and still exists). */
  | { type: 'propNot'; id: string; prop: string; value: unknown }
  | { type: 'lastChildText'; id: string; value: string }
  | { type: 'exists' | 'notExists'; id: string }
  | { type: 'hasPart' | 'lacksPart'; parent: string; part: string }
  | { type: 'childCount'; id: string; count: Count }
  /** How many nodes match a query. Default: at least one. */
  | { type: 'find'; query: NodeQuery; count?: Count }
  /** A node's children, in order, each matching the query at its place (`root` is ignored). */
  | { type: 'children'; id: string; sequence: NodeQuery[] }
  /** The texts of the nodes a query picks, in page order. */
  | { type: 'texts'; query: NodeQuery; equals: string[] }
  | { type: 'noPlaceholderText'; ids: string[] }
  /** No node of these sections on the page still shows its template's example text. */
  | { type: 'noPlaceholderIn'; page: string; sections: string[]; parts?: string[] }
  /**
   * Nothing outside the given subtrees changed. `allow` lets whole kinds of change through:
   * `tokens` (tokens and themes), `pages` (page settings and new pages), `locales` (languages and
   * translations), `created` (new nodes, wherever they are), `symbols` (linked components).
   */
  | {
      type: 'unchangedExcept';
      ids: string[];
      allow?: ('tokens' | 'pages' | 'locales' | 'created' | 'symbols')[];
    }
  | { type: 'noLintErrors'; page?: string }
  /** A declaration on a node; `value` may list accepted alternatives. Default breakpoint and state. */
  | {
      type: 'styleEquals';
      id: string;
      prop: string;
      value: string | string[];
      bp?: string;
      state?: string;
    }
  /** The node sets no such declaration (at that breakpoint and state). */
  | { type: 'styleAbsent'; id: string; prop: string; bp?: string; state?: string }
  /** A CSS variable override on a node (`vars.set`). */
  | { type: 'varEquals'; id: string; name: string; value: string | string[] }
  /** A token's value (case and spacing ignored); with `theme`, that theme's value. */
  | { type: 'tokenEquals'; path: string; value: string | string[]; theme?: string }
  /** Every node style and variable uses tokens: no raw lengths or colours anywhere. */
  | { type: 'noRawValues' }
  | { type: 'localeExists'; locale: string }
  /** These nodes have a translation of the prop that differs from the original. */
  | { type: 'translated'; ids: string[]; locale: string; prop?: string }
  /** Nodes that are instances of one symbol (optionally by name): the nodes matching each query. */
  | { type: 'linked'; queries: NodeQuery[]; symbolName?: string }
  /** Open proposals: how many, and (optionally) one whose ops include `op` on `id`. */
  | {
      type: 'proposals';
      count?: Count;
      op?: string;
      id?: string;
      section?: string;
      /** Checks that must pass on the page as it would be once a proposal is accepted. */
      whenAccepted?: Check[];
    }
  /** Passes if any of the alternatives passes. */
  | { type: 'anyOf'; checks: Check[] };

/** Changes someone else makes while the agent works. */
export interface Interruption {
  /** Applied just before the agent's first call of this tool runs (default `apply`). */
  before?: string;
  actor: Actor;
  label?: string;
  ops: unknown[];
}

export interface BenchTask {
  id: string;
  category: 'build' | 'precise' | 'restyle' | 'responsive' | 'policy' | 'concurrency';
  /** Fixture name (see `FIXTURE_NAMES`). */
  start: string;
  prompt: string;
  checks: Check[];
  /** The store's policy for this task (who may change what). Default: everything allowed. */
  policy?: PolicyOptions;
  /** Changes made before the agent starts, e.g. a person's edit that should be respected. */
  setup?: { actor: Actor; ops: unknown[] }[];
  /** What other people do while the agent works. */
  during?: Interruption[];
}

export interface CheckResult {
  check: Check;
  passed: boolean;
  message: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentRun {
  turns: number;
  toolCalls: number;
  toolErrors: number;
  usage: Usage;
  /** Estimated USD cost, when the model's price is known. */
  costUsd?: number;
  latencyMs: number;
  stopReason: string;
  /** Set when a refusal fallback answered instead of the requested model. */
  servedBy?: string;
  /** What the agent said last (its summary of what it did), for reading results by hand. */
  finalText?: string;
}

export interface TaskResult {
  task: string;
  category: BenchTask['category'];
  passed: boolean;
  checks: CheckResult[];
  run: AgentRun;
}
