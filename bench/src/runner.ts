import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentTools } from '@bowerbirdjs/agent';
import type { BenchAgent } from './agents.js';
import { runCheck } from './checks.js';
import { fixtureStore } from './fixtures.js';
import type { BenchTask, TaskResult } from './types.js';

export function loadTasks(dir: string): BenchTask[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BenchTask);
}

/** Runs one task: fresh fixture, the agent's tool session, then the deterministic checks. */
export async function runTask(task: BenchTask, agent: BenchAgent): Promise<TaskResult> {
  const store = fixtureStore(task.start);
  const start = store.doc;
  const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'pagebench' } });
  const run = await agent.run(task, { store, tools, prompt: task.prompt });
  const checks = task.checks.map((check) => runCheck(check, store, start));
  return { task: task.id, passed: checks.every((c) => c.passed), checks, run };
}

export function formatResults(agent: string, results: TaskResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const cost = results.reduce((sum, r) => sum + (r.run.costUsd ?? 0), 0);
  const lines = [`PageBench: ${agent}: ${passed}/${results.length} tasks passed`];
  for (const r of results) {
    const u = r.run.usage;
    lines.push(
      `${r.passed ? '✓' : '✗'} ${r.task}  turns=${r.run.turns} tools=${r.run.toolCalls} errors=${r.run.toolErrors} ` +
        `in=${u.inputTokens} out=${u.outputTokens} cache=${u.cacheReadTokens} ` +
        `${r.run.costUsd !== undefined ? `$${r.run.costUsd.toFixed(4)} ` : ''}${(r.run.latencyMs / 1000).toFixed(1)}s` +
        `${r.run.servedBy ? ` (served by ${r.run.servedBy})` : ''}`,
    );
    for (const c of r.checks.filter((c) => !c.passed))
      lines.push(`    ✗ ${c.check.type}: ${c.message}`);
  }
  if (cost) lines.push(`total cost ≈ $${cost.toFixed(4)}`);
  return lines.join('\n');
}
