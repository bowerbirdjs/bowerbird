/**
 * Icons are small drawings a page shows (`icon` nodes, `ElementSpec.icon`). A registry keeps them as
 * checked data, never as markup: shapes from a short allow-list whose colours can only be "none" or
 * the text colour. The renderer writes the SVG itself, so an icon can't carry scripts, links, styles
 * or anything that loads a resource, wherever its drawing came from.
 */

export type IconShapeTag = 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polyline' | 'polygon';

export interface IconShape {
  tag: IconShapeTag;
  /** Geometry and the few style overrides in `SHAPE_ATTRS`, already validated. */
  attrs: Record<string, string>;
}

export interface IconDef {
  /** `min-x min-y width height`, e.g. `0 0 24 24`. */
  viewBox: string;
  /** `stroke`: an outline drawn in the text colour. `fill`: solid shapes in the text colour. */
  style: 'stroke' | 'fill';
  /** Line width of a `stroke` icon, in view-box units. */
  strokeWidth: number;
  shapes: IconShape[];
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const NUMBER_LIST = /^[\d\s,.+\-eE]+$/;
const PATH_DATA = /^[MmZzLlHhVvCcSsQqTtAa\d\s,.+\-eE]+$/;
const PAINT = /^(?:none|currentColor)$/i;

const num = (v: string) => NUMBER.test(v);
const paint = (v: string) => PAINT.test(v);
const oneOf =
  (...values: string[]) =>
  (v: string) =>
    values.includes(v);

/** Attributes any shape may carry besides its geometry. */
const STYLE_ATTRS: Record<string, (v: string) => boolean> = {
  fill: paint,
  stroke: paint,
  'stroke-width': num,
  'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel'),
  'stroke-dasharray': (v) => NUMBER_LIST.test(v),
  'fill-rule': oneOf('nonzero', 'evenodd'),
  'clip-rule': oneOf('nonzero', 'evenodd'),
  opacity: num,
  'fill-opacity': num,
  'stroke-opacity': num,
};

const SHAPE_ATTRS: Record<IconShapeTag, Record<string, (v: string) => boolean>> = {
  path: { d: (v) => v.length <= 8000 && PATH_DATA.test(v) },
  circle: { cx: num, cy: num, r: num },
  ellipse: { cx: num, cy: num, rx: num, ry: num },
  rect: { x: num, y: num, width: num, height: num, rx: num, ry: num },
  line: { x1: num, y1: num, x2: num, y2: num },
  polyline: { points: (v) => v.length <= 4000 && NUMBER_LIST.test(v) },
  polygon: { points: (v) => v.length <= 4000 && NUMBER_LIST.test(v) },
};

/** The check for an attribute of a shape, if that shape may carry it (own entries only). */
function attrCheck(tag: IconShapeTag, key: string): ((v: string) => boolean) | undefined {
  const allowed = SHAPE_ATTRS[tag];
  if (Object.hasOwn(allowed, key)) return allowed[key];
  return Object.hasOwn(STYLE_ATTRS, key) ? STYLE_ATTRS[key] : undefined;
}

const MAX_MARKUP = 20_000;
const MAX_SHAPES = 64;

const TAG =
  /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function readAttrs(source: string): Record<string, string> {
  // No prototype, so an attribute called `constructor` or `__proto__` is just another name.
  const out: Record<string, string> = Object.create(null);
  for (const m of source.matchAll(ATTR)) {
    const name = m[1]!;
    if (!Object.hasOwn(out, name)) out[name] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}

/**
 * Reads an icon from SVG markup: a whole `<svg viewBox="…">…</svg>` (as icon packages ship them)
 * or just its shapes. Only plain drawings are taken: `path`, `circle`, `ellipse`, `rect`, `line`,
 * `polyline` and `polygon` (inside `<g>` without attributes, at most), with numbers for geometry and
 * `none` or `currentColor` for colours. Anything else (text, groups with transforms, gradients,
 * `<use>`, styles, scripts) makes it `undefined` rather than a guess at what was meant.
 */
export function parseIcon(
  markup: string,
  defaults: { viewBox?: string; style?: IconDef['style']; strokeWidth?: number } = {},
): IconDef | undefined {
  if (typeof markup !== 'string' || markup.length > MAX_MARKUP) return undefined;
  const source = markup
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  let viewBox = defaults.viewBox ?? '0 0 24 24';
  let style: IconDef['style'] | undefined = defaults.style;
  let strokeWidth = defaults.strokeWidth;
  const shapes: IconShape[] = [];
  let at = 0;
  let depth = 0;
  let sawSvg = false;
  let closedSvg = false;
  const skipSpace = () => {
    while (at < source.length && /\s/.test(source[at]!)) at++;
  };
  for (skipSpace(); at < source.length; skipSpace()) {
    TAG.lastIndex = at;
    const m = TAG.exec(source);
    if (!m || closedSvg) return undefined;
    at = TAG.lastIndex;
    const [, closing, rawName, rawAttrs, selfClosing] = m;
    const name = rawName!.toLowerCase();
    const attrs = readAttrs(rawAttrs ?? '');
    if (name === 'svg') {
      if (closing) {
        if (!sawSvg || depth !== 0) return undefined;
        closedSvg = true;
        continue;
      }
      if (sawSvg || shapes.length || selfClosing) return undefined;
      sawSvg = true;
      const box = attrs.viewBox ?? attrs.viewbox;
      if (box !== undefined) {
        const parts = box.split(/[\s,]+/).filter(Boolean);
        if (
          parts.length !== 4 ||
          !parts.every(num) ||
          Number(parts[2]) <= 0 ||
          Number(parts[3]) <= 0
        )
          return undefined;
        viewBox = parts.map(Number).join(' ');
      }
      // An icon package says how it draws on the root: outlines (`fill="none"`) or solid shapes.
      if (!style) {
        if (attrs.fill && !paint(attrs.fill)) return undefined;
        if (attrs.stroke && !paint(attrs.stroke)) return undefined;
        const stroked = !!attrs.stroke && attrs.stroke.toLowerCase() !== 'none';
        // With neither, SVG fills shapes (solid icon sets ship their files that way).
        style = stroked || attrs.fill?.toLowerCase() === 'none' ? 'stroke' : 'fill';
      }
      if (strokeWidth === undefined && attrs['stroke-width'] && num(attrs['stroke-width']))
        strokeWidth = Number(attrs['stroke-width']);
      continue;
    }
    if (name === 'g') {
      // A bare group only wraps shapes; one with attributes (a transform, say) changes them.
      if (closing) {
        if (depth === 0) return undefined;
        depth--;
      } else {
        if (Object.keys(attrs).length) return undefined;
        if (!selfClosing) depth++;
      }
      continue;
    }
    if (!Object.hasOwn(SHAPE_ATTRS, name)) return undefined;
    // `<path …></path>`: the closing tag of a shape opened just before.
    if (closing) continue;
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (!attrCheck(name as IconShapeTag, key)?.(value)) return undefined;
      clean[key] = value;
    }
    if (shapes.length >= MAX_SHAPES) return undefined;
    shapes.push({ tag: name as IconShapeTag, attrs: clean });
  }
  if (!shapes.length || depth !== 0 || (sawSvg && !closedSvg)) return undefined;
  const width =
    strokeWidth !== undefined && strokeWidth > 0 && strokeWidth <= 100 ? strokeWidth : 2;
  return { viewBox, style: style ?? 'stroke', strokeWidth: width, shapes };
}

/** Whether a value is an icon as `parseIcon` builds them (stored or hand-written data is re-checked). */
export function isIconDef(value: unknown): value is IconDef {
  if (!value || typeof value !== 'object') return false;
  const def = value as Partial<IconDef>;
  if (typeof def.viewBox !== 'string' || !/^[\d\s.+-]+$/.test(def.viewBox)) return false;
  if (def.style !== 'stroke' && def.style !== 'fill') return false;
  if (typeof def.strokeWidth !== 'number' || !Number.isFinite(def.strokeWidth)) return false;
  if (!Array.isArray(def.shapes) || !def.shapes.length || def.shapes.length > MAX_SHAPES)
    return false;
  return def.shapes.every((shape) => {
    if (!shape || typeof shape !== 'object' || !Object.hasOwn(SHAPE_ATTRS, shape.tag)) return false;
    const { attrs } = shape;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
    return Object.entries(attrs).every(
      ([key, v]) => typeof v === 'string' && attrCheck(shape.tag, key)?.(v) === true,
    );
  });
}

/** Icon names: lowercase kebab-case, like ids (`arrow-right`). */
export const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The SVG for an icon, sized to the text (`1em`) unless CSS says otherwise and coloured by
 * `currentColor`. Hidden from assistive technology: name it on the element around it.
 */
export function iconSvg(icon: IconDef): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const shapes = icon.shapes
    .map(
      (s) =>
        `<${s.tag}${Object.entries(s.attrs)
          .map(([k, v]) => ` ${k}="${esc(v)}"`)
          .join('')}/>`,
    )
    .join('');
  const paint =
    icon.style === 'fill'
      ? 'fill="currentColor"'
      : `fill="none" stroke="currentColor" stroke-width="${icon.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  return `<svg viewBox="${esc(icon.viewBox)}" width="1em" height="1em" ${paint} aria-hidden="true" focusable="false">${shapes}</svg>`;
}
