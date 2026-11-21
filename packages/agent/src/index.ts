import {
  type Actor,
  type ApplyResult,
  type BNode,
  type ComponentDef,
  checkReadLocale,
  DocIndex,
  describeNode,
  didYouMean,
  flattenTokens,
  formatIssue,
  instancesOf,
  type LintIssue,
  lintPage,
  OpSchema,
  outline,
  overridesOf,
  type ProposeResult,
  type SectionDef,
  type SiteDoc,
  STATE_PSEUDO,
  type Store,
  type TransactionInput,
  templateParts,
} from '@bowerbirdjs/core';
import { htmlToNodes } from '@bowerbirdjs/import';
import { formatLayout, type LayoutProvider, lintLayout } from '@bowerbirdjs/layout';
import { z } from 'zod';
import { AGENT_GUIDE } from './guide.js';

export { AGENT_GUIDE } from './guide.js';

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** Images (e.g. screenshots), base64-encoded. */
  images?: { data: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }[];
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
  run(input: unknown): Promise<ToolResult>;
}

export interface AgentToolsOptions {
  store: Store;
  /** The actor recorded on every change. Can be a function, e.g. to use the MCP client's name. */
  actor?: Actor | (() => Actor);
  /** Extra lines appended to get_context, e.g. a preview URL. */
  contextNotes?: () => string[];
  /**
   * Lays pages out so agents can check the rendered result (`get_layout`, and `screenshot` if the
   * provider can take them). E.g. `createDomLayoutProvider` in a browser, Playwright on a server.
   */
  layout?: LayoutProvider;
}

const DEFAULT_ACTOR: Actor = { kind: 'agent', id: 'agent' };

// ---------------------------------------------------------------------------------------------
// Formatting helpers

/** Addressable parts of a section template: path relative to the section id, plus a summary. */
export function sectionParts(
  def: SectionDef,
  variant?: Record<string, string>,
): { path: string; summary: string }[] {
  return templateParts(def, variant).map(({ path, input }) => {
    const node = { id: path, type: input.type, parent: 'x', order: 'a0', props: input.props ?? {} };
    return {
      path,
      summary: describeNode(node as BNode, 40)
        .slice(path.length)
        .trim(),
    };
  });
}

/** Formats lint results for an agent. */
export function formatLint(pageId: string, issues: LintIssue[]): string {
  if (!issues.length) return `page ${pageId}: no issues found.`;
  const count = (s: string) => issues.filter((i) => i.severity === s).length;
  return [
    `page ${pageId}: ${count('error')} errors, ${count('warning')} warnings, ${count('info')} notes`,
    ...issues.map(
      (i) =>
        `- [${i.severity}] ${i.rule}${i.nodeId ? ` ${i.nodeId}` : ''}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`,
    ),
  ].join('\n');
}

/**
 * Part paths in few words: runs of numbered items with the same parts become one entry,
 * `item-1 … item-6 (each: icon, title, body)`; other keyed items list theirs in brackets.
 */
export function compactParts(paths: string[]): string {
  interface Entry {
    key: string;
    children: Entry[];
  }
  const root: Entry = { key: '', children: [] };
  for (const path of paths) {
    let at = root;
    for (const key of path.split('/')) {
      let next = at.children.find((c) => c.key === key);
      if (!next) {
        next = { key, children: [] };
        at.children.push(next);
      }
      at = next;
    }
  }
  const shape = (e: Entry): string => e.children.map((c) => `${c.key}{${shape(c)}}`).join(',');
  const numbered = (key: string) => /^(.*)-(\d+)$/.exec(key);
  const render = (entries: Entry[]): string => {
    const out: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const first = entries[i]!;
      const m = numbered(first.key);
      let last = i;
      if (m) {
        // Following siblings that continue the count and hold the same parts.
        while (last + 1 < entries.length) {
          const next = numbered(entries[last + 1]!.key);
          if (
            !next ||
            next[1] !== m[1] ||
            Number(next[2]) !== Number(m[2]) + (last + 1 - i) ||
            shape(entries[last + 1]!) !== shape(first)
          )
            break;
          last++;
        }
      }
      const inner = first.children.length ? render(first.children) : '';
      if (last > i) {
        out.push(`${first.key} … ${entries[last]!.key}${inner ? ` (each: ${inner})` : ''}`);
        i = last;
      } else out.push(`${first.key}${inner ? ` (${inner})` : ''}`);
    }
    return out.join(', ');
  };
  return render(root.children);
}

function describeSection(def: SectionDef, detailed: boolean): string {
  const variants = Object.entries(def.variants ?? {});
  const variantText = variants.map(([k, vs]) => `${k}=${vs.join('|')}`).join('; ');
  if (!detailed) {
    // The catalog: what it is and what can be filled in. Variables come with the full details.
    return [
      `${def.name} — ${def.title}${def.category ? ` (${def.category})` : ''}: ${def.description}`,
      ...(variantText ? [`  variants: ${variantText}`] : []),
      `  parts: ${compactParts(sectionParts(def).map((p) => p.path))}`,
    ].join('\n');
  }
  const lines = [
    `${def.name} — ${def.title}${def.category ? ` (${def.category})` : ''}`,
    `  ${def.description}`,
  ];
  if (variants.length) lines.push(`  variants: ${variantText} (first is default)`);
  const vars = Object.entries(def.vars ?? {});
  if (vars.length)
    lines.push(
      `  vars: ${vars.map(([n, s]) => `${n} (${s.type}, default ${s.default})`).join('; ')}`,
    );
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
  return lines.join('\n');
}

function describeComponent(def: ComponentDef): string {
  return `${def.name}: ${def.description}`;
}

function compactNode(store: Store, n: BNode, locale?: string) {
  const overrides = n.link ? overridesOf(store.view, n) : [];
  const edited = Object.entries(n.edited ?? {}).filter(([field]) => field !== 'node');
  const l10n = locale ? (n.l10n?.[locale] ? { [locale]: n.l10n[locale] } : undefined) : n.l10n;
  return {
    id: n.id,
    type: n.type,
    ...(n.section ? { section: n.section } : {}),
    ...(n.part ? { part: n.part } : {}),
    ...(n.key ? { key: n.key } : {}),
    props: n.props,
    ...(l10n ? { l10n } : {}),
    ...(n.styles ? { styles: n.styles } : {}),
    ...(n.vars ? { vars: n.vars } : {}),
    ...(n.symbol ? { definitionOf: n.symbol } : {}),
    ...(n.link ? { linkedTo: n.link.node, symbol: n.link.symbol } : {}),
    ...(overrides.length ? { overrides } : {}),
    ...(edited.length
      ? {
          lastEditedBy: Object.fromEntries(
            edited.map(([field, s]) => [field, `${s.by} (${s.kind}) r${s.rev}`]),
          ),
        }
      : {}),
    parent: n.parent,
    children: store.view.children(n.id).map((c) => c.id),
  };
}

/** A dry run of a proposal: what it would change, without storing it. */
function formatProposalDryRun(
  store: Store,
  transaction: TransactionInput,
  opCount: number,
): ToolResult {
  const { result } = store.simulate(transaction);
  if (!result.ok) return formatApplyResult(store, result, opCount);
  const formatted = formatApplyResult(store, result, opCount);
  return {
    text: formatted.text.replace(
      /^Dry run OK at revision (\d+); nothing was committed\./,
      'Dry run OK at revision $1: this would be proposed for review; nothing was stored.',
    ),
  };
}

/** Formats a proposal (changes stored for review) for an agent. */
export function formatProposeResult(
  store: Store,
  result: ProposeResult,
  opCount: number,
): ToolResult {
  if (!result.ok) return formatApplyResult(store, result, opCount);
  const cs = result.changeset;
  const s = cs.summary;
  const lines = [
    `Proposed ${cs.id} (${cs.ops.length} op${cs.ops.length === 1 ? '' : 's'}) for review; nothing changes until a person accepts it.`,
    ...(s.created.length
      ? [
          `Would create: ${s.created.filter((id) => !s.created.some((o) => o !== id && id.startsWith(`${o}/`))).join(', ')}`,
        ]
      : []),
    ...(s.updated.length ? [`Would update: ${s.updated.slice(0, 20).join(', ')}`] : []),
    ...(s.removed.length ? [`Would remove: ${s.removed.slice(0, 20).join(', ')}`] : []),
    ...result.warnings.map((w) => `Note for the reviewer: ${formatIssue(w)}`),
    'Later changes can build on the ids above only after it is accepted. get_outline shows the current page; check the proposal with lint or get_layout and changeset: "' +
      cs.id +
      '".',
  ];
  return { text: lines.join('\n') };
}

export function formatApplyResult(
  store: Store,
  result: ApplyResult,
  opCount: number,
  retryHint = 'fix the error and send all ops again.',
): ToolResult {
  if (!result.ok) {
    const lines = [`No changes were applied (document is at revision ${result.revision}).`];
    for (const issue of result.errors) lines.push(`- ${formatIssue(issue)}`);
    if (result.failedOp !== undefined && result.failedOp < opCount - 1) {
      lines.push(`ops after ops[${result.failedOp}] were not checked; ${retryHint}`);
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
  // Nested means inside another listed node: by parent links where the node still exists
  // (imported ids aren't scoped, e.g. box-1 > text-1), by id prefix for removed ones.
  const view = store.view;
  const topsOf = (ids: string[]) => {
    const set = new Set(ids);
    return ids.filter((id) => {
      const node = view.node(id);
      if (!node) return !ids.some((o) => o !== id && id.startsWith(`${o}/`));
      for (let p = node.parent; p; p = view.node(p)?.parent ?? null) if (set.has(p)) return false;
      return true;
    });
  };
  const brief = (ids: string[]) => {
    const tops = topsOf(ids);
    return `${tops.slice(0, 20).join(', ')}${tops.length > 20 ? `, … (${tops.length - 20} more)` : ''}${
      ids.length > tops.length ? ` (+${ids.length - tops.length} nested)` : ''
    }`;
  };
  if (s.created.length) lines.push(`Created: ${brief(s.created)}`);
  if (s.updated.length) lines.push(`Updated: ${brief(s.updated)}`);
  if (s.removed.length) lines.push(`Removed: ${brief(s.removed)}`);
  if (s.pages.length) lines.push(`Pages changed: ${s.pages.join(', ')}`);
  if (s.symbols.length) lines.push(`Symbols changed: ${s.symbols.join(', ')}`);
  if (s.tokens) lines.push('Tokens or themes changed.');
  for (const w of result.warnings) lines.push(`Warning: ${formatIssue(w)}`);
  if (!result.dryRun && s.created.length) {
    const roots = topsOf(s.created).slice(0, 5);
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
  propose: z
    .boolean()
    .optional()
    .describe('Store the changes for a person to review instead of applying them.'),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'Change fields a person edited last. Only when they asked for it; otherwise propose.',
    ),
});

/** Loose runtime parsing for apply: ops are validated by the store, which gives better errors. */
const ApplyRuntime = z.object({
  ops: z.array(z.unknown()),
  label: z.string().optional(),
  baseRevision: z.number().int().optional(),
  dryRun: z.boolean().optional(),
  propose: z.boolean().optional(),
  overwrite: z.boolean().optional(),
});

function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
): { data: z.infer<T> } | { error: ToolResult } {
  // A misspelled argument (overwrit, pgae) would otherwise be ignored without a word.
  if (
    schema instanceof z.ZodObject &&
    input &&
    typeof input === 'object' &&
    !Array.isArray(input)
  ) {
    const known = Object.keys(schema.shape);
    const unknown = Object.keys(input).filter((k) => !known.includes(k));
    if (unknown.length) {
      return {
        error: {
          isError: true,
          text: `Invalid input:\n${unknown
            .map((k) => `- ${k}: not an argument of this tool.${didYouMean(k, known)}`)
            .join('\n')}\nArguments: ${known.join(', ') || '(none)'}.`,
        },
      };
    }
  }
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
  def: Omit<AgentTool, 'run' | 'input'> & {
    input: S;
    run: (input: z.infer<S>) => ToolResult | Promise<ToolResult>;
  },
  runtime: z.ZodType = def.input,
): AgentTool {
  return {
    ...def,
    async run(input) {
      const parsed = parseInput(runtime, input);
      if ('error' in parsed) return parsed.error;
      try {
        return await def.run(parsed.data as z.infer<S>);
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

  const layout = options.layout;
  const pageFor = (page?: string): string | ToolResult => {
    const pages = Object.values(store.doc.pages);
    const found = page
      ? store.doc.pages[page]
      : pages.length === 1
        ? pages[0]
        : pages.find((p) => p.path === '/');
    if (found) return found.id;
    return {
      isError: true,
      text: page
        ? `No page "${page}". Pages: ${pages.map((p) => p.id).join(', ') || '(none)'}.`
        : 'The site has no pages yet.',
    };
  };
  /** Width to lay out at for a breakpoint: a typical device width within the breakpoint's range. */
  const widthFor = (bp?: string, width?: number): number | ToolResult => {
    if (width) return width;
    const list = store.doc.breakpoints;
    const i = bp ? list.findIndex((b) => b.id === bp) : list.length - 1;
    const found = list[i];
    if (!found) {
      return {
        isError: true,
        text: `No breakpoint "${bp}". Breakpoints: ${list.map((b) => `${b.id} (≥${b.minWidth}px)`).join(', ')}.`,
      };
    }
    const typical: Record<string, number> = { base: 390, md: 820, lg: 1280 };
    const next = list[i + 1];
    const preferred =
      typical[found.id] ??
      (next ? Math.round((found.minWidth + next.minWidth) / 2) : Math.max(found.minWidth, 1280));
    return Math.max(
      found.minWidth,
      Math.min(preferred, next ? next.minWidth - 1 : Number.POSITIVE_INFINITY),
      240,
    );
  };
  const localeError = (locale?: string): ToolResult | undefined => {
    const error = locale && checkReadLocale(store.doc.locales, locale).error;
    return error ? { isError: true, text: error } : undefined;
  };
  const themeError = (theme?: string): ToolResult | undefined =>
    theme && !Object.hasOwn(store.doc.themes, theme)
      ? {
          isError: true,
          text: `No theme "${theme}". Themes: ${Object.keys(store.doc.themes).join(', ') || '(none)'}.`,
        }
      : undefined;
  /** The document to check: the current one, or a proposal as if accepted. */
  const docFor = (changeset?: string): SiteDoc | ToolResult => {
    if (!changeset) return store.doc;
    const { result, doc } = store.previewChangeset(changeset);
    if (!result.ok || !doc) return formatApplyResult(store, result, 1);
    return doc;
  };
  const layoutTools: AgentTool[] = layout
    ? [
        tool({
          name: 'get_layout',
          title: 'Check rendered layout',
          description:
            'Lays the page out at a screen width and reports box positions and sizes (x,y w×h in px) plus layout problems the document alone can\'t show: overflow past the screen edge, clipped or overlapping content, tiny text or tap targets, low contrast, broken images. Check mobile (bp "base") and desktop after layout changes.',
          input: z.object({
            page: z.string().optional(),
            bp: z
              .string()
              .optional()
              .describe('Breakpoint to preview: base (mobile), md, lg (default).'),
            width: z
              .number()
              .int()
              .min(240)
              .max(3840)
              .optional()
              .describe('Exact width in px instead of bp.'),
            root: z.string().optional().describe('Only list this node and its subtree.'),
            depth: z.number().int().min(1).max(12).optional(),
            theme: z.string().optional(),
            locale: z
              .string()
              .optional()
              .describe('Check a translation, e.g. "de" (longer text overflows first).'),
            changeset: z
              .string()
              .optional()
              .describe('Check a proposal (e.g. "cs-1") as if it were accepted.'),
          }),
          annotations: { readOnlyHint: true },
          run: async (input) => {
            const page = pageFor(input.page);
            if (typeof page !== 'string') return page;
            const width = widthFor(input.bp, input.width);
            if (typeof width !== 'number') return width;
            const bad = themeError(input.theme) ?? localeError(input.locale);
            if (bad) return bad;
            const doc = docFor(input.changeset);
            if (!('nodes' in doc)) return doc;
            const locale = input.locale && checkReadLocale(store.doc.locales, input.locale).locale;
            const snapshot = await layout.snapshot({
              page,
              width,
              doc,
              ...(input.theme ? { theme: input.theme } : {}),
              ...(locale ? { locale } : {}),
            });
            return {
              text: formatLayout(snapshot, {
                issues: lintLayout(snapshot),
                ...(input.root ? { root: input.root } : {}),
                ...(input.depth ? { depth: input.depth } : {}),
              }),
            };
          },
        }),
        ...(layout.screenshot
          ? [
              tool({
                name: 'screenshot',
                title: 'Screenshot',
                description:
                  'A PNG of the page (or one node) at a screen width. Use it to judge visual design; use get_layout for exact sizes and problems.',
                input: z.object({
                  page: z.string().optional(),
                  bp: z.string().optional().describe('base (mobile), md, lg (default).'),
                  width: z.number().int().min(240).max(3840).optional(),
                  node: z.string().optional().describe('Only this node.'),
                  theme: z.string().optional(),
                  locale: z.string().optional().describe('Show a translation, e.g. "de".'),
                  changeset: z.string().optional().describe('Show a proposal as if accepted.'),
                }),
                annotations: { readOnlyHint: true },
                run: async (input) => {
                  const page = pageFor(input.page);
                  if (typeof page !== 'string') return page;
                  const width = widthFor(input.bp, input.width);
                  if (typeof width !== 'number') return width;
                  const bad = themeError(input.theme) ?? localeError(input.locale);
                  if (bad) return bad;
                  const doc = docFor(input.changeset);
                  if (!('nodes' in doc)) return doc;
                  const locale =
                    input.locale && checkReadLocale(store.doc.locales, input.locale).locale;
                  const image = await layout.screenshot!({
                    page,
                    width,
                    doc,
                    ...(input.node ? { node: input.node } : {}),
                    ...(input.theme ? { theme: input.theme } : {}),
                    ...(locale ? { locale } : {}),
                  });
                  return {
                    text: `Screenshot of ${input.node ?? `page ${page}`} at ${width}px${
                      image.cropped
                        ? `, cropped to the top ${image.cropped.height}px of ${image.cropped.fullHeight}px (use node to look at a lower part)`
                        : ''
                    }.`,
                    images: [{ data: image.data, mimeType: image.mimeType }],
                  };
                },
              }),
            ]
          : []),
      ]
    : [];

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
        const me = actor();
        const symbols = store.view.symbols();
        const protection = store.policy.protectHumanEdits?.(me) ?? 'warn';
        const mine = store.changesets.filter(
          (c) => c.actor.id === me.id && c.status.includes('open'),
        );
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
          ...(store.registry.listIcons().length
            ? [`Icons (for icon nodes): ${store.registry.listIcons().join(', ')}`]
            : []),
          `Tokens: ${[...families].map(([f, n]) => `${f} (${n})`).join(', ')} (list_tokens to see them)`,
          `Themes: ${Object.keys(doc.themes).join(', ') || 'none'}`,
          ...(store.registry.listData().length
            ? [
                `Site data (sections show it; change it with data.set, read it with get_data): ${store.registry
                  .listData()
                  .map(
                    (d) =>
                      `${d.key} (${d.title}${store.view.data(d.key) === undefined ? ', empty' : ''})`,
                  )
                  .join(', ')}`,
              ]
            : []),
          ...(doc.locales
            ? [
                `Languages: ${doc.locales.default} (default, in props), ${doc.locales.others.join(', ')}. Translate content with props.set/text.edit plus "locale"; get_outline with locale shows what is untranslated.`,
              ]
            : []),
          `Symbols (linked components): ${
            symbols
              .map(
                (sym) =>
                  `${sym.id} "${sym.name}" (definition ${sym.rootId}, ${instancesOf(store.view, sym.id).length} instances)`,
              )
              .join('; ') || 'none'
          }`,
          ...(store.policy.requiresReview?.(me)
            ? [
                'Review: your changes are proposed for a person to accept; apply stores them as a changeset.',
              ]
            : []),
          ...(protection === 'confirm'
            ? [
                'People’s edits are protected: changing fields marked "edited by <person>" needs overwrite: true (only if they asked) or a proposal.',
              ]
            : []),
          ...(mine.length
            ? [
                `Your open proposals: ${mine
                  .map((c) => `${c.id} (${c.status.filter((st) => st === 'open').length} open ops)`)
                  .join(', ')}`,
              ]
            : []),
          ...(options.contextNotes?.() ?? []),
          '',
          AGENT_GUIDE,
        ];
        return { text: lines.join('\n') };
      },
    }),
    tool({
      name: 'get_data',
      title: 'Get site data',
      description:
        'Site data groups (e.g. an event’s schedule or venues) as JSON, with what each holds. Sections show this data; change it with data.set.',
      input: z.object({
        key: z.string().optional().describe('One group; omit for all.'),
      }),
      annotations: { readOnlyHint: true },
      run: (input) => {
        const defs = store.registry.listData();
        const chosen = input.key ? defs.filter((d) => d.key === input.key) : defs;
        if (input.key && !chosen.length)
          return {
            text: `No data group "${input.key}". Groups: ${defs.map((d) => d.key).join(', ') || 'none'}.`,
            isError: true,
          };
        return {
          text: chosen
            .map(
              (d) =>
                `## ${d.key}: ${d.title}\n${d.description}\n${JSON.stringify(store.view.data(d.key) ?? null)}`,
            )
            .join('\n\n'),
        };
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
        locale: z.string().optional().describe('Show this language’s translations.'),
      }),
      annotations: { readOnlyHint: true },
      run: (input) => {
        const error = input.locale && checkReadLocale(store.doc.locales, input.locale).error;
        if (error) return { text: error, isError: true };
        return {
          text: `revision ${store.doc.revision}\n${outline(store.view, {
            registry: store.registry,
            ...(input.page ? { page: input.page } : {}),
            ...(input.root ? { root: input.root } : {}),
            ...(input.depth ? { depth: input.depth } : {}),
            ...(input.locale ? { locale: input.locale } : {}),
          })}`,
        };
      },
    }),
    tool({
      name: 'get_nodes',
      title: 'Get nodes',
      description:
        'Full data for specific nodes: props, translations (l10n), styles (per breakpoint/state), variables and child ids.',
      input: z.object({
        ids: z.array(z.string()).min(1).max(50),
        locale: z.string().optional().describe('Only include translations into this language.'),
      }),
      annotations: { readOnlyHint: true },
      run: ({ ids, locale }) => {
        const error = locale && checkReadLocale(store.doc.locales, locale).error;
        if (error) return { text: error, isError: true };
        const found = ids.map((id) => store.view.node(id)).filter((n): n is BNode => !!n);
        const missing = ids.filter((id) => !store.view.node(id));
        const text = JSON.stringify(
          found.map((n) => compactNode(store, n, locale)),
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
        'Prebuilt sections you can insert with section.insert: purpose, variants (first is the default) and part paths (for "content" and later edits). "item-1 … item-3 (each: title, body)" means paths like "item-2/title". Give "name" for a section\'s style variables and what each part holds.',
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
          const a = actor();
          const transaction = {
            ops: input.ops,
            actor: a,
            ...(input.label ? { label: input.label } : {}),
            ...(input.baseRevision !== undefined ? { baseRevision: input.baseRevision } : {}),
            ...(input.overwrite ? { overwrite: true } : {}),
          };
          if (input.propose || store.policy.requiresReview?.(a)) {
            if (input.dryRun) return formatProposalDryRun(store, transaction, input.ops.length);
            return formatProposeResult(store, store.propose(transaction), input.ops.length);
          }
          const result = store.apply({ ...transaction, ...(input.dryRun ? { dryRun: true } : {}) });
          return formatApplyResult(store, result, input.ops.length);
        },
      },
      ApplyRuntime,
    ),
    tool({
      name: 'import_html',
      title: 'Import HTML',
      description:
        'Converts an HTML fragment into editable nodes and inserts them as one change. Use it for layouts no section covers. style="…" attributes become node CSS and must use design tokens; <form>, its controls and <details> become form, field and details nodes; class attributes, scripts and SVG are dropped.',
      input: z.object({
        html: z.string().min(1).max(100_000),
        parent: z.string().optional().describe('Parent node id (default: the page root).'),
        page: z
          .string()
          .optional()
          .describe('Page id, when the site has several pages and no parent is given.'),
        before: z.string().optional(),
        after: z.string().optional(),
        label: z.string().optional(),
        dryRun: z.boolean().optional(),
        propose: z.boolean().optional().describe('Store for review instead of applying.'),
      }),
      annotations: { destructiveHint: false },
      run: (input) => {
        let parent = input.parent;
        if (!parent) {
          const pages = Object.values(store.doc.pages);
          const page = input.page
            ? store.doc.pages[input.page]
            : pages.length === 1
              ? pages[0]
              : undefined;
          if (!page) {
            return {
              isError: true,
              text: input.page
                ? `No page "${input.page}". Pages: ${pages.map((p) => p.id).join(', ')}.`
                : 'The site has several pages; give "page" or "parent".',
            };
          }
          parent = page.rootId;
        }
        const { nodes, warnings } = htmlToNodes(input.html);
        if (!nodes.length)
          return { isError: true, text: ['The HTML produced no nodes.', ...warnings].join('\n') };
        // Keep document order and id order the same: insert each node before the anchor's next sibling.
        let position: { before?: string; after?: string } = {};
        if (input.before) position = { before: input.before };
        else if (input.after) {
          const siblings = store.view.children(parent);
          const i = siblings.findIndex((s) => s.id === input.after);
          const next = siblings[i + 1];
          position = i < 0 ? { after: input.after } : next ? { before: next.id } : {};
        }
        const ops = nodes.map((node) => ({ op: 'node.insert', parent, ...position, node }));
        const a = actor();
        const transaction = { ops, actor: a, label: input.label ?? 'Import HTML' };
        if (input.propose || store.policy.requiresReview?.(a)) {
          const proposed = input.dryRun
            ? formatProposalDryRun(store, transaction, ops.length)
            : formatProposeResult(store, store.propose(transaction), ops.length);
          return {
            ...proposed,
            text: [proposed.text, ...warnings.map((w) => `Note: ${w}`)].join('\n'),
          };
        }
        const result = store.apply({ ...transaction, ...(input.dryRun ? { dryRun: true } : {}) });
        const formatted = formatApplyResult(
          store,
          result,
          ops.length,
          'fix the HTML (or its style attributes) and import it again.',
        );
        return {
          ...formatted,
          text: [formatted.text, ...warnings.map((w) => `Note: ${w}`)].join('\n'),
        };
      },
    }),
    tool({
      name: 'lint',
      title: 'Check pages',
      description:
        'Checks pages for problems: missing or extra h1, skipped heading levels, links without text or destination, empty alt text, unsafe URLs and example copy left from section templates. Run it before telling the user you are done.',
      input: z.object({
        page: z.string().optional().describe('Page id; omit to check all pages.'),
        changeset: z
          .string()
          .optional()
          .describe('Check a proposal (e.g. "cs-1") as if it were accepted.'),
      }),
      annotations: { readOnlyHint: true },
      run: ({ page, changeset }) => {
        const doc = docFor(changeset);
        if (!('nodes' in doc)) return doc;
        const view = doc === store.doc ? store.view : new DocIndex(doc);
        const ids = page ? [page] : Object.keys(doc.pages);
        return {
          text: ids.map((id) => formatLint(id, lintPage(view, store.registry, id))).join('\n\n'),
        };
      },
    }),
    tool({
      name: 'undo',
      title: 'Undo my last change',
      description: "Reverts your most recent apply. Other people's later edits are kept.",
      input: z.object({
        overwrite: z
          .boolean()
          .optional()
          .describe(
            'Undo even though it removes what a person edited since. Only when the person asked.',
          ),
      }),
      annotations: { destructiveHint: true },
      run: ({ overwrite }) => {
        const a = actor();
        return formatApplyResult(
          store,
          store.undo({ actorId: a.id, actor: a, ...(overwrite ? { overwrite } : {}) }),
          1,
        );
      },
    }),
    ...layoutTools,
  ];
}

/** Tool definitions in the shape the Claude Messages API expects (`input_schema`). */
export function toolDefinitions(tools: AgentTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (({ $schema: _, ...schema }) => schema)(
      z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>,
    ),
  }));
}

/** Runs a tool by name. */
export async function runTool(
  tools: AgentTool[],
  name: string,
  input: unknown,
): Promise<ToolResult> {
  const found = tools.find((t) => t.name === name);
  if (!found)
    return {
      isError: true,
      text: `Unknown tool "${name}". Tools: ${tools.map((t) => t.name).join(', ')}.`,
    };
  return found.run(input);
}

/**
 * The ops of a partially streamed `apply` input that are already complete and valid, in order.
 * Use it to preview an agent's change on the canvas while the model is still writing it.
 */
export function opsFromPartialInput(input: unknown): unknown[] {
  const ops = (input as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return [];
  const out: unknown[] = [];
  for (const op of ops) {
    if (!OpSchema.safeParse(op).success) break;
    out.push(op);
  }
  return out;
}

/** Tool result content blocks for the Claude Messages API (text plus any images). */
export function toolResultContent(result: ToolResult) {
  return [
    { type: 'text' as const, text: result.text },
    ...(result.images ?? []).map((img) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: img.mimeType, data: img.data },
    })),
  ];
}
