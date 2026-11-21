import { fileURLToPath } from 'node:url';
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  type BenchTask,
  claudeAgent,
  FIXTURE_NAMES,
  formatResults,
  loadSolutions,
  loadTasks,
  runTask,
  type ScriptedCall,
  scriptedAgent,
} from '../src/index.js';

const tasks = loadTasks(fileURLToPath(new URL('../tasks', import.meta.url)));
const solutions = loadSolutions(fileURLToPath(new URL('../solutions', import.meta.url)));
const task = (id: string) => {
  const found = tasks.find((t) => t.id === id);
  if (!found) throw new Error(`no task ${id}`);
  return found as BenchTask;
};
const apply = (ops: unknown[], extra: Record<string, unknown> = {}): ScriptedCall => ({
  tool: 'apply',
  input: { ops, ...extra },
});
const run = (id: string, calls: ScriptedCall[]) =>
  runTask(task(id), scriptedAgent({ [id]: calls }));
const failed = async (id: string, calls: ScriptedCall[]) =>
  (await run(id, calls)).checks.filter((c) => !c.passed).map((c) => c.check.type);

/** Solutions that run into a refusal on purpose: recovering from it is the task. */
const EXPECTED_ERRORS: Record<string, number> = {
  'tokens-only-sizes': 1,
  'content-only-agent': 1,
  'locked-footer': 1,
  'stale-revision': 1,
  'concurrent-removal': 1,
};

describe('PageBench tasks', () => {
  it('cover every category, with ids, fixtures and solutions in order', () => {
    expect(tasks.length).toBeGreaterThanOrEqual(30);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    const perCategory: Record<string, number> = {};
    for (const t of tasks) {
      perCategory[t.category] = (perCategory[t.category] ?? 0) + 1;
      expect(FIXTURE_NAMES, t.id).toContain(t.start);
      expect(t.prompt.length, t.id).toBeGreaterThan(30);
      expect(t.checks.length, t.id).toBeGreaterThanOrEqual(2);
    }
    expect(Object.keys(perCategory).sort()).toEqual([
      'build',
      'concurrency',
      'policy',
      'precise',
      'responsive',
      'restyle',
    ]);
    for (const [category, count] of Object.entries(perCategory))
      expect(count, category).toBeGreaterThanOrEqual(4);
    expect(Object.keys(solutions).sort()).toEqual(tasks.map((t) => t.id).sort());
  });

  for (const t of tasks) {
    it(`${t.category}/${t.id}: the reference solution passes, doing nothing fails`, async () => {
      const solved = await runTask(t, scriptedAgent(solutions));
      expect(
        solved.checks.filter((c) => !c.passed).map((c) => `${c.check.type}: ${c.message}`),
      ).toEqual([]);
      expect(solved.passed).toBe(true);
      expect(solved.run.toolErrors, 'tool errors').toBe(EXPECTED_ERRORS[t.id] ?? 0);
      // A task that passes untouched measures nothing.
      const idle = await runTask(t, scriptedAgent({ [t.id]: [{ tool: 'get_context' }] }));
      expect(idle.passed, 'passes without any change').toBe(false);
    });
  }
});

describe('PageBench checks catch plausible mistakes', () => {
  it('changing more than asked', async () => {
    const sloppy = [
      ...solutions['precise-pricing-edit']!,
      apply([{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Oops' } }]),
    ];
    const result = await run('precise-pricing-edit', sloppy);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.check.type === 'unchangedExcept')?.message).toContain(
      'hero-1/heading',
    );
    // Tokens and page settings count as changes too.
    const tokens = await run('precise-pricing-edit', [
      ...solutions['precise-pricing-edit']!,
      apply([{ op: 'token.set', path: 'color.brand.600', value: '#000000' }]),
    ]);
    expect(tokens.checks.find((c) => c.check.type === 'unchangedExcept')?.message).toContain(
      'design tokens',
    );
  });

  it('leaving template copy in place', async () => {
    const lazy = [apply([{ op: 'section.insert', section: 'hero' }])];
    const result = await run('landing-from-brief', lazy);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.check.type === 'noPlaceholderText')?.passed).toBe(false);
    // Sections inserted but not filled in.
    const unfilled = apply(
      ['nav', 'hero', 'schedule', 'team', 'faq', 'newsletter', 'footer'].map((section) => ({
        op: 'section.insert',
        section,
        ...(section === 'nav' ? { content: { brand: { text: 'Glow Conf' } } } : {}),
      })),
    );
    expect(await failed('event-page-from-brief', [unfilled])).toEqual([
      'noPlaceholderIn',
      'noPlaceholderIn',
      'noPlaceholderIn',
    ]);
  });

  it('overwriting what a person changed meanwhile', async () => {
    // Replacing the whole sentence from a stale read loses Sam's rewrite.
    expect(
      await failed('concurrent-text-edit', [
        { tool: 'get_outline' },
        apply([
          {
            op: 'props.set',
            id: 'hero-1/subheading',
            props: { text: 'Time tracking that turns into paid invoices.' },
          },
        ]),
      ]),
    ).toEqual(['propEquals']);
    // Without baseRevision nothing stops the write; here that is harmless (another node), so the
    // task passes either way: what it measures is recovery when the agent does pass one.
    const noBase = await run('stale-revision', [
      apply([{ op: 'props.set', id: 'hero-1/primary', props: { text: 'Start free' } }]),
    ]);
    expect(noBase.passed).toBe(true);
    // Giving up after the stale-revision error fails.
    expect(
      await failed('stale-revision', [
        apply([{ op: 'props.set', id: 'hero-1/primary', props: { text: 'Start free' } }], {
          baseRevision: 1,
        }),
      ]),
    ).toEqual(['propEquals']);
    // Giving up when one of six ops fails leaves five titles unchanged.
    expect(
      await failed('concurrent-removal', solutions['concurrent-removal']!.slice(0, 2)),
    ).toEqual(['texts']);
  });

  it('working around a policy instead of respecting it', async () => {
    // Overwriting Sam's heading because the task "asked for a rewrite".
    expect(
      await failed('protect-human-edits', [
        apply(
          [
            { op: 'props.set', id: 'hero-1/heading', props: { text: 'Mine now' } },
            { op: 'props.set', id: 'hero-1/subheading', props: { text: 'Punchy.' } },
          ],
          { overwrite: true },
        ),
      ]),
    ).toEqual(['propEquals', 'proposals', 'unchangedExcept']);
    // Proposing twice because the first answer looked like nothing happened.
    const cta = solutions['review-required']![1]!;
    expect(await failed('review-required', [cta, cta])).toEqual(['proposals']);
    // Raw values are refused by the store, so a script that never switches to tokens changes nothing.
    expect(await failed('tokens-only-sizes', solutions['tokens-only-sizes']!.slice(0, 1))).toEqual([
      'styleEquals',
      'styleEquals',
    ]);
    // A content-only agent that stops at the refusal hasn't done the part it could.
    expect(
      await failed('content-only-agent', solutions['content-only-agent']!.slice(0, 2)),
    ).toEqual(['propEquals']);
  });

  it('styling the wrong breakpoint, state or element', async () => {
    expect(
      await failed('responsive-heading', [
        apply([{ op: 'style.set', id: 'features-1/heading', css: 'font-size: var(--text-4xl)' }]),
      ]),
    ).toEqual(['styleEquals', 'styleAbsent']);
    expect(
      await failed('hover-accent', [
        apply([{ op: 'style.set', id: 'hero-1/secondary', css: 'color: var(--color-accent)' }]),
      ]),
    ).toEqual(['styleEquals', 'styleAbsent']);
    expect(
      await failed('mobile-hide-eyebrow', [
        apply([{ op: 'style.set', id: 'hero-1/eyebrow', css: 'display: none' }]),
      ]),
    ).toEqual(['styleEquals']);
    // Recolouring elements one by one instead of the palette.
    expect(
      await failed('rebrand-palette', [
        apply([{ op: 'token.set', path: 'color.accent', value: '#15803d' }]),
      ]),
    ).toContain('tokenEquals');
    // Equivalent spellings are accepted.
    expect(
      await failed('desktop-four-columns', [
        apply([
          {
            op: 'style.set',
            id: 'features-1/grid',
            bp: 'lg',
            css: 'grid-template-columns: repeat(4,minmax(0,1fr))',
          },
        ]),
      ]),
    ).toEqual([]);
    expect(
      await failed('dark-theme-accent', [
        apply([
          { op: 'token.set', path: 'color.accent', theme: 'dark', value: '#A5B4FC' },
          {
            op: 'token.set',
            path: 'color.accent-hover',
            theme: 'dark',
            value: '{color.brand.200}',
          },
        ]),
      ]),
    ).toEqual([]);
  });

  it('building the right things in the wrong shape', async () => {
    // Separate footers instead of one linked component.
    const separate = solutions['two-pages-shared-chrome']!.map((call) =>
      call.tool !== 'apply'
        ? call
        : apply(
            (call.input as { ops: Record<string, unknown>[] }).ops.flatMap((op) =>
              op.op === 'symbol.create'
                ? []
                : op.op === 'symbol.insert'
                  ? [
                      {
                        op: 'section.insert',
                        section: op.symbol === 'site-nav' ? 'nav' : 'footer',
                        page: 'about',
                        ...(op.symbol === 'site-nav'
                          ? { content: { brand: { text: 'Crumb' } } }
                          : {}),
                      },
                    ]
                  : [op],
            ),
          ),
    );
    expect(await failed('two-pages-shared-chrome', separate)).toEqual(['linked', 'linked']);
    // The new question added, but the template's fourth one left in.
    const keepFourth = solutions['faq-three-questions']!.map((call) =>
      call.tool !== 'apply'
        ? call
        : apply(
            (call.input as { ops: { op: string }[] }).ops.filter((op) => op.op !== 'node.remove'),
          ),
    );
    expect(await failed('faq-three-questions', keepFourth)).toEqual(['find', 'texts', 'texts']);
    // The field appended instead of placed between Name and Email.
    expect(
      await failed('contact-form-fields', [
        apply([
          {
            op: 'node.insert',
            parent: 'contact-1/form',
            node: { type: 'field', props: { name: 'company', label: 'Company' } },
          },
          { op: 'props.set', id: 'contact-1/message', props: { required: false } },
          {
            op: 'props.set',
            id: 'contact-1/form',
            props: { action: 'https://example.com/api/contact' },
          },
        ]),
      ]),
    ).toEqual(['children']);
  });
});

describe('PageBench harness', () => {
  it('summarises results per category', async () => {
    const some = ['landing-from-brief', 'fix-typos', 'locked-footer'].map(task);
    const results = await Promise.all(some.map((t) => runTask(t, scriptedAgent(solutions))));
    results[1] = await run('fix-typos', []);
    const text = formatResults('scripted', results);
    expect(text).toContain('PageBench: scripted: 2/3 tasks passed (67%)');
    expect(text).toContain('build 1/1 · precise 0/1 · policy 1/1');
    expect(text).toContain('✗ fix-typos');
    expect(text).toContain('    ✗ propEquals: text: "Time traking that turns into invoicess."');
  });

  it('reports max_turns when the turn limit stops a Claude run, and keeps what the agent said', async () => {
    const toolUse = {
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Reading the page.' },
        { type: 'tool_use', id: 'tu1', name: 'get_outline', input: {} },
      ],
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
    expect(result.run.finalText).toBe('Reading the page.');
    expect(result.category).toBe('precise');
  });
});
