import type { z } from 'zod';
import { slugify } from './ids.js';
import { PRIMITIVES } from './primitives.js';
import type { BNode, NodeStyles, Props } from './types.js';

/** A framework-free description of the element a node renders to. */
export interface ElementSpec {
  tag: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  text?: string;
  /** Void elements (e.g. `img`) never have children. */
  void?: boolean;
}

export interface ComponentDef {
  name: string;
  /** `primitive`: built in, rendered from `render`. `code`: host component rendered as a custom element `tag`. */
  kind: 'primitive' | 'code';
  title?: string;
  description: string;
  // biome-ignore lint/suspicious/noExplicitAny: any object schema is accepted
  props: z.ZodObject<any, any>;
  /** Whether the node may have children; `{ allow }` restricts child types. */
  children: boolean | { allow: string[] };
  /** Props editable at the "content" freedom level (copy, links, images). */
  contentProps?: string[];
  /** `false` hides the component from insertion (e.g. the page root). */
  insertable?: boolean;
  render?: (node: BNode) => ElementSpec;
  /** Custom element tag for code components. */
  tag?: string;
}

/** Input describing a node (and its subtree) to create. Used by `node.insert` and section templates. */
export interface NodeInput {
  type: string;
  id?: string;
  part?: string;
  key?: string;
  props?: Record<string, unknown>;
  /** CSS declarations for the base breakpoint and default state. */
  css?: string;
  styles?: NodeStyles;
  vars?: Record<string, string>;
  name?: string;
  children?: NodeInput[];
}

export type SectionVarType =
  | 'color'
  | 'space'
  | 'size'
  | 'radius'
  | 'font'
  | 'shadow'
  | 'number'
  | 'any';

export interface SectionVar {
  type: SectionVarType;
  /** Default value, normally a token reference such as `var(--color-surface)`. */
  default: string;
  description?: string;
}

export interface SectionDef {
  name: string;
  version: number;
  title: string;
  description: string;
  category?: string;
  tags?: string[];
  /** Variant axes; the first value of each axis is the default. */
  variants?: Record<string, string[]>;
  /** The section's style contract: CSS variables it reads, with token-based defaults. */
  vars?: Record<string, SectionVar>;
  /** CSS for `.bb-<name>` and `.bb-<name>__<part>`; may use container queries on `bb-page`. */
  css?: string;
  template: (ctx: { variant: Record<string, string> }) => NodeInput;
}

export function defineSection(def: SectionDef): SectionDef {
  if (slugify(def.name) !== def.name) {
    throw new Error(`Section name "${def.name}" must be lowercase kebab-case.`);
  }
  for (const name of Object.keys(def.vars ?? {})) {
    if (!name.startsWith('--')) throw new Error(`Section variable "${name}" must start with "--".`);
  }
  return def;
}

export function defineComponent(def: ComponentDef): ComponentDef {
  if (def.kind === 'code' && !def.tag?.includes('-')) {
    throw new Error(`Code component "${def.name}" needs a custom element tag containing a hyphen.`);
  }
  return def;
}

export class Registry {
  private readonly components = new Map<string, ComponentDef>();
  private readonly sections = new Map<string, SectionDef>();

  registerComponent(def: ComponentDef): this {
    this.components.set(def.name, def);
    return this;
  }

  registerSection(def: SectionDef): this {
    if (this.components.has(def.name)) {
      throw new Error(`"${def.name}" is already registered as a component.`);
    }
    this.sections.set(def.name, def);
    return this;
  }

  component(name: string): ComponentDef | undefined {
    return this.components.get(name);
  }

  section(name: string): SectionDef | undefined {
    return this.sections.get(name);
  }

  listComponents(): ComponentDef[] {
    return [...this.components.values()];
  }

  listSections(): SectionDef[] {
    return [...this.sections.values()];
  }

  /** Whether a node of type `parentType` may contain a node of type `childType`. */
  accepts(parentType: string, childType: string): boolean {
    const def = this.components.get(parentType);
    if (!def || def.children === false) return false;
    if (def.children === true) return true;
    return def.children.allow.includes(childType);
  }
}

export interface RegistryOptions {
  components?: ComponentDef[];
  sections?: SectionDef[];
}

/** A registry with the built-in primitives plus any given components and sections. */
export function createRegistry(options: RegistryOptions = {}): Registry {
  const registry = new Registry();
  for (const def of PRIMITIVES) registry.registerComponent(def);
  for (const def of options.components ?? []) registry.registerComponent(def);
  for (const def of options.sections ?? []) registry.registerSection(def);
  return registry;
}

/** Fills in default variant values; reports unknown axes or values. */
export function resolveVariant(
  def: SectionDef,
  input: Record<string, string> = {},
): { variant: Record<string, string>; errors: string[] } {
  const variant: Record<string, string> = {};
  const errors: string[] = [];
  const axes = def.variants ?? {};
  for (const [axis, values] of Object.entries(axes)) {
    const wanted = input[axis];
    if (wanted === undefined) variant[axis] = values[0]!;
    else if (values.includes(wanted)) variant[axis] = wanted;
    else
      errors.push(
        `Variant "${axis}" of "${def.name}" can't be "${wanted}"; allowed: ${values.join(', ')}.`,
      );
  }
  for (const axis of Object.keys(input)) {
    if (!(axis in axes)) {
      const known = Object.keys(axes);
      errors.push(
        `Section "${def.name}" has no variant axis "${axis}"${known.length ? `; axes: ${known.join(', ')}` : ''}.`,
      );
    }
  }
  return { variant, errors };
}

export type { Props };
