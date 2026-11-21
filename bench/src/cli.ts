#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { claudeAgent, scriptedAgent } from './agents.js';
import { formatResults, loadSolutions, loadTasks, runTask } from './runner.js';
import type { TaskResult } from './types.js';

const USAGE = `pagebench: run page-editing tasks against Claude

Options:
  --model <id>        Model (default claude-opus-5-5)
  --effort <level>    low | medium | high | xhigh | max (default high)
  --task <id>         Run only these tasks (repeatable)
  --category <name>   Run only these categories (repeatable): build, precise, restyle,
                      responsive, policy, concurrency
  --scripted          Replay the reference solutions instead of calling a model (no key needed)
  --max-turns <n>     Turn limit per task (default 40)
  --no-fallbacks      Disable server-side refusal fallbacks
  --out <file>        Write full results as JSON

Credentials come from ANTHROPIC_API_KEY (the environment, or a .env file in the current directory
or the repository root) or an \`ant auth login\` profile.`;

/** Fills in variables from .env files (the current directory's first); set ones stay as they are. */
function loadDotEnv(): void {
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  for (const file of new Set([resolve('.env'), resolve(repo, '.env')])) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8'))))
      if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

async function main() {
  loadDotEnv();
  // pnpm hands a script the `--` typed before its options (`pnpm bench -- --scripted`); npm
  // swallows it. Both spellings work.
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string', default: 'claude-opus-5-5' },
      effort: { type: 'string', default: 'high' },
      task: { type: 'string', multiple: true },
      category: { type: 'string', multiple: true },
      scripted: { type: 'boolean', default: false },
      'max-turns': { type: 'string', default: '40' },
      'no-fallbacks': { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const effort = values.effort as (typeof EFFORTS)[number];
  if (!EFFORTS.includes(effort)) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}.`);

  const tasksDir = fileURLToPath(new URL('../tasks', import.meta.url));
  const tasks = loadTasks(tasksDir).filter(
    (t) =>
      (!values.task?.length || values.task.includes(t.id)) &&
      (!values.category?.length || values.category.includes(t.category)),
  );
  if (!tasks.length) throw new Error('No tasks matched.');

  const agent = values.scripted
    ? scriptedAgent(loadSolutions(fileURLToPath(new URL('../solutions', import.meta.url))))
    : claudeAgent({
        model: values.model,
        effort,
        maxTurns: Number(values['max-turns']),
        fallbacks: !values['no-fallbacks'],
      });
  const results: TaskResult[] = [];
  for (const task of tasks) {
    console.error(`running ${task.id}…`);
    results.push(await runTask(task, agent));
  }
  console.log(formatResults(agent.name, results));
  if (values.out)
    await writeFile(values.out, `${JSON.stringify({ agent: agent.name, results }, null, 2)}\n`);
  if (results.some((r) => r.run.servedBy)) {
    console.log(
      'Note: some tasks were answered by a fallback model; exclude them when comparing models.',
    );
  }
  // A reference solution that fails its own task means the suite is broken, so that run fails
  // (CI relies on it). A model failing tasks is a result, not an error.
  if (values.scripted && results.some((r) => !r.passed)) process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof Anthropic.AuthenticationError) {
    console.error(
      'Authentication failed: check ANTHROPIC_API_KEY (environment or .env) or run `ant auth login`.',
    );
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error('Rate limited; try again later.');
  } else if (error instanceof Anthropic.APIError) {
    console.error(`API error ${error.status}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
});
