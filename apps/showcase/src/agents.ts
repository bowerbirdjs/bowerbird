import Anthropic from '@anthropic-ai/sdk';
import {
  type AgentTool,
  createAgentTools,
  opsFromPartialInput,
  runTool,
  toolDefinitions,
  toolResultContent,
} from '@bowerbirdjs/agent';
import type { Actor, Store } from '@bowerbirdjs/core';
import { createDomLayoutProvider } from '@bowerbirdjs/layout';

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
    /** Shows ops on the canvas while the agent is still writing them (`null` clears). */
    preview?: (ops: unknown[] | null, actor: Actor) => void,
  ): Promise<void>;
}

/** Agent tools with a browser layout provider, so agents can check the rendered page. */
const toolsFor = (store: Store, actor: Actor) =>
  createAgentTools({ store, actor, layout: createDomLayoutProvider(store) });

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
  { say: 'Looking for a section that fits a speaker list.' },
  { tool: 'list_sections', input: { query: 'speakers' } },
  { say: 'The people section fits. Adding it with the speakers filled in.' },
  {
    tool: 'apply',
    input: {
      label: 'Add speakers',
      ops: [
        {
          op: 'section.insert',
          section: 'team',
          content: {
            heading: { text: 'Speakers' },
            intro: { text: 'People who build and run design systems every day.' },
            'person-1/name': { text: 'Ana Ruiz' },
            'person-1/role': { text: 'Design systems lead' },
            'person-1/bio': { text: 'On keeping one system across forty products.' },
            'person-1/photo': { alt: 'Portrait of Ana Ruiz' },
            'person-2/name': { text: 'Kofi Mensah' },
            'person-2/role': { text: 'Frontend architect' },
            'person-2/bio': { text: 'On tokens that survive a rebrand.' },
            'person-2/photo': { alt: 'Portrait of Kofi Mensah' },
            'person-3/name': { text: 'Mei Tanaka' },
            'person-3/role': { text: 'Accessibility researcher' },
            'person-3/bio': { text: 'On testing components with the people who use them.' },
            'person-3/photo': { alt: 'Portrait of Mei Tanaka' },
            'person-4/name': { text: 'Luca Moretti' },
            'person-4/role': { text: 'Product designer' },
            'person-4/bio': { text: 'On saying no to the fortieth button variant.' },
            'person-4/photo': { alt: 'Portrait of Luca Moretti' },
          },
        },
      ],
    },
  },
  { say: 'Added a speakers section.' },
];

const FAQ: Step[] = [
  { say: 'Adding questions and answers as an accordion, with the first one open.' },
  {
    tool: 'apply',
    input: {
      label: 'Add questions and answers',
      ops: [
        {
          op: 'section.insert',
          section: 'faq',
          content: {
            heading: { text: 'Good to know' },
            intro: { text: 'What people ask before they book.' },
            'item-1/question': { text: 'Is the venue accessible?' },
            'item-1/answer': {
              text: 'Yes. Every room is step-free, and talks are captioned live.',
            },
            'item-2/question': { text: 'Can I get a refund?' },
            'item-2/answer': {
              text: 'Up to 30 days before the event; after that you can pass your ticket on.',
            },
            'item-3/question': { text: 'Will talks be recorded?' },
            'item-3/answer': { text: 'Yes. Recordings go to every ticket holder two weeks later.' },
            'item-4/question': { text: 'Is lunch included?' },
            'item-4/answer': {
              text: 'Lunch, coffee and the evening reception are part of every ticket.',
            },
          },
        },
      ],
    },
  },
  { say: 'Added the questions. Open the page in Preview to fold and unfold them.' },
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
        { op: 'token.set', path: 'color.brand.300', value: '#5eead4' },
        { op: 'token.set', path: 'color.brand.400', value: '#2dd4bf' },
        { op: 'token.set', path: 'color.brand.500', value: '#14b8a6' },
        // Darker than Tailwind's teal-600, so white text on buttons stays readable (AA).
        { op: 'token.set', path: 'color.brand.600', value: '#0f766e' },
        { op: 'token.set', path: 'color.brand.700', value: '#115e59' },
      ],
    },
  },
  { say: 'Done.' },
];

/** Reads the page like a real agent would: find the hero first, don't assume its id. */
function layoutSteps(store: Store): Step[] {
  const hero = Object.values(store.doc.nodes).find(
    (n) => n.section?.name === 'hero' && store.view.node(n.parent ?? '')?.parent === null,
  );
  if (!hero)
    return [
      { tool: 'get_outline', input: { depth: 1 } },
      { say: 'There is no hero section on this page to change.' },
    ];
  if (hero.section?.variant.layout === 'split')
    return [
      { tool: 'get_outline', input: { depth: 1 } },
      { say: `The hero (${hero.id}) already uses the split layout.` },
    ];
  return [
    { tool: 'get_outline', input: { depth: 1 } },
    { say: 'Switching the hero to the split layout; your text stays.' },
    {
      tool: 'apply',
      input: {
        label: 'Split hero',
        ops: [{ op: 'section.variant', id: hero.id, variant: { layout: 'split' } }],
      },
    },
  ];
}

const MOBILE: Step[] = [
  { say: 'Laying the page out at phone width to check it.' },
  { tool: 'get_layout', input: { bp: 'base', depth: 1 } },
  { say: 'Those are the boxes and any layout problems at 390px.' },
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
  if (/faq|question/.test(p)) return FAQ;
  if (/mobile|phone|layout check|check the/.test(p)) return MOBILE;
  if (/teal|brand|colou?r/.test(p)) return REBRAND;
  if (/split|layout|image/.test(p)) return layoutSteps(store);
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
  async send(prompt, store, onLine, signal, preview) {
    const tools = toolsFor(store, this.actor);
    let proposed = false;
    for (const step of scriptFor(prompt, store)) {
      await sleep(550, signal);
      if (step.say) {
        // After proposing, the change isn't done: it waits for the person.
        const text =
          proposed && /^(Done|Added)/.test(step.say)
            ? 'I’ve proposed this for your review: accept or reject it in the Review tab.'
            : step.say;
        onLine({ kind: 'agent', text });
      }
      // Stream the ops onto the canvas one by one, as a real model would write them.
      const ops = step.tool === 'apply' ? opsFromPartialInput(step.input) : [];
      if (preview && ops.length > 1) {
        try {
          for (let k = 1; k <= ops.length; k++) {
            preview(ops.slice(0, k), this.actor);
            await sleep(350, signal);
          }
        } finally {
          preview(null, this.actor);
        }
      }
      if (step.tool) {
        const result = await runTool(tools, step.tool, step.input ?? {});
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
        if (/^Proposed cs-/.test(result.text)) proposed = true;
        onLine({ kind: 'tool', text: `${step.tool}: ${firstLine(result.text)}` });
      }
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Claude agent: a manual tool loop through the dev server's /api/anthropic proxy.

const SYSTEM =
  'You are the page-building assistant inside Acme Events, editing an event page in Bowerbird through tools. ' +
  'Call get_context first. Make the requested changes, check them with get_outline, lint and get_layout (at bp "base" ' +
  'for phones), then reply in one or two short sentences. A person may be editing the same page; only change what was ' +
  'asked, and leave text and styles they edited alone unless they ask.';

const conversations = new WeakMap<Store, Anthropic.Beta.BetaMessageParam[]>();

export const claudeAgent: AgentRunner = {
  id: 'claude',
  label: 'Claude (needs ANTHROPIC_API_KEY on the dev server)',
  actor: { kind: 'agent', id: 'claude', name: 'Claude' },
  async send(prompt, store, onLine, signal, preview) {
    const client = new Anthropic({
      baseURL: `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/api/anthropic`,
      apiKey: 'added-by-the-dev-server',
      dangerouslyAllowBrowser: true,
    });
    const tools: AgentTool[] = toolsFor(store, this.actor);
    const actor = this.actor;
    // Stream apply's input as it is written (not buffered per parameter), so the canvas can
    // preview the ops while Claude is still writing them.
    const definitions = toolDefinitions(tools).map((d) =>
      d.name === 'apply' ? { ...d, eager_input_streaming: true } : d,
    ) as Anthropic.Beta.BetaTool[];
    const messages = conversations.get(store) ?? [];
    conversations.set(store, messages);
    // If this send is stopped or fails, the conversation goes back to where it was, so a
    // cancelled request can't be carried out by a later one.
    const start = messages.length;
    messages.push({ role: 'user', content: prompt });
    try {
      await loop();
    } catch (error) {
      messages.length = start;
      throw error;
    }

    async function loop() {
      for (let turn = 0; turn < 25; turn++) {
        const stream = client.beta.messages.stream(
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
        // Preview apply calls on the canvas while their input streams in.
        let tool: string | undefined;
        let shown = 0;
        stream.on('streamEvent', (event) => {
          if (event.type === 'content_block_start')
            tool = event.content_block.type === 'tool_use' ? event.content_block.name : undefined;
        });
        stream.on('inputJson', (_partial, snapshot) => {
          if (tool !== 'apply' || !preview) return;
          const ops = opsFromPartialInput(snapshot);
          if (ops.length === shown) return;
          shown = ops.length;
          preview(ops, actor);
        });
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await stream.finalMessage();
        } finally {
          preview?.(null, actor);
        }
        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim())
            onLine({ kind: 'agent', text: block.text });
        }
        if (response.stop_reason === 'pause_turn') {
          messages.push({ role: 'assistant', content: response.content });
          continue;
        }
        if (response.stop_reason !== 'tool_use') {
          // A tool call without its result would make every later request fail, so keep only
          // complete blocks (e.g. when the response was cut off at max_tokens).
          const content = response.content.filter((b) => b.type !== 'tool_use');
          messages.push({
            role: 'assistant',
            content: content.length ? content : [{ type: 'text', text: '(no reply)' }],
          });
          if (response.stop_reason === 'refusal')
            onLine({ kind: 'error', text: 'Claude declined this request.' });
          else if (response.stop_reason === 'max_tokens')
            onLine({
              kind: 'note',
              text: 'The reply was cut off (length limit); ask Claude to continue.',
            });
          return;
        }
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const result = await runTool(tools, block.name, block.input);
          onLine({
            kind: result.isError ? 'error' : 'tool',
            text: `${block.name}: ${result.isError ? result.text.split('\n').slice(0, 3).join('\n') : firstLine(result.text)}`,
          });
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResultContent(result),
            ...(result.isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
      }
      onLine({ kind: 'note', text: 'Stopped after 25 turns.' });
    }
  },
};

export function describeError(error: unknown): string {
  if (error instanceof Anthropic.APIUserAbortError) return 'Stopped.';
  if (error instanceof DOMException && error.name === 'AbortError') return 'Stopped.';
  if (error instanceof Anthropic.AuthenticationError) {
    // The dev server says which key it sent (file and masked key), or why it has none.
    const sent = error.headers?.get('x-showcase-api-key');
    const said = error.apiMessage ?? error.message;
    return sent
      ? `The API rejected the key from ${sent}: ${said}. Check the key in the Claude Console, or use the demo agent.`
      : `${said.replace(/\.?$/, '.')} The demo agent works without a key.`;
  }
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited; try again in a moment.';
  if (error instanceof Anthropic.APIError)
    return `API error${error.status ? ` ${error.status}` : ''}: ${error.apiMessage ?? error.message}`;
  return error instanceof Error ? error.message : String(error);
}
