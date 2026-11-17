import { z } from 'zod';
import { didYouMean, type Issue } from './errors.js';
import type { NodeInput } from './registry.js';

const Id = z.string().min(1).max(200);
const Json = z.record(z.string(), z.unknown());
const Styles = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string())));

export const NodeInputSchema: z.ZodType<NodeInput> = z.lazy(() =>
  z.object({
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
    .object({
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
    .object({ op: z.literal('node.insert'), parent: Id, ...position, node: NodeInputSchema })
    .describe('Insert a node (with optional children) under a parent.'),
  z
    .object({ op: z.literal('node.move'), id: Id, parent: Id.optional(), ...position })
    .describe('Move a node to another position or parent.'),
  z.object({ op: z.literal('node.remove'), id: Id }).describe('Remove a node and its subtree.'),
  z
    .object({ op: z.literal('node.duplicate'), id: Id })
    .describe('Copy a node and its subtree after itself.'),
  z
    .object({
      op: z.literal('props.set'),
      id: Id,
      props: Json.describe('Props to merge; null removes a prop.'),
    })
    .describe('Merge props into a node.'),
  z
    .object({
      op: z.literal('text.edit'),
      id: Id,
      find: z.string().min(1),
      replace: z.string(),
      prop: z.string().optional().describe('Defaults to "text".'),
    })
    .describe('Replace one exact occurrence of text inside a text prop.'),
  z
    .object({
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
    .object({
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
    .object({
      op: z.literal('page.create'),
      id: z.string().optional(),
      path: z.string(),
      title: z.string(),
    })
    .describe('Create a page.'),
  z
    .object({
      op: z.literal('page.update'),
      id: z.string(),
      path: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    })
    .describe('Update page settings.'),
  z.object({ op: z.literal('page.remove'), id: z.string() }).describe('Remove a page.'),
  z
    .object({
      op: z.literal('token.set'),
      path: z.string().describe('Token path, e.g. "color.brand.600".'),
      value: z.string().nullable().describe('CSS value or {alias}; null removes the token.'),
      theme: z
        .string()
        .optional()
        .describe('Set the value for a theme (e.g. "dark") instead of the base.'),
      type: z.string().optional(),
    })
    .describe('Create, change or remove a design token.'),
]);

export type Op = z.infer<typeof OpSchema>;
export type OpName = Op['op'];
export const OP_NAMES: OpName[] = OpSchema.options.map((o) => o.shape.op.value);

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
