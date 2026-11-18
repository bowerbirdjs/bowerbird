import type { NodeInput } from '@bowerbirdjs/core';

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

const isItem = (v: unknown): v is PuckItem =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as PuckItem).type === 'string' &&
  typeof (v as PuckItem).props === 'object';

const HEADING_KEYS = /^(title|heading|headline|name)$/i;

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

  const childrenOf =
    (item: PuckItem) =>
    (zone: string): NodeInput[] => {
      const slot = item.props[zone];
      const items =
        Array.isArray(slot) && slot.every(isItem)
          ? slot
          : (data.zones?.[`${item.props.id}:${zone}`] ?? []);
      return items.flatMap((child) => {
        const target = convert(child);
        if (!target) return [];
        if ('node' in target) return [target.node];
        warnings.push(`"${child.type}" maps to a section, which can't be nested; it was skipped.`);
        return [];
      });
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
        children.push(...childrenOf(item)(key));
      }
    }
    for (const zone of Object.keys(data.zones ?? {})) {
      const [owner, name] = zone.split(':');
      if (owner === item.props.id && name) children.push(...childrenOf(item)(name));
    }
    return { type: 'box', name: item.type, props: {}, children };
  };

  const convert = (item: PuckItem): PuckTarget => {
    const mapper = map[item.type];
    if (!mapper) {
      unmapped.add(item.type);
      return { node: generic(item) };
    }
    try {
      return mapper(item.props, childrenOf(item));
    } catch (error) {
      warnings.push(
        `Mapping "${item.type}" failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
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
      ops.push({ op: 'node.insert', parent: options.parent, node: target.node });
    } else {
      warnings.push(
        `"${item.type}" became plain nodes, but no parent was given; pass the page root id as "parent".`,
      );
    }
  }
  if (unmapped.size)
    warnings.push(
      `No mapping for ${[...unmapped].join(', ')}; imported as plain boxes with their text.`,
    );
  const title = typeof data.root?.props?.title === 'string' ? data.root.props.title : undefined;
  return { ops, warnings, ...(title ? { title } : {}) };
}
