import Anthropic from '@anthropic-ai/sdk';
import { type AgentTool, runTool, toolDefinitions, toolResultContent } from '@bowerbirdjs/agent';
import type { Store } from '@bowerbirdjs/core';
import type { AgentRun, BenchTask, Usage } from './types.js';

export interface AgentEnv {
  store: Store;
  tools: AgentTool[];
  prompt: string;
}

export interface BenchAgent {
  name: string;
  run(task: BenchTask, env: AgentEnv): Promise<AgentRun>;
}

/** USD per million tokens. Cache writes (5-minute TTL) cost 1.25× input. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
};

export function estimateCost(model: string, usage: Usage): number | undefined {
  const p = PRICES[model];
  if (!p) return undefined;
  return (
    (usage.inputTokens * p.input +
      usage.cacheWriteTokens * p.input * 1.25 +
      usage.cacheReadTokens * p.cacheRead +
      usage.outputTokens * p.output) /
    1e6
  );
}

const emptyUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** Kept identical across tasks so the tools + system prefix is cached. */
export const SYSTEM_PROMPT =
  'You are editing a website in Bowerbird through tools. Call get_context first. Make the requested changes, ' +
  'check the result with get_outline and lint, then reply with one short sentence saying what you changed. ' +
  "Don't change anything the task doesn't ask for. Nobody can answer questions while you work: if part of a " +
  'request is refused (permissions, locks, review), do the part you can and say what was refused.';

export interface ClaudeAgentOptions {
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTurns?: number;
  client?: Anthropic;
  /**
   * Server-side refusal fallbacks (on by default). When one is used, `AgentRun.servedBy` names the
   * model that answered, so results can be filtered out of a model comparison.
   */
  fallbacks?: boolean;
}

/** Runs a task with Claude through a manual tool loop, recording turns, tokens, cost and time. */
export function claudeAgent(options: ClaudeAgentOptions = {}): BenchAgent {
  const model = options.model ?? 'claude-opus-5-5';
  const effort = options.effort ?? 'high';
  const maxTurns = options.maxTurns ?? 40;
  return {
    name: `${model} (effort ${effort})`,
    async run(_task, env) {
      const client = options.client ?? new Anthropic();
      const tools = toolDefinitions(env.tools) as Anthropic.Beta.BetaTool[];
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: env.prompt }];
      const usage = emptyUsage();
      let turns = 0;
      let toolCalls = 0;
      let toolErrors = 0;
      let stopReason = 'max_turns';
      let servedBy: string | undefined;
      let finalText = '';
      const started = Date.now();

      while (turns < maxTurns) {
        turns++;
        const response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools,
          messages,
          output_config: { effort },
          cache_control: { type: 'ephemeral' },
          ...(options.fallbacks === false
            ? {}
            : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        });
        usage.inputTokens += response.usage.input_tokens;
        usage.outputTokens += response.usage.output_tokens;
        usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
        if (response.model !== model) servedBy = response.model;
        stopReason = response.stop_reason ?? 'unknown';
        const said = response.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim();
        if (said) finalText = said;
        if (turns >= maxTurns && stopReason === 'tool_use') {
          stopReason = 'max_turns';
          break;
        }

        if (stopReason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content });
          continue;
        }
        if (stopReason !== 'tool_use') break;

        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolCalls++;
          const result = await runTool(env.tools, block.name, block.input);
          if (result.isError) toolErrors++;
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResultContent(result),
            ...(result.isError ? { is_error: true } : {}),
          });
        }
        // All results go back in one user message, so parallel tool calls stay parallel.
        messages.push({ role: 'user', content: results });
      }

      // With a fallback, turns ran on different models; price only runs that stayed on one model.
      const cost = servedBy ? undefined : estimateCost(model, usage);
      return {
        turns,
        toolCalls,
        toolErrors,
        usage,
        ...(cost !== undefined ? { costUsd: cost } : {}),
        latencyMs: Date.now() - started,
        stopReason,
        ...(servedBy ? { servedBy } : {}),
        ...(finalText ? { finalText: finalText.slice(0, 2000) } : {}),
      };
    },
  };
}

export interface ScriptedCall {
  tool: string;
  input?: unknown;
}

/** Replays fixed tool calls per task. Used to test the harness and checks without a model. */
export function scriptedAgent(scripts: Record<string, ScriptedCall[]>): BenchAgent {
  return {
    name: 'scripted',
    async run(task, env) {
      const started = Date.now();
      let toolErrors = 0;
      const calls = scripts[task.id] ?? [];
      for (const call of calls) {
        if ((await runTool(env.tools, call.tool, call.input ?? {})).isError) toolErrors++;
      }
      return {
        turns: calls.length,
        toolCalls: calls.length,
        toolErrors,
        usage: emptyUsage(),
        latencyMs: Date.now() - started,
        stopReason: 'end_turn',
      };
    },
  };
}
