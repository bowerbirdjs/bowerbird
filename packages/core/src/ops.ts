import { z } from 'zod';
import { didYouMean, type Issue } from './errors.js';
import type { NodeInput } from './registry.js';

const Id = z.string().min(1).max(200);
const Json = z.record(z.string(), z.unknown());
const Styles = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string())));
/** Control characters and line/paragraph separators (U+2028, U+2029). */
export function hasControlChars(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return true;
  }
  return false;
}

/** Page titles and descriptions: one line of text (they end up in <title>, meta tags, comments). */
const PageText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !hasControlChars(s), {
      message: 'Must be one line of text: no line breaks or control characters.',
    });

export const NodeInputSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z.strictObject({
    type: z
      .string()
      .describe('Component type: box, text, link, button, image, or a registered code component.'),
    id: Id.optional().describe('Optional explicit id; normally generated (e.g. "hero-1/text-2").'),
    part: z.string().optional(),
    key: z.string().optional(),
    props: Json.optional(),
    css: z
      .string()
      .optional()
      .describe('Base-breakpoint CSS declarations, e.g. "gap: var(--space-md)".'),
    styles: Styles.optional(),
    vars: z.record(z.string(), z.string()).optional(),
    name: z.string().optional(),
    children: z.array(NodeInputSchema).optional(),
  }),
);

const position = {
  before: Id.optional().describe('Insert before this sibling.'),
  after: Id.optional().describe('Insert after this sibling. Omit both to append.'),
};

export const OpSchema = z.discriminatedUnion('op', [
  z
    .strictObject({
      op: z.literal('section.insert'),
      section: z.string().describe('Section name from list_sections, e.g. "hero".'),
      page: z.string().optional().describe('Page id; the section is added to the page root.'),
      parent: Id.optional().describe('Parent node id (instead of page).'),
      ...position,
      variant: z.record(z.string(), z.string()).optional(),
      content: z
        .record(z.string(), Json)
        .optional()
        .describe(
          'Initial props per part path, e.g. {"heading": {"text": "Hi"}, "cta": {"href": "/start"}}.',
        ),
      id: Id.optional(),
    })
    .describe('Insert a prebuilt section, optionally filling its parts in the same op.'),
  z
    .strictObject({
      op: z.literal('section.variant'),
      id: Id.describe('Section root id, e.g. "hero-1".'),
      variant: z
        .record(z.string(), z.string())
        .describe('Axes to change, e.g. {"layout": "split"}.'),
    })
    .describe(
      'Switch a section to other variant values. Parts present in both variants keep their content, styles and variables; nodes you added are kept.',
    ),
  z
    .strictObject({ op: z.literal('node.insert'), parent: Id, ...position, node: NodeInputSchema })
    .describe('Insert a node (with optional children) under a parent.'),
  z
    .strictObject({ op: z.literal('node.move'), id: Id, parent: Id.optional(), ...position })
    .describe('Move a node to another position or parent.'),
  z
    .strictObject({ op: z.literal('node.remove'), id: Id })
    .describe('Remove a node and its subtree.'),
  z
    .strictObject({
      op: z.literal('node.duplicate'),
      id: Id,
      copy: Id.optional().describe('Id for the copy; normally generated.'),
    })
    .describe('Copy a node and its subtree after itself.'),
  z
    .strictObject({
      op: z.literal('props.set'),
      id: Id,
      props: Json.describe('Props to merge; null removes a prop.'),
      locale: z
        .string()
        .optional()
        .describe('Write a translation (content props only); omit for the default language.'),
    })
    .describe('Merge props into a node.'),
  z
    .strictObject({
      op: z.literal('text.edit'),
      id: Id,
      find: z.string().min(1),
      replace: z.string(),
      prop: z.string().optional().describe('Defaults to "text".'),
      locale: z.string().optional().describe('Edit a translation instead of the default text.'),
    })
    .describe('Replace one exact occurrence of text inside a text prop.'),
  z
    .strictObject({
      op: z.literal('style.set'),
      id: Id,
      css: z
        .string()
        .optional()
        .describe('Declarations, e.g. "padding-block: var(--space-2xl); gap: var(--space-md)".'),
      remove: z.array(z.string()).optional().describe('Properties to remove.'),
      bp: z.string().optional().describe('Breakpoint id (default: the base breakpoint).'),
      state: z
        .string()
        .optional()
        .describe('default, hover, focus, focus-visible, focus-within, active, disabled.'),
      replace: z
        .boolean()
        .optional()
        .describe('Replace all declarations for this breakpoint/state.'),
    })
    .describe(
      'Set CSS declarations on a node for a breakpoint and state. Values must use design tokens unless raw values are allowed.',
    ),
  z
    .strictObject({
      op: z.literal('vars.set'),
      id: Id,
      vars: z
        .record(z.string(), z.string().nullable())
        .describe('e.g. {"--hero-bg": "var(--color-accent)"}; null removes.'),
    })
    .describe(
      "Override CSS variables on a node: the section's style variables or design tokens (re-themes a subtree).",
    ),
  z
    .strictObject({
      op: z.literal('page.create'),
      id: z.string().optional(),
      path: z.string(),
      title: PageText(200),
    })
    .describe('Create a page.'),
  z
    .strictObject({
      op: z.literal('page.update'),
      id: z.string(),
      path: z.string().optional(),
      title: PageText(200).optional(),
      description: PageText(500).optional(),
      locale: z
        .string()
        .optional()
        .describe('Translate title/description into this language; omit for the default.'),
    })
    .describe('Update page settings.'),
  z.strictObject({ op: z.literal('page.remove'), id: z.string() }).describe('Remove a page.'),
  z
    .strictObject({
      op: z.literal('data.set'),
      key: z.string().describe('Data group, e.g. "schedule" (get_context lists them).'),
      path: z
        .array(z.union([z.string(), z.number().int().min(0)]))
        .max(8)
        .optional()
        .describe('Where inside the group, e.g. [0, "time"]; omit to replace the whole group.'),
      value: z
        .unknown()
        .describe('New value (JSON); null removes it (an array item is spliced out).'),
    })
    .describe('Change site data (facts sections show, e.g. the schedule or venues).'),
  z
    .strictObject({
      op: z.literal('locale.set'),
      default: z
        .string()
        .optional()
        .describe('Default language (only before any translations exist).'),
      add: z.array(z.string()).optional().describe('Languages to add, e.g. ["de", "fr"].'),
      remove: z
        .array(z.string())
        .optional()
        .describe('Languages to remove (their translations are deleted).'),
    })
    .describe('Set the languages the site is published in.'),
  z
    .strictObject({
      op: z.literal('symbol.create'),
      id: Id.describe('Node to turn into a linked component; it becomes the first instance.'),
      name: z.string().min(1).max(80),
      symbol: z.string().optional().describe('Symbol id (default: from the name).'),
      description: z.string().max(300).optional(),
    })
    .describe(
      'Make a linked component (symbol) from a node and its subtree. Editing the definition updates every instance.',
    ),
  z
    .strictObject({
      op: z.literal('symbol.insert'),
      symbol: z.string().describe('Symbol id from get_context.'),
      page: z.string().optional(),
      parent: Id.optional(),
      ...position,
      content: z
        .record(z.string(), Json)
        .optional()
        .describe('Props per part path, as local overrides, e.g. {"heading": {"text": "Hi"}}.'),
      id: Id.optional(),
    })
    .describe('Insert an instance of a symbol.'),
  z
    .strictObject({ op: z.literal('symbol.detach'), id: Id.describe('Instance root id.') })
    .describe('Unlink an instance: its nodes stay but stop following the definition.'),
  z
    .strictObject({ op: z.literal('symbol.reset'), id: Id })
    .describe(
      'Drop local overrides on an instance node and everything inside it, so it matches the definition again.',
    ),
  z
    .strictObject({
      op: z.literal('symbol.update'),
      symbol: z.string(),
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(300).optional(),
    })
    .describe('Rename or describe a symbol.'),
  z
    .strictObject({
      op: z.literal('symbol.remove'),
      symbol: z.string(),
      instances: z
        .enum(['detach', 'remove'])
        .optional()
        .describe(
          'What happens to existing instances: keep them as ordinary nodes, or remove them.',
        ),
    })
    .describe('Delete a symbol definition.'),
  z
    .strictObject({
      op: z.literal('token.set'),
      path: z.string().describe('Token path, e.g. "color.brand.600".'),
      value: z.string().nullable().describe('CSS value or {alias}; null removes the token.'),
      theme: z
        .string()
        .optional()
        .describe('Set the value for a theme (e.g. "dark") instead of the base.'),
      type: z.string().optional(),
      force: z
        .boolean()
        .optional()
        .describe('Remove a token even though nodes or sections still reference it.'),
    })
    .describe('Create, change or remove a design token.'),
]);

export type Op = z.infer<typeof OpSchema>;
export type OpName = Op['op'];
export const OP_NAMES: OpName[] = OpSchema.options.map((o) => o.shape.op.value);

const NODE_INPUT_KEYS = [
  'type',
  'id',
  'part',
  'key',
  'props',
  'css',
  'styles',
  'vars',
  'name',
  'children',
];

/** The fields an op takes (for "did you mean" on misspelled ones). */
function opFields(name: OpName): string[] {
  const option = OpSchema.options.find((o) => o.shape.op.value === name);
  return option ? Object.keys(option.shape) : [];
}

/** Validates raw op objects (e.g. from an agent). */
export function parseOps(input: unknown): { ops: Op[]; issues: Issue[] } {
  if (!Array.isArray(input)) {
    return {
      ops: [],
      issues: [{ code: 'invalid_op', message: '"ops" must be an array of operations.' }],
    };
  }
  const ops: Op[] = [];
  const issues: Issue[] = [];
  input.forEach((raw, opIndex) => {
    const name = (raw as { op?: unknown })?.op;
    if (typeof name !== 'string' || !OP_NAMES.includes(name as OpName)) {
      issues.push({
        code: 'invalid_op',
        opIndex,
        message: `Unknown op ${JSON.stringify(name)}.${typeof name === 'string' ? didYouMean(name, OP_NAMES) : ''}`,
        hint: `Valid ops: ${OP_NAMES.join(', ')}.`,
      });
      return;
    }
    const parsed = OpSchema.safeParse(raw);
    if (parsed.success) {
      ops.push(parsed.data);
      return;
    }
    for (const zi of parsed.error.issues) {
      if (zi.code === 'unrecognized_keys') {
        // A misspelled field would otherwise be dropped silently (e.g. "local" for "locale").
        const inNode = zi.path.length > 0;
        const known = inNode ? NODE_INPUT_KEYS : opFields(name as OpName);
        const where = inNode ? `"${zi.path.join('.')}" ` : '';
        for (const key of zi.keys) {
          issues.push({
            code: 'invalid_op',
            opIndex,
            path: [...zi.path, key].join('.'),
            message: `${name}: ${where}has no field "${key}".${didYouMean(key, known)}`,
            hint: `${inNode ? 'Node' : name} fields: ${known.join(', ')}.`,
          });
        }
        continue;
      }
      issues.push({
        code: 'invalid_op',
        opIndex,
        path: zi.path.join('.'),
        message: `${name}: ${zi.path.length ? `"${zi.path.join('.')}" ` : ''}${zi.message}`,
      });
    }
  });
  return { ops, issues };
}

/** One short line describing an op, for review lists: `props.set hero-1/heading text="Hi"`. */
export function describeOp(op: Op): string {
  const short = (v: unknown, n = 60) => {
    const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v ?? null);
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  };
  switch (op.op) {
    case 'section.insert':
      return `add ${op.section} section${op.parent ? ` in ${op.parent}` : ''}${op.after ? ` after ${op.after}` : op.before ? ` before ${op.before}` : ''}`;
    case 'section.variant':
      return `${op.id}: variant ${Object.entries(op.variant)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`;
    case 'node.insert': {
      // Name it by its name or first text, so "add box in root-home" says what the box is.
      const firstText = (n: NodeInput): unknown =>
        n.props?.text ?? n.children?.map(firstText).find((t) => typeof t === 'string');
      const label = op.node.name ?? firstText(op.node);
      return `add ${op.node.type}${typeof label === 'string' && label ? ` ${short(label)}` : ''} in ${op.parent}`;
    }
    case 'node.move':
      return `move ${op.id}${op.parent ? ` into ${op.parent}` : ''}${op.after ? ` after ${op.after}` : op.before ? ` before ${op.before}` : ''}`;
    case 'node.remove':
      return `remove ${op.id}`;
    case 'node.duplicate':
      return `duplicate ${op.id}`;
    case 'props.set':
      return `${op.id}${op.locale ? ` (${op.locale})` : ''}: ${Object.entries(op.props)
        .map(([k, v]) => `${k}=${short(v)}`)
        .join(', ')}`;
    case 'text.edit':
      return `${op.id}: replace ${short(op.find, 30)} with ${short(op.replace, 30)}`;
    case 'style.set':
      return `${op.id}: style ${op.css ?? ''}${op.remove?.length ? ` remove ${op.remove.join(', ')}` : ''}${op.bp ? ` (${op.bp})` : ''}`;
    case 'vars.set':
      return `${op.id}: ${Object.entries(op.vars)
        .map(([k, v]) => `${k}=${v ?? 'default'}`)
        .join(', ')}`;
    case 'token.set':
      return `token ${op.path}${op.theme ? ` (${op.theme})` : ''} = ${op.value ?? 'removed'}`;
    case 'page.create':
      return `new page ${op.path} ${short(op.title)}`;
    case 'page.update':
      return `page ${op.id}${op.locale ? ` (${op.locale})` : ''}: ${[op.title && `title ${short(op.title)}`, op.path && `path ${op.path}`, op.description !== undefined && 'description'].filter(Boolean).join(', ')}`;
    case 'page.remove':
      return `remove page ${op.id}`;
    case 'data.set':
      return `${[op.key, ...(op.path ?? [])].join('.')} = ${op.value === null ? 'removed' : short(JSON.stringify(op.value) ?? '')}`;
    case 'locale.set':
      return `languages: ${[
        op.default && `default ${op.default}`,
        op.add?.length && `add ${op.add.join(', ')}`,
        op.remove?.length && `remove ${op.remove.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; ')}`;
    case 'symbol.create':
      return `make ${op.id} a linked component ${short(op.name)}`;
    case 'symbol.insert':
      return `add ${op.symbol} instance`;
    case 'symbol.detach':
      return `detach ${op.id}`;
    case 'symbol.reset':
      return `reset overrides on ${op.id}`;
    case 'symbol.update':
      return `rename ${op.symbol}${op.name ? ` to ${short(op.name)}` : ''}`;
    case 'symbol.remove':
      return `delete linked component ${op.symbol}`;
  }
}
