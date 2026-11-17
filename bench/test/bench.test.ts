import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type BenchTask,
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
});
