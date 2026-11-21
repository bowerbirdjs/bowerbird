import type { z } from 'zod';
import type { DocView } from './doc.js';
import { ICON_NAME, type IconDef, isIconDef, parseIcon } from './icons.js';
import { slugify } from './ids.js';
import { PRIMITIVES } from './primitives.js';
import type { BNode, NodeStyles, Props } from './types.js';

/** A framework-free description of the element a node renders to. */
export interface ElementSpec {
  tag: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  text?: string;
  /** Inner rich text (the safe inline subset); the renderer sanitizes it again. */
  html?: string;
  /**
   * The name of a registered icon (`Registry.registerIcons`) drawn inside the element instead of
   * text or children. The renderer writes the SVG from the registry's checked data.
   */
  icon?: string;
  /** Void elements (e.g. `img`) never have children. */
  void?: boolean;
  /**
   * Elements generated from data (e.g. one per schedule item), for nodes without children. They
   * are escaped and sanitized like everything else, but can't be selected or edited on their own.
   */
  children?: (ElementSpec | string)[];
  /**
   * CSS custom properties for this element (`{ '--swatch': '#a1b2c3' }`), e.g. a colour from site
   * data. Only colours (`#rgb`…`#rrggbbaa`) and plain numbers or lengths get through.
   */
  vars?: Record<string, string>;
  /**
   * Site data this element shows, editable on the canvas (editor only; the published page carries
   * none of it). One text field whose value is the element's text is edited in place; anything
   * else (a formatted time, a link's address, several fields) opens a small form over it.
   */
  edit?: EditField | EditField[];
  /**
   * Clicking the element in the editor adds site data: appends `value` to the list at `path`, or
   * sets `path` when it has no value yet. Use it for "add the first item" placeholders, which the
   * component renders in the editor only.
   */
  add?: AddData;
  /** The element is one item of a list in site data (`schedule.2`): it can be moved, copied, removed. */
  item?: {
    path: string /** Keys whose values must stay unique when the item is copied. */;
    unique?: string[];
  };
}

/** Site data a click adds on the canvas (see `ElementSpec.add`). */
export interface AddData {
  /** A list (`schedule`, `dresscode.colors`) to append to, or a value to fill in (`travel.text`). */
  path: string;
  /** The new item or value. An object is a list item: a list that doesn't exist yet starts with it. */
  value: unknown;
  /** Field to edit right after adding, relative to the new item (`title`); `''` for the value itself. */
  edit?: string;
}

/**
 * A value an element shows that can be edited on the canvas (see `ElementSpec.edit`): a piece of
 * site data (`path`), or a prop of the node the element belongs to (`prop`). Markup a host renders
 * itself (a code component's) marks its text the same way, with a `data-bb-edit` attribute holding
 * these fields as JSON.
 */
export interface EditField {
  /** Site data: `<group>.<path>`, e.g. `schedule.0.time`. */
  path?: string;
  /** A prop of the closest node (`data-bb-node`), e.g. `heading`. Used when there is no `path`. */
  prop?: string;
  /** Input to use. Default `text`. */
  kind?: 'text' | 'multiline' | 'time' | 'date' | 'url' | 'color' | 'select';
  /** The stored value (what the element shows may be formatted). */
  value?: string;
  label?: string;
  /** For `select`: `[value, label]` pairs. */
  options?: [string, string][];
  /** Empty is refused instead of removing the value. */
  required?: boolean;
}

/** What a component's `render` can read besides its node. */
export interface RenderContext {
  /** A site data group (`SiteDoc.data`), e.g. the event's schedule. */
  data(key: string): unknown;
  /** The language being rendered (`undefined`: the default language). */
  locale?: string;
  /**
   * `editor` while editing: elements may carry `data-bb-data="<group>.<path>"` so a click can
   * open that piece of data. The published output drops those attributes.
   */
  mode: 'editor' | 'published';
  /** The document (for things like a menu built from a page's sections). */
  view: DocView;
}

/** A group of site data (e.g. the venues of an event), shared by the sections that show it. */
export interface DataDef {
  /** Key in `SiteDoc.data`, e.g. `schedule`. */
  key: string;
  title: string;
  /** For agents and people: what this data is and where it shows. */
  description: string;
  /** Every write is validated against it (and stored as parsed). */
  schema: z.ZodType;
}

export interface ComponentDef {
  name: string;
  /** `primitive`: built in, rendered from `render`. `code`: host component rendered as a custom element `tag`. */
  kind: 'primitive' | 'code';
  title?: string;
  description: string;
  // biome-ignore lint/suspicious/noExplicitAny: any object schema is accepted
  props: z.ZodObject<any, any>;
  /**
   * Whether the node may have children; `{ allow }` restricts child types, `{ deny }` rules some
   * out (a link can't contain links or buttons).
   */
  children: boolean | { allow?: string[]; deny?: string[] };
  /** Props editable at the "content" freedom level (copy, links, images). */
  contentProps?: string[];
  /**
   * `false`: people and agents can't add it with `node.insert` (e.g. the page root, or parts only
   * section templates use).
   */
  insertable?: boolean;
  render?: (node: BNode, ctx: RenderContext) => ElementSpec;
  /**
   * Checks the schema can't make: props against the registry (an icon name that exists) or against
   * each other. Runs on parsed props whenever they are written; each problem refuses the change.
   */
  validate?: (props: Props, registry: Registry) => PropProblem[];
  /** Custom element tag for code components. */
  tag?: string;
}

/** A problem `ComponentDef.validate` found with a prop. */
export interface PropProblem {
  /** The prop, e.g. `name`. */
  path: string;
  message: string;
  hint?: string;
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

export function defineData(def: DataDef): DataDef {
  if (!/^[a-z][a-zA-Z0-9-]*$/.test(def.key)) {
    throw new Error(
      `Data key "${def.key}" must start with a letter and use letters, digits or "-".`,
    );
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
  private readonly dataDefs = new Map<string, DataDef>();
  private readonly icons = new Map<string, IconDef>();

  /**
   * Adds icons by name (`arrow-right`), as SVG markup or as parsed drawings (`parseIcon`). Only
   * plain drawings are taken (see `parseIcon`); a name or drawing that isn't one throws, so a
   * broken icon set shows up when the registry is built, not on a published page.
   */
  registerIcons(icons: Record<string, string | IconDef>): this {
    for (const [name, source] of Object.entries(icons)) {
      if (!ICON_NAME.test(name))
        throw new Error(`Icon name "${name}" must be lowercase kebab-case, e.g. "arrow-right".`);
      const def =
        typeof source === 'string' ? parseIcon(source) : isIconDef(source) ? source : undefined;
      if (!def)
        throw new Error(
          `Icon "${name}" is not a plain SVG drawing: only path, circle, ellipse, rect, line, polyline and polygon shapes with "none" or "currentColor" paint are allowed.`,
        );
      this.icons.set(name, def);
    }
    return this;
  }

  icon(name: string): IconDef | undefined {
    return this.icons.get(name);
  }

  /** Names of the registered icons, in the order they were added. */
  listIcons(): string[] {
    return [...this.icons.keys()];
  }

  /** Declares a site data group (see `defineData`). */
  registerData(def: DataDef): this {
    this.dataDefs.set(def.key, def);
    return this;
  }

  dataDef(key: string): DataDef | undefined {
    return this.dataDefs.get(key);
  }

  listData(): DataDef[] {
    return [...this.dataDefs.values()];
  }

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
    const { allow, deny } = def.children;
    return (!allow || allow.includes(childType)) && !deny?.includes(childType);
  }
}

export interface RegistryOptions {
  components?: ComponentDef[];
  sections?: SectionDef[];
  data?: DataDef[];
  /** Icons for `icon` nodes, by name: SVG markup or parsed drawings (see `Registry.registerIcons`). */
  icons?: Record<string, string | IconDef>;
}

/** A registry with the built-in primitives plus any given components and sections. */
export function createRegistry(options: RegistryOptions = {}): Registry {
  const registry = new Registry();
  for (const def of PRIMITIVES) registry.registerComponent(def);
  for (const def of options.components ?? []) registry.registerComponent(def);
  for (const def of options.sections ?? []) registry.registerSection(def);
  for (const def of options.data ?? []) registry.registerData(def);
  if (options.icons) registry.registerIcons(options.icons);
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
    const wanted = Object.hasOwn(input, axis) ? input[axis] : undefined;
    if (wanted === undefined) variant[axis] = values[0]!;
    else if (values.includes(wanted)) variant[axis] = wanted;
    else
      errors.push(
        `Variant "${axis}" of "${def.name}" can't be "${wanted}"; allowed: ${values.join(', ')}.`,
      );
  }
  for (const axis of Object.keys(input)) {
    if (!Object.hasOwn(axes, axis)) {
      const known = Object.keys(axes);
      errors.push(
        `Section "${def.name}" has no variant axis "${axis}"${known.length ? `; axes: ${known.join(', ')}` : ''}.`,
      );
    }
  }
  return { variant, errors };
}

/** One addressable part of a section template. */
export interface TemplatePart {
  /** Path relative to the section root, e.g. `heading` or `tier-pro/price`. */
  path: string;
  input: NodeInput;
}

/**
 * The addressable parts a section template creates, with the same id rules the store uses:
 * a part's id is `<section id>/<path>`, and only keyed parts add a level to the path.
 */
export function templateParts(def: SectionDef, variant?: Record<string, string>): TemplatePart[] {
  const resolved = resolveVariant(def, variant).variant;
  const out: TemplatePart[] = [];
  const walk = (input: NodeInput, scope: string) => {
    let childScope = scope;
    if (input.part) {
      const path = scope + slugify(input.key ? `${input.part}-${input.key}` : input.part);
      out.push({ path, input });
      if (input.key) childScope = `${path}/`;
    }
    for (const child of input.children ?? []) walk(child, childScope);
  };
  for (const child of def.template({ variant: resolved }).children ?? []) walk(child, '');
  return out;
}

export type { Props };
