export type Check =
  | { type: 'sectionOrder'; page: string; sections: string[] }
  | { type: 'variant'; id: string; variant: Record<string, string> }
  | { type: 'textIncludes'; id: string; anyOf: string[] }
  | { type: 'propEquals'; id: string; prop: string; value: unknown }
  | { type: 'lastChildText'; id: string; value: string }
  | { type: 'exists' | 'notExists'; id: string }
  | { type: 'hasPart' | 'lacksPart'; parent: string; part: string }
  | { type: 'noPlaceholderText'; ids: string[] }
  | { type: 'unchangedExcept'; ids: string[] }
  | { type: 'noLintErrors'; page?: string };

export interface BenchTask {
  id: string;
  category: 'build' | 'precise' | 'restyle' | 'responsive' | 'policy' | 'concurrency';
  /** Fixture name: "empty" or "saas-landing". */
  start: string;
  prompt: string;
  checks: Check[];
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
}

export interface TaskResult {
  task: string;
  passed: boolean;
  checks: CheckResult[];
  run: AgentRun;
}
