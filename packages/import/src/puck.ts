import { MAX_DEPTH, type NodeInput } from '@bowerbirdjs/core';

/** Puck's saved data (https://puckeditor.com): a list of components plus nested zones/slots. */
export interface PuckData {
  root?: { props?: Record<string, unknown> };
  content: PuckItem[];
  /** Legacy drop zones, keyed `<componentId>:<zoneName>`. */
  zones?: Record<string, PuckItem[]>;
}

export interface PuckItem {
  type: string;
  props: Record<string, unknown> & { id?: string };
}

/** What a Puck component becomes: a prebuilt section (filled by part path), or nodes. */
export type PuckTarget =
  | {
      section: string;
      variant?: Record<string, string>;
      content?: Record<string, Record<string, unknown>>;
    }
  | { node: NodeInput }
  | null;

/**
 * Maps a Puck component to Bowerbird. `children(zone)` returns the converted contents of one of
 * its zones or slots, for components that wrap others.
 */
export type PuckMapper = (
  props: Record<string, unknown>,
  children: (zone: string) => NodeInput[],
) => PuckTarget;

export interface PuckImportOptions {
  /** Converters by Puck component type. Unmapped types become plain boxes with their text. */
  map?: Record<string, PuckMapper>;
  /** Page for sections (default: the store's only page). */
  page?: string;
  /** Parent for plain nodes: the page's root id (`store.doc.pages[page].rootId`). */
  parent?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isItem = (v: unknown): v is PuckItem =>
  isObject(v) && typeof v.type === 'string' && isObject(v.props);

const HEADING_KEYS = /^(title|heading|headline|name)$/i;

/** Nesting deeper than this is cut off (Bowerbird documents are limited in depth anyway). */
const MAX_NESTING = 40;

/**
 * Converts Puck data into Bowerbird ops (`section.insert` and `node.insert`) for one transaction,
 * plus warnings for anything that couldn't be mapped exactly.
 */
export function importPuck(
  data: PuckData,
  options: PuckImportOptions = {},
): { ops: Record<string, unknown>[]; warnings: string[]; title?: string } {
  const warnings: string[] = [];
  const map = options.map ?? {};
  const unmapped = new Set<string>();
  const zones = isObject(data.zones) ? data.zones : {};
  /** Ids of the components being converted (zones can point back at an ancestor). */
  const active: string[] = [];

  /** Items in the legacy zone `<id>:<name>`. */
  const zoneItems = (item: PuckItem, name: string): unknown[] => {
    const key = `${item.props.id}:${name}`;
    const items = Object.hasOwn(zones, key) ? zones[key] : undefined;
    return Array.isArray(items) ? items : [];
  };

  const convertChildren = (items: unknown[]): NodeInput[] =>
    items.flatMap((child) => {
      if (!isItem(child)) {
        warnings.push('Skipped an entry that is not a Puck component.');
        return [];
      }
      const target = convert(child);
      if (!target) return [];
      if ('node' in target) return [target.node];
      warnings.push(`"${child.type}" maps to a section, which can't be nested; it was skipped.`);
      return [];
    });

  /** A component's slot (a prop holding components) or, failing that, its legacy zone. */
  const childrenOf =
    (item: PuckItem) =>
    (zone: string): NodeInput[] => {
      const slot = Object.hasOwn(item.props, zone) ? item.props[zone] : undefined;
      return convertChildren(
        Array.isArray(slot) && slot.every(isItem) ? slot : zoneItems(item, zone),
      );
    };

  /** Fallback: keep the text of an unknown component, and its nested components, in a box. */
  const generic = (item: PuckItem): NodeInput => {
    const children: NodeInput[] = [];
    for (const [key, value] of Object.entries(item.props)) {
      if (key === 'id') continue;
      if (typeof value === 'string' && value.trim() && !/^(https?:|\/|#)/.test(value)) {
        children.push({
          type: 'text',
          props: { tag: HEADING_KEYS.test(key) ? 'h2' : 'p', text: value.slice(0, 5000) },
        });
      } else if (Array.isArray(value) && value.every(isItem)) {
        children.push(...convertChildren(value));
      }
    }
    // Legacy zones are separate from slots, even when a slot has the same name.
    for (const zone of Object.keys(zones)) {
      const at = zone.indexOf(':');
      if (at > 0 && zone.slice(0, at) === item.props.id)
        children.push(...convertChildren(zoneItems(item, zone.slice(at + 1))));
    }
    return { type: 'box', name: item.type, props: {}, children };
  };

  const convert = (item: PuckItem): PuckTarget => {
    const id = typeof item.props.id === 'string' ? item.props.id : undefined;
    if (id && active.includes(id)) {
      warnings.push(`"${item.type}" (${id}) contains itself through its zones; the loop was cut.`);
      return null;
    }
    if (active.length >= MAX_NESTING) {
      warnings.push(`Components nested deeper than ${MAX_NESTING} levels were skipped.`);
      return null;
    }
    active.push(id ?? '');
    try {
      const mapper = Object.hasOwn(map, item.type) ? map[item.type] : undefined;
      if (!mapper) {
        unmapped.add(item.type);
        return { node: generic(item) };
      }
      return mapper(item.props, childrenOf(item));
    } catch (error) {
      warnings.push(
        `Mapping "${item.type}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      active.pop();
    }
  };

  // Plain nodes go under the page root, where documents allow MAX_DEPTH levels. Generic boxes put
  // their text one level below the box, so the converted tree can be deeper than the components.
  let cut = 0;
  const count = (n: NodeInput): number => 1 + (n.children ?? []).reduce((a, c) => a + count(c), 0);
  const trim = (n: NodeInput, level: number): NodeInput => {
    if (!n.children?.length) return n;
    if (level >= MAX_DEPTH) {
      cut += n.children.reduce((a, c) => a + count(c), 0);
      return { ...n, children: [] };
    }
    return { ...n, children: n.children.map((c) => trim(c, level + 1)) };
  };

  const ops: Record<string, unknown>[] = [];
  const place = options.page ? { page: options.page } : {};
  for (const item of data.content ?? []) {
    if (!isItem(item)) {
      warnings.push('Skipped an entry that is not a Puck component.');
      continue;
    }
    const target = convert(item);
    if (!target) continue;
    if ('section' in target) {
      ops.push({
        op: 'section.insert',
        section: target.section,
        ...place,
        ...(target.variant ? { variant: target.variant } : {}),
        ...(target.content ? { content: target.content } : {}),
      });
    } else if (options.parent) {
      ops.push({ op: 'node.insert', parent: options.parent, node: trim(target.node, 1) });
    } else {
      warnings.push(
        `"${item.type}" became plain nodes, but no parent was given; pass the page root id as "parent".`,
      );
    }
  }
  if (cut) warnings.push(`${cut} node(s) nested deeper than ${MAX_DEPTH} levels were left out.`);
  if (unmapped.size)
    warnings.push(
      `No mapping for ${[...unmapped].join(', ')}; imported as plain boxes with their text.`,
    );
  const title = typeof data.root?.props?.title === 'string' ? data.root.props.title : undefined;
  return { ops, warnings, ...(title ? { title } : {}) };
}
