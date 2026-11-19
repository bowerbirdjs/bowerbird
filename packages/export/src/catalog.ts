import { type Registry, templateParts } from '@bowerbirdjs/core';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

export interface CatalogComponent {
  name: string;
  description: string;
  kind: string;
  /** Whether it takes children (`true`, `false`, or the allowed child types). */
  children: boolean | string[];
  /** Props people with content-only access may edit. */
  contentProps: string[];
  props: JsonSchema;
}

export interface CatalogSection {
  name: string;
  title: string;
  description: string;
  category?: string;
  variants: Record<string, string[]>;
  vars: Record<string, { type: string; default: string; description?: string }>;
  /** Addressable parts (default variant): path, component type and default props. */
  parts: { path: string; type: string; props: Record<string, unknown> }[];
}

/**
 * A machine-readable catalog of everything a registry offers. Generative-UI tools that work from a
 * component catalog (A2UI, json-render and similar) can use it to produce node trees that
 * Bowerbird imports with `node.insert`; `nodeSchema` validates such a tree.
 */
export interface Catalog {
  format: 'bowerbird-catalog';
  version: 1;
  components: CatalogComponent[];
  sections: CatalogSection[];
  /** JSON Schema of a node tree (`{ type, props, children }`) built from these components. */
  nodeSchema: JsonSchema;
}

const strip = ({ $schema: _, ...schema }: JsonSchema) => schema;

export function exportCatalog(registry: Registry): Catalog {
  const components = registry
    .listComponents()
    .filter((c) => c.insertable !== false)
    .map(
      (c): CatalogComponent => ({
        name: c.name,
        description: c.description,
        kind: c.kind,
        children:
          typeof c.children === 'object'
            ? c.children.allow
              ? [...c.children.allow]
              : true
            : c.children,
        contentProps: [...(c.contentProps ?? [])],
        props: strip(
          z.toJSONSchema(c.props, { io: 'input', unrepresentable: 'any' }) as JsonSchema,
        ),
      }),
    );
  const sections = registry.listSections().map(
    (s): CatalogSection => ({
      name: s.name,
      title: s.title,
      description: s.description,
      ...(s.category ? { category: s.category } : {}),
      variants: Object.fromEntries(Object.entries(s.variants ?? {}).map(([k, v]) => [k, [...v]])),
      vars: Object.fromEntries(
        Object.entries(s.vars ?? {}).map(([k, v]) => [
          k,
          {
            type: v.type,
            default: v.default,
            ...(v.description ? { description: v.description } : {}),
          },
        ]),
      ),
      parts: templateParts(s).map((p) => ({
        path: p.path,
        type: p.input.type,
        props: p.input.props ?? {},
      })),
    }),
  );
  const nodeSchema: JsonSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: '#/$defs/node',
    $defs: {
      node: {
        oneOf: components.map((c) => ({
          type: 'object',
          required: ['type'],
          additionalProperties: false,
          properties: {
            type: { const: c.name },
            props: c.props,
            css: {
              type: 'string',
              description: 'Base-breakpoint CSS declarations using design tokens.',
            },
            name: { type: 'string' },
            ...(c.children ? { children: { type: 'array', items: { $ref: '#/$defs/node' } } } : {}),
          },
        })),
      },
    },
  };
  return { format: 'bowerbird-catalog', version: 1, components, sections, nodeSchema };
}
