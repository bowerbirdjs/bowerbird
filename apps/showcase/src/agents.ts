import Anthropic from '@anthropic-ai/sdk';
import { type AgentTool, createAgentTools, runTool, toolDefinitions } from '@bowerbirdjs/agent';
import type { Actor, Store } from '@bowerbirdjs/core';

export type ChatLine = { kind: 'user' | 'agent' | 'tool' | 'error' | 'note'; text: string };

export interface AgentRunner {
  id: 'demo' | 'claude';
  label: string;
  actor: Actor;
  send(
    prompt: string,
    store: Store,
    onLine: (line: ChatLine) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

const firstLine = (text: string) => text.split('\n')[0] ?? '';
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Stopped', 'AbortError'));
    });
  });

// ---------------------------------------------------------------------------------------------
// Demo agent: scripted tool calls through the same agent API a real model uses.

type Step = { say?: string; tool?: string; input?: unknown };

const BUILD: Step[] = [
  { say: "I'll read the site first." },
  { tool: 'get_context' },
  { say: 'Building the event page from sections, filled in one change.' },
  {
    tool: 'apply',
    input: {
      label: 'Build event page',
      ops: [
        {
          op: 'section.insert',
          section: 'nav',
          content: {
            brand: { text: 'Design Systems Day' },
            cta: { text: 'Register', href: '#register' },
          },
        },
        {
          op: 'section.insert',
          section: 'hero',
          content: {
            eyebrow: { text: 'May 6, 2027 · Berlin' },
            heading: { text: 'One day about systems that scale design' },
            subheading: {
              text: 'Talks from teams who run design systems for hundreds of products.',
            },
            primary: { text: 'Register', href: '#register' },
            secondary: { text: 'Program', href: '#program' },
          },
        },
        {
          op: 'section.insert',
          section: 'features',
          variant: { columns: '2' },
          content: { heading: { text: 'Why attend' } },
        },
        {
          op: 'section.insert',
          section: 'cta',
          content: { heading: { text: 'Seats are limited' }, button: { text: 'Register now' } },
        },
        {
          op: 'section.insert',
          section: 'footer',
          content: { brand: { text: 'Design Systems Day' } },
        },
      ],
    },
  },
  { say: 'Checking the page for problems.' },
  { tool: 'lint' },
  {
    say: 'Done. The feature cards still have template copy; ask me to write them or edit them yourself.',
  },
];

const SPEAKERS: Step[] = [
  {
    say: 'No prebuilt section fits a speaker list, so I will import a small HTML layout using design tokens.',
  },
  {
    tool: 'import_html',
    input: {
      label: 'Add speakers',
      html: `<section style="padding-block: var(--space-3xl); padding-inline: var(--space-lg); display: grid; gap: var(--space-lg)">
        <h2>Speakers</h2>
        <ul style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-md)">
          <li style="padding: var(--space-lg); border-radius: var(--radius-lg); background: var(--color-surface-muted)"><h3>Ana Ruiz</h3><p>Design systems lead</p></li>
          <li style="padding: var(--space-lg); border-radius: var(--radius-lg); background: var(--color-surface-muted)"><h3>Kofi Mensah</h3><p>Frontend architect</p></li>
          <li style="padding: var(--space-lg); border-radius: var(--radius-lg); background: var(--color-surface-muted)"><h3>Mei Tanaka</h3><p>Accessibility researcher</p></li>
        </ul>
      </section>`,
    },
  },
  { say: 'Added a speakers section.' },
];

const REBRAND: Step[] = [
  { say: 'Switching the brand palette to teal. Everything that uses the accent follows.' },
  {
    tool: 'apply',
    input: {
      label: 'Teal brand',
      ops: [
        { op: 'token.set', path: 'color.brand.50', value: '#f0fdfa' },
        { op: 'token.set', path: 'color.brand.100', value: '#ccfbf1' },
        { op: 'token.set', path: 'color.brand.200', value: '#99f6e4' },
        { op: 'token.set', path: 'color.brand.500', value: '#14b8a6' },
        { op: 'token.set', path: 'color.brand.600', value: '#0d9488' },
        { op: 'token.set', path: 'color.brand.700', value: '#0f766e' },
      ],
    },
  },
  { say: 'Done.' },
];

const LAYOUT: Step[] = [
  { tool: 'get_outline', input: { depth: 1 } },
  { say: 'Switching the hero to the split layout; your text stays.' },
  {
    tool: 'apply',
    input: {
      label: 'Split hero',
      ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'split' } }],
    },
  },
];

const REVIEW: Step[] = [
  { tool: 'lint' },
  {
    say: 'That\'s what I found. Tell me what to change, for example "make the hero split" or "add speakers".',
  },
];

function scriptFor(prompt: string, store: Store): Step[] {
  const p = prompt.toLowerCase();
  const empty = Object.values(store.doc.pages).every(
    (page) => store.view.children(page.rootId).length === 0,
  );
  if (/speaker/.test(p)) return SPEAKERS;
  if (/teal|brand|colou?r/.test(p)) return REBRAND;
  if (/split|layout|image/.test(p)) return LAYOUT;
  if (empty || /build|create|page/.test(p))
    return empty
      ? BUILD
      : [{ say: 'This page already has content, so I will review it instead.' }, ...REVIEW];
  return REVIEW;
}

export const demoAgent: AgentRunner = {
  id: 'demo',
  label: 'Demo agent (scripted, no API key)',
  actor: { kind: 'agent', id: 'demo-agent', name: 'Demo agent' },
  async send(prompt, store, onLine, signal) {
    const tools = createAgentTools({ store, actor: this.actor });
    for (const step of scriptFor(prompt, store)) {
      await sleep(550, signal);
      if (step.say) onLine({ kind: 'agent', text: step.say });
      if (step.tool) {
        const result = runTool(tools, step.tool, step.input ?? {});
        if (result.isError) {
          onLine({
            kind: 'error',
            text: `${step.tool}: ${result.text.split('\n').slice(0, 3).join('\n')}`,
          });
          onLine({
            kind: 'agent',
            text: 'That change was refused, so I stopped. Nothing was applied.',
          });
          return;
        }
        onLine({ kind: 'tool', text: `${step.tool}: ${firstLine(result.text)}` });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Claude agent: a manual tool loop through the dev server's /api/anthropic proxy.

const SYSTEM =
  'You are the page-building assistant inside Acme Events, editing an event page in Bowerbird through tools. ' +
  'Call get_context first. Make the requested changes, check them with get_outline and lint, then reply in one or two ' +
  'short sentences. A person may be editing the same page; only change what was asked.';

const conversations = new WeakMap<Store, Anthropic.Beta.BetaMessageParam[]>();

export const claudeAgent: AgentRunner = {
  id: 'claude',
  label: 'Claude (needs ANTHROPIC_API_KEY on the dev server)',
  actor: { kind: 'agent', id: 'claude', name: 'Claude' },
  async send(prompt, store, onLine, signal) {
    const client = new Anthropic({
      baseURL: `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/api/anthropic`,
      apiKey: 'added-by-the-dev-server',
      dangerouslyAllowBrowser: true,
    });
    const tools: AgentTool[] = createAgentTools({ store, actor: this.actor });
    const definitions = toolDefinitions(tools) as Anthropic.Beta.BetaTool[];
    const messages = conversations.get(store) ?? [];
    conversations.set(store, messages);
    messages.push({ role: 'user', content: prompt });
    for (let turn = 0; turn < 25; turn++) {
      const response = await client.beta.messages.create(
        {
          model: 'claude-opus-5-5',
          max_tokens: 16000,
          system: SYSTEM,
          tools: definitions,
          messages,
          output_config: { effort: 'medium' },
          cache_control: { type: 'ephemeral' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
      messages.push({ role: 'assistant', content: response.content });
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) onLine({ kind: 'agent', text: block.text });
      }
      if (response.stop_reason === 'pause_turn') continue;
      if (response.stop_reason === 'refusal') {
        onLine({ kind: 'error', text: 'Claude declined this request.' });
        return;
      }
      if (response.stop_reason !== 'tool_use') return;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = runTool(tools, block.name, block.input);
        onLine({
          kind: result.isError ? 'error' : 'tool',
          text: `${block.name}: ${result.isError ? result.text.split('\n').slice(0, 3).join('\n') : firstLine(result.text)}`,
        });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.text,
          ...(result.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: 'user', content: results });
    }
    onLine({ kind: 'note', text: 'Stopped after 25 turns.' });
  },
};

export function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Stopped.';
  if (error instanceof Anthropic.AuthenticationError) {
    return 'No API key: start the showcase with ANTHROPIC_API_KEY set, or use the demo agent.';
  }
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited; try again in a moment.';
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
