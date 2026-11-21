import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AgentTool, createAgentTools } from '@bowerbirdjs/agent';
import type { Store } from '@bowerbirdjs/core';
import type { BenchAgent, ScriptedCall } from './agents.js';
import { runCheck } from './checks.js';
import { fixtureStore } from './fixtures.js';
import type { BenchTask, Interruption, TaskResult } from './types.js';

/** The order results are listed in. */
export const CATEGORIES: BenchTask['category'][] = [
  'build',
  'precise',
  'restyle',
  'responsive',
  'policy',
  'concurrency',
];

/** Every task in a folder, by category (in `CATEGORIES` order), then by id. */
export function loadTasks(dir: string): BenchTask[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BenchTask)
    .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category));
}

/** Reference solutions by task id: the tool calls of an agent that solves the task. */
export function loadSolutions(dir: string): Record<string, ScriptedCall[]> {
  const out: Record<string, ScriptedCall[]> = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort())
    out[file.replace(/\.json$/, '')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as ScriptedCall[];
  return out;
}

/**
 * Wraps the tools so other people's changes land while the agent works: each interruption is
 * applied once, just before the agent's first call of its tool runs.
 */
function interrupted(tools: AgentTool[], store: Store, during: Interruption[]): AgentTool[] {
  const pending = [...during];
  return tools.map((tool) => ({
    ...tool,
    async run(input: unknown) {
      for (const event of pending.filter((e) => (e.before ?? 'apply') === tool.name)) {
        pending.splice(pending.indexOf(event), 1);
        const res = store.apply({
          actor: event.actor,
          ops: event.ops,
          ...(event.label ? { label: event.label } : {}),
        });
        // The agent may have removed what the other person was about to change: then their
        // change simply doesn't happen. The run goes on and the checks decide.
        if (!res.ok)
          console.error(
            `note: an interruption could not be applied (${res.errors.map((e) => e.message).join('; ')})`,
          );
      }
      return tool.run(input);
    },
  }));
}

/** Runs one task: fresh fixture, the agent's tool session, then the deterministic checks. */
export async function runTask(task: BenchTask, agent: BenchAgent): Promise<TaskResult> {
  const store = fixtureStore(task.start, task.policy);
  for (const step of task.setup ?? []) {
    const res = store.apply({ actor: step.actor, ops: step.ops });
    if (!res.ok) throw new Error(`Task "${task.id}" setup failed: ${JSON.stringify(res.errors)}`);
  }
  const start = store.doc;
  const tools = interrupted(
    createAgentTools({ store, actor: { kind: 'agent', id: 'pagebench' } }),
    store,
    task.during ?? [],
  );
  const run = await agent.run(task, { store, tools, prompt: task.prompt });
  const checks = task.checks.map((check) => runCheck(check, store, start));
  return {
    task: task.id,
    category: task.category,
    passed: checks.every((c) => c.passed),
    checks,
    run,
  };
}

export function formatResults(agent: string, results: TaskResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const cost = results.reduce((sum, r) => sum + (r.run.costUsd ?? 0), 0);
  const rate = results.length ? Math.round((passed / results.length) * 100) : 0;
  const lines = [`PageBench: ${agent}: ${passed}/${results.length} tasks passed (${rate}%)`];
  const categories = [...new Set(results.map((r) => r.category))];
  if (categories.length > 1)
    lines.push(
      categories
        .map((c) => {
          const of = results.filter((r) => r.category === c);
          return `${c} ${of.filter((r) => r.passed).length}/${of.length}`;
        })
        .join(' · '),
    );
  for (const r of results) {
    const u = r.run.usage;
    lines.push(
      `${r.passed ? '✓' : '✗'} ${r.task}  turns=${r.run.turns} tools=${r.run.toolCalls} errors=${r.run.toolErrors} ` +
        `in=${u.inputTokens} out=${u.outputTokens} cache=${u.cacheReadTokens} ` +
        `${r.run.costUsd !== undefined ? `$${r.run.costUsd.toFixed(4)} ` : 'cost n/a '}${(r.run.latencyMs / 1000).toFixed(1)}s` +
        `${r.run.servedBy ? ` (served by ${r.run.servedBy})` : ''}`,
    );
    for (const c of r.checks.filter((c) => !c.passed))
      lines.push(`    ✗ ${c.check.type}: ${c.message}`);
  }
  const unpriced = results.filter((r) => r.run.costUsd === undefined).length;
  if (cost)
    lines.push(
      `total cost ≈ $${cost.toFixed(4)}${unpriced ? ` (excludes ${unpriced} unpriced runs)` : ''}`,
    );
  return lines.join('\n');
}
