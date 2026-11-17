import {
  type Actor,
  type ApplyResult,
  type BNode,
  type ComponentDef,
  describeNode,
  flattenTokens,
  formatIssue,
  type NodeInput,
  OpSchema,
  outline,
  resolveVariant,
  type SectionDef,
  STATE_PSEUDO,
  type Store,
  slugify,
} from '@bowerbirdjs/core';
import { z } from 'zod';
import { AGENT_GUIDE } from './guide.js';

export { AGENT_GUIDE } from './guide.js';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface AgentTool {
  name: string;
  title: string;
  description: string;
  /** Input schema (also used to generate JSON Schema for tool definitions). */
  input: z.ZodObject;
  annotations: ToolAnnotations;
  /** Runs the tool. Input is validated here, so raw model output can be passed in. */
  run(input: unknown): ToolResult;
}

export interface AgentToolsOptions {
  store: Store;
  /** The actor recorded on every change. Can be a function, e.g. to use the MCP client's name. */
  actor?: Actor | (() => Actor);
  /** Extra lines appended to get_context, e.g. a preview URL. */
  contextNotes?: () => string[];
}

const DEFAULT_ACTOR: Actor = { kind: 'agent', id: 'agent' };

// ---------------------------------------------------------------------------------------------
// Formatting helpers

/** Addressable parts of a section template: path relative to the section id, plus a summary. */
export function sectionParts(
  def: SectionDef,
  variant?: Record<string, string>,
): { path: string; summary: string }[] {
  const { variant: v } = resolveVariant(def, variant);
  const out: { path: string; summary: string }[] = [];
  const walk = (input: NodeInput, scope: string) => {
    let childScope = scope;
    if (input.part) {
      const path = scope + slugify(input.key ? `${input.part}-${input.key}` : input.part);
      const fake = {
        id: path,
        type: input.type,
        parent: 'x',
        order: 'a0',
        props: (input.props ?? {}) as BNode['props'],
      };
      out.push({
        path,
        summary: describeNode(fake as BNode, 40)
          .slice(path.length)
          .trim(),
      });
      if (input.key) childScope = `${path}/`;
    }
    for (const child of input.children ?? []) walk(child, childScope);
  };
  for (const child of def.template({ variant: v }).children ?? []) walk(child, '');
  return out;
}

function describeSection(def: SectionDef, detailed: boolean): string {
  const lines = [
    `${def.name} — ${def.title}${def.category ? ` (${def.category})` : ''}`,
    `  ${def.description}`,
  ];
  const variants = Object.entries(def.variants ?? {});
  if (variants.length)
    lines.push(
      `  variants: ${variants.map(([k, vs]) => `${k}=${vs.join('|')}`).join('; ')} (first is default)`,
    );
  const vars = Object.entries(def.vars ?? {});
  if (vars.length)
    lines.push(
      `  vars: ${vars.map(([n, s]) => `${n} (${s.type}, default ${s.default})`).join('; ')}`,
    );
  if (detailed) {
    const combos = variants.length
      ? variants[0]![1].map((value) => ({ [variants[0]![0]]: value }))
      : [{}];
    for (const combo of combos) {
      const label = Object.keys(combo).length
        ? ` [${Object.entries(combo)
            .map(([k, v]) => `${k}=${v}`)
            .join(',')}]`
        : '';
      lines.push(`  parts${label}:`);
      for (const p of sectionParts(def, combo)) lines.push(`    ${p.path}  ${p.summary}`);
    }
  } else {
    lines.push(
      `  parts: ${sectionParts(def)
        .map((p) => p.path)
        .join(', ')}`,
    );
  }
  return lines.join('\n');
}

function describeComponent(def: ComponentDef): string {
  return `${def.name}: ${def.description}`;
}

function compactNode(store: Store, n: BNode) {
  return {
    id: n.id,
    type: n.type,
    ...(n.section ? { section: n.section } : {}),
    ...(n.part ? { part: n.part } : {}),
    ...(n.key ? { key: n.key } : {}),
    props: n.props,
    ...(n.styles ? { styles: n.styles } : {}),
    ...(n.vars ? { vars: n.vars } : {}),
    parent: n.parent,
    children: store.view.children(n.id).map((c) => c.id),
  };
}

export function formatApplyResult(store: Store, result: ApplyResult, opCount: number): ToolResult {
  if (!result.ok) {
    const lines = [`No changes were applied (document is at revision ${result.revision}).`];
    for (const issue of result.errors) lines.push(`- ${formatIssue(issue)}`);
    if (result.failedOp !== undefined && result.failedOp < opCount - 1) {
      lines.push(
        `ops after ops[${result.failedOp}] were not checked; fix the error and send all ops again.`,
      );
    }
    return { text: lines.join('\n'), isError: true };
  }
  const s = result.summary;
  const lines: string[] = [
    result.dryRun
      ? `Dry run OK at revision ${result.revision}; nothing was committed.`
      : result.txId
        ? `Applied ${result.txId}. Document is now at revision ${result.revision}.`
        : `Nothing changed (revision ${result.revision}).`,
  ];
  const brief = (ids: string[]) => {
    const tops = ids.filter((id) => !ids.some((o) => o !== id && id.startsWith(`${o}/`)));
    return `${tops.slice(0, 20).join(', ')}${tops.length > 20 ? `, … (${tops.length - 20} more)` : ''}${
      ids.length > tops.length ? ` (+${ids.length - tops.length} nested)` : ''
    }`;
  };
  if (s.created.length) lines.push(`Created: ${brief(s.created)}`);
  if (s.updated.length) lines.push(`Updated: ${brief(s.updated)}`);
  if (s.removed.length) lines.push(`Removed: ${brief(s.removed)}`);
  if (s.pages.length) lines.push(`Pages changed: ${s.pages.join(', ')}`);
  if (s.tokens) lines.push('Tokens or themes changed.');
  for (const w of result.warnings) lines.push(`Warning: ${formatIssue(w)}`);
  if (!result.dryRun && s.created.length) {
    const roots = s.created
      .filter((id) => !s.created.some((o) => o !== id && id.startsWith(`${o}/`)))
      .slice(0, 5);
    for (const id of roots) lines.push(outline(store.view, { root: id, depth: 2 }));
  }
  return { text: lines.join('\n') };
}

// ---------------------------------------------------------------------------------------------
// Tools

const ApplyInput = z.object({
  ops: z.array(OpSchema).min(1).describe('Operations to apply in order, atomically.'),
  label: z
    .string()
    .optional()
    .describe('Short description of the change for history, e.g. "Add pricing section".'),
  baseRevision: z
    .number()
    .int()
    .optional()
    .describe('Revision you read; the call fails if someone changed the document since.'),
  dryRun: z.boolean().optional().describe('Validate and report without committing.'),
});

/** Loose runtime parsing for apply: ops are validated by the store, which gives better errors. */
const ApplyRuntime = z.object({
  ops: z.array(z.unknown()),
  label: z.string().optional(),
  baseRevision: z.number().int().optional(),
  dryRun: z.boolean().optional(),
});

function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { data: z.infer<T> } | { error: ToolResult } {
  const res = schema.safeParse(input ?? {});
  if (res.success) return { data: res.data };
  return {
    error: {
      isError: true,
      text: `Invalid input:\n${res.error.issues.map((i) => `- ${i.path.join('.') || '(input)'}: ${i.message}`).join('\n')}`,
    },
  };
}

function tool<S extends z.ZodObject>(
  def: Omit<AgentTool, 'run' | 'input'> & { input: S; run: (input: z.infer<S>) => ToolResult },
  runtime: z.ZodType = def.input,
): AgentTool {
  return {
    ...def,
    run(input) {
      const parsed = parseInput(runtime, input);
      if ('error' in parsed) return parsed.error;
      try {
        return def.run(parsed.data as z.infer<S>);
      } catch (error) {
        return {
          isError: true,
          text: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}

/** The agent-facing tool set for one store. */
export function createAgentTools(options: AgentToolsOptions): AgentTool[] {
  const { store } = options;
  const actor = () =>
    typeof options.actor === 'function' ? options.actor() : (options.actor ?? DEFAULT_ACTOR);

  return [
    tool({
      name: 'get_context',
      title: 'Get site context',
      description:
        'Start here. Returns the editing guide, pages, breakpoints, available sections and components, token families and policy.',
      input: z.object({}),
      annotations: { readOnlyHint: true },
      run: () => {
        const doc = store.doc;
        const tokens = flattenTokens(doc.tokens).tokens;
        const families = new Map<string, number>();
        for (const t of tokens)
          families.set(t.path.split('.')[0]!, (families.get(t.path.split('.')[0]!) ?? 0) + 1);
        const pages = Object.values(doc.pages);
        const lines = [
          `# Site context (revision ${doc.revision})`,
          `Pages: ${pages.map((p) => `${p.id} "${p.path}" (${p.title})`).join('; ') || 'none yet — create one with page.create'}`,
          `Breakpoints (mobile-first): ${doc.breakpoints.map((b) => `${b.id} ≥${b.minWidth}px`).join(', ')}`,
          `Styles: ${store.policy.allowRawValues(actor()) ? 'raw CSS values are allowed, but prefer tokens' : 'only design tokens are allowed (no px, hex colours, etc.)'}`,
          `Sections: ${store.registry
            .listSections()
            .map((s) => s.name)
            .join(', ')} (list_sections for parts and variants)`,
          `Components: ${store.registry
            .listComponents()
            .filter((c) => c.insertable !== false)
            .map((c) => c.name)
            .join(', ')}`,
          `Tokens: ${[...families].map(([f, n]) => `${f} (${n})`).join(', ')} (list_tokens to see them)`,
          `Themes: ${Object.keys(doc.themes).join(', ') || 'none'}`,
          ...(options.contextNotes?.() ?? []),
          '',
          AGENT_GUIDE,
        ];
        return { text: lines.join('\n') };
      },
    }),
    tool({
      name: 'get_outline',
      title: 'Get page outline',
      description:
        'Compact tree of a page (or all pages, or one subtree): one line per node with its id, type, text and style markers. "[+N more]" marks folded subtrees.',
      input: z.object({
        page: z.string().optional().describe('Page id; omit for all pages.'),
        root: z.string().optional().describe('Show only this node and its subtree.'),
        depth: z.number().int().min(1).max(12).optional().describe('Levels to show (default 3).'),
      }),
      annotations: { readOnlyHint: true },
      run: (input) => ({
        text: `revision ${store.doc.revision}\n${outline(store.view, {
          ...(input.page ? { page: input.page } : {}),
          ...(input.root ? { root: input.root } : {}),
          ...(input.depth ? { depth: input.depth } : {}),
        })}`,
      }),
    }),
    tool({
      name: 'get_nodes',
      title: 'Get nodes',
      description:
        'Full data for specific nodes: props, styles (per breakpoint/state), variables and child ids.',
      input: z.object({ ids: z.array(z.string()).min(1).max(50) }),
      annotations: { readOnlyHint: true },
      run: ({ ids }) => {
        const found = ids.map((id) => store.view.node(id)).filter((n): n is BNode => !!n);
        const missing = ids.filter((id) => !store.view.node(id));
        const text = JSON.stringify(
          found.map((n) => compactNode(store, n)),
          null,
          1,
        );
        return {
          text: missing.length ? `${text}\nNot found: ${missing.join(', ')}` : text,
          isError: !found.length,
        };
      },
    }),
    tool({
      name: 'list_sections',
      title: 'List sections',
      description:
        'Prebuilt sections you can insert with section.insert: purpose, variants, style variables and part paths (for "content" and later edits). Give "name" for full part details.',
      input: z.object({
        query: z
          .string()
          .optional()
          .describe('Filter by words in the name, title, category or description.'),
        name: z.string().optional().describe('Show full details for one section.'),
      }),
      annotations: { readOnlyHint: true },
      run: ({ query, name }) => {
        const all = store.registry.listSections();
        if (name) {
          const def = store.registry.section(name);
          return def
            ? { text: describeSection(def, true) }
            : {
                isError: true,
                text: `No section "${name}". Sections: ${all.map((s) => s.name).join(', ')}.`,
              };
        }
        const q = query?.toLowerCase();
        const list = q
          ? all.filter((s) =>
              [s.name, s.title, s.category ?? '', s.description]
                .join(' ')
                .toLowerCase()
                .includes(q),
            )
          : all;
        const components = store.registry
          .listComponents()
          .filter((c) => c.insertable !== false)
          .map(describeComponent);
        return {
          text: [
            ...list.map((s) => describeSection(s, false)),
            '',
            'Components for node.insert:',
            ...components.map((c) => `  ${c}`),
          ].join('\n'),
        };
      },
    }),
    tool({
      name: 'list_tokens',
      title: 'List design tokens',
      description: 'Design tokens as CSS variables with their values, e.g. "--space-lg: 1.5rem".',
      input: z.object({
        prefix: z.string().optional().describe('Filter by path prefix, e.g. "color" or "space".'),
      }),
      annotations: { readOnlyHint: true },
      run: ({ prefix }) => {
        const tokens = flattenTokens(store.doc.tokens).tokens.filter(
          (t) => !prefix || t.path.startsWith(prefix),
        );
        const lines = tokens.map(
          (t) => `${t.cssVar}: ${t.value}${t.description ? `  /* ${t.description} */` : ''}`,
        );
        const themes = Object.entries(store.doc.themes).map(
          ([name, values]) => `theme "${name}" overrides: ${Object.keys(values).join(', ')}`,
        );
        return { text: [...lines, ...themes].join('\n') || 'No tokens match.' };
      },
    }),
    tool(
      {
        name: 'apply',
        title: 'Apply changes',
        description: `Apply operations atomically (all succeed or nothing changes). Ops: ${OpSchema.options
          .map((o) => o.shape.op.value)
          .join(
            ', ',
          )}. States for style.set: ${Object.keys(STATE_PSEUDO).join(', ')}. Every change is attributed to you and can be undone.`,
        input: ApplyInput,
        annotations: { destructiveHint: true, idempotentHint: false },
        run: (input) => {
          const result = store.apply({
            ops: input.ops,
            actor: actor(),
            ...(input.label ? { label: input.label } : {}),
            ...(input.baseRevision !== undefined ? { baseRevision: input.baseRevision } : {}),
            ...(input.dryRun ? { dryRun: true } : {}),
          });
          return formatApplyResult(store, result, input.ops.length);
        },
      },
      ApplyRuntime,
    ),
    tool({
      name: 'undo',
      title: 'Undo my last change',
      description: "Reverts your most recent apply. Other people's later edits are kept.",
      input: z.object({}),
      annotations: { destructiveHint: true },
      run: () => {
        const a = actor();
        return formatApplyResult(store, store.undo({ actorId: a.id, actor: a }), 1);
      },
    }),
  ];
}

/** Tool definitions in the shape the Claude Messages API expects (`input_schema`). */
export function toolDefinitions(tools: AgentTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>,
  }));
}

/** Runs a tool by name. */
export function runTool(tools: AgentTool[], name: string, input: unknown): ToolResult {
  const found = tools.find((t) => t.name === name);
  if (!found)
    return {
      isError: true,
      text: `Unknown tool "${name}". Tools: ${tools.map((t) => t.name).join(', ')}.`,
    };
  return found.run(input);
}
