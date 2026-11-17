/**
 * Small helpers for writing framework-free section templates:
 *
 *   box({ tag: 'section' }, [
 *     text({ part: 'heading', tag: 'h1', text: 'Hello' }),
 *     link({ part: 'cta', href: '#', text: 'Start' }),
 *   ])
 */
import type { NodeInput } from './registry.js';
import type { NodeStyles } from './types.js';

type Child = NodeInput | null | undefined | false;

interface Common {
  part?: string;
  key?: string;
  css?: string;
  styles?: NodeStyles;
  vars?: Record<string, string>;
  name?: string;
}

const clean = (children: Child[]): NodeInput[] => children.filter((c): c is NodeInput => !!c);

function node(
  type: string,
  common: Common,
  props: Record<string, unknown>,
  children?: Child[],
): NodeInput {
  const { part, key, css, styles, vars, name } = common;
  const out: NodeInput = { type, props };
  if (part) out.part = part;
  if (key) out.key = key;
  if (css) out.css = css;
  if (styles) out.styles = styles;
  if (vars) out.vars = vars;
  if (name) out.name = name;
  if (children) out.children = clean(children);
  return out;
}

export function box(
  opts: Common & { tag?: string; label?: string } = {},
  children: Child[] = [],
): NodeInput {
  const { tag, label, ...common } = opts;
  return node('box', common, { ...(tag ? { tag } : {}), ...(label ? { label } : {}) }, children);
}

export function text(opts: Common & { tag?: string; text: string }): NodeInput {
  const { tag, text: t, ...common } = opts;
  return node('text', common, { ...(tag ? { tag } : {}), text: t });
}

export function link(
  opts: Common & { href: string; text?: string; target?: '_self' | '_blank'; label?: string },
  children?: Child[],
): NodeInput {
  const { href, text: t, target, label, ...common } = opts;
  return node(
    'link',
    common,
    {
      href,
      ...(t !== undefined ? { text: t } : {}),
      ...(target ? { target } : {}),
      ...(label ? { label } : {}),
    },
    children,
  );
}

export function button(
  opts: Common & { text: string; type?: 'button' | 'submit' | 'reset' },
): NodeInput {
  const { text: t, type, ...common } = opts;
  return node('button', common, { text: t, ...(type ? { type } : {}) });
}

export function image(
  opts: Common & {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    loading?: 'lazy' | 'eager';
  },
): NodeInput {
  const { src, alt, width, height, loading, ...common } = opts;
  return node('image', common, {
    src,
    alt,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(loading ? { loading } : {}),
  });
}

/** Any registered component, e.g. a host code component. */
export function component(
  type: string,
  opts: Common & { props?: Record<string, unknown> } = {},
  children?: Child[],
) {
  const { props, ...common } = opts;
  return node(type, common, props ?? {}, children);
}
