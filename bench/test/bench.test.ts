import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  type BenchTask,
  claudeAgent,
  loadTasks,
  runTask,
  type ScriptedCall,
  scriptedAgent,
} from '../src/index.js';

const tasks = loadTasks(fileURLToPath(new URL('../tasks', import.meta.url)));
const task = (id: string) => tasks.find((t) => t.id === id) as BenchTask;

const LANDING: ScriptedCall[] = [
  { tool: 'get_context' },
  {
    tool: 'apply',
    input: {
      ops: [
        { op: 'section.insert', section: 'nav', content: { brand: { text: 'Clockwise' } } },
        {
          op: 'section.insert',
          section: 'hero',
          variant: { layout: 'split' },
          content: {
            heading: { text: 'Track time without thinking about it' },
            subheading: { text: 'Clockwise logs your hours and turns them into invoices.' },
          },
        },
        { op: 'section.insert', section: 'features' },
        { op: 'section.insert', section: 'pricing' },
        { op: 'section.insert', section: 'cta', variant: { tone: 'dark' } },
        { op: 'section.insert', section: 'footer' },
      ],
    },
  },
];

const PRICING: ScriptedCall[] = [
  {
    tool: 'apply',
    input: {
      ops: [
        { op: 'props.set', id: 'pricing-1/tier-pro/price', props: { text: '$39' } },
        { op: 'node.duplicate', id: 'pricing-1/tier-pro/feature-4' },
        { op: 'props.set', id: 'pricing-1/tier-pro/feature-5', props: { text: 'SSO' } },
        {
          op: 'node.move',
          id: 'pricing-1/tier-pro/badge',
          parent: 'pricing-1/tier-team',
          before: 'pricing-1/tier-team/name',
        },
      ],
    },
  },
];

describe('PageBench harness', () => {
  it('loads the example tasks', () => {
    expect(tasks.map((t) => t.id)).toEqual(['landing-from-brief', 'precise-pricing-edit']);
  });

  it('passes tasks solved by a correct script', async () => {
    const agent = scriptedAgent({ 'landing-from-brief': LANDING, 'precise-pricing-edit': PRICING });
    for (const t of tasks) {
      const result = await runTask(t, agent);
      expect(result.checks.filter((c) => !c.passed)).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.run.toolErrors).toBe(0);
    }
  });

  it('fails a script that changes more than asked', async () => {
    const sloppy: ScriptedCall[] = [
      ...PRICING,
      {
        tool: 'apply',
        input: { ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Oops' } }] },
      },
    ];
    const result = await runTask(
      task('precise-pricing-edit'),
      scriptedAgent({ 'precise-pricing-edit': sloppy }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.check.type === 'unchangedExcept')?.message).toContain(
      'hero-1/heading',
    );
  });

  it('fails a script that leaves template copy', async () => {
    const lazy: ScriptedCall[] = [
      { tool: 'apply', input: { ops: [{ op: 'section.insert', section: 'hero' }] } },
    ];
    const result = await runTask(
      task('landing-from-brief'),
      scriptedAgent({ 'landing-from-brief': lazy }),
    );
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.check.type === 'noPlaceholderText')?.passed).toBe(false);
  });

  it('counts token and page changes as changes outside the allowed subtrees', async () => {
    const extra: ScriptedCall[] = [
      ...PRICING,
      {
        tool: 'apply',
        input: { ops: [{ op: 'token.set', path: 'color.brand.600', value: '#000000' }] },
      },
    ];
    const result = await runTask(
      task('precise-pricing-edit'),
      scriptedAgent({ 'precise-pricing-edit': extra }),
    );
    expect(result.checks.find((c) => c.check.type === 'unchangedExcept')?.message).toContain(
      'design tokens',
    );
  });

  it('reports max_turns when the turn limit stops a Claude run', async () => {
    const toolUse = {
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu1', name: 'get_outline', input: {} }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    };
    const client = { beta: { messages: { create: async () => toolUse } } } as unknown as Anthropic;
    const result = await runTask(
      task('precise-pricing-edit'),
      claudeAgent({ client, maxTurns: 3 }),
    );
    expect(result.run.stopReason).toBe('max_turns');
    expect(result.run.turns).toBe(3);
    // the last turn's tool calls are not run: there is no turn left to send their results back
    expect(result.run.toolCalls).toBe(2);
    expect(result.run.usage.inputTokens).toBe(30);
    expect(result.run.costUsd).toBeCloseTo((30 * 4 + 15 * 20) / 1e6);
  });
});
