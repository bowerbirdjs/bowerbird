import type { TokenTree } from './types.js';
import { isPlainObject } from './util.js';

export interface FlatToken {
  /** Dot path, e.g. `color.brand.600`. */
  path: string;
  /** CSS custom property, e.g. `--color-brand-600`. */
  cssVar: string;
  /** CSS value; aliases are rewritten to `var(--…)`. */
  value: string;
  type?: string;
  description?: string;
}

export const TOKEN_NAME = /^[A-Za-z0-9_-]+$/;
export const TOKEN_PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

export function tokenVar(path: string): string {
  return `--${path.split('.').join('-')}`;
}

/** Rewrites DTCG aliases (`{color.brand.600}`) to `var(--color-brand-600)`. */
export function aliasToCss(value: string): string {
  return value.replace(/\{([^{}]+)\}/g, (_, p: string) => `var(${tokenVar(p.trim())})`);
}

export function aliasesIn(value: string): string[] {
  return [...value.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!.trim());
}

const COLOR_FUNCTIONS = new Set(['oklch', 'oklab', 'lab', 'lch', 'hsl', 'hwb']);

function dimension(v: unknown): string | undefined {
  if (isPlainObject(v) && 'value' in v && 'unit' in v) return `${v.value}${v.unit}`;
  if (typeof v === 'string') return aliasToCss(v);
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Converts a DTCG `$value` to a single CSS value, or `undefined` if that's not possible. */
export function toCssValue(value: unknown, type?: string): string | undefined {
  if (typeof value === 'string') return aliasToCss(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (type === 'cubicBezier' && value.length === 4 && value.every((n) => typeof n === 'number')) {
      return `cubic-bezier(${value.join(', ')})`;
    }
    if (value.every((v) => typeof v === 'string')) {
      return (value as string[])
        .map((f) => (/^[\w-]+$/.test(f) || f.startsWith('{') ? aliasToCss(f) : `"${f}"`))
        .join(', ');
    }
    if (value.every((v) => isPlainObject(v) && 'offsetX' in v)) {
      const parts = value.map((v) => toCssValue(v, 'shadow'));
      return parts.every(Boolean) ? parts.join(', ') : undefined;
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    if ('value' in value && 'unit' in value) return `${value.value}${value.unit}`;
    if (typeof value.hex === 'string' && !('components' in value && value.colorSpace !== 'srgb')) {
      return value.hex;
    }
    if (typeof value.colorSpace === 'string' && Array.isArray(value.components)) {
      const cs = value.colorSpace;
      const comps = value.components.map((c) => (c === 'none' ? 'none' : String(c))).join(' ');
      const alpha = typeof value.alpha === 'number' && value.alpha !== 1 ? ` / ${value.alpha}` : '';
      if (COLOR_FUNCTIONS.has(cs)) return `${cs}(${comps}${alpha})`;
      return `color(${cs} ${comps}${alpha})`;
    }
    if ('offsetX' in value) {
      const parts = [value.offsetX, value.offsetY, value.blur, value.spread].map(dimension);
      const color = toCssValue(value.color, 'color');
      if (parts.some((p) => p === undefined) || !color) return undefined;
      return `${value.inset ? 'inset ' : ''}${parts.join(' ')} ${color}`;
    }
  }
  return undefined;
}

/** Flattens a DTCG token tree. Plain string/number leaves are accepted as a shorthand. */
export function flattenTokens(tree: TokenTree): { tokens: FlatToken[]; issues: string[] } {
  const tokens: FlatToken[] = [];
  const issues: string[] = [];
  const push = (path: string[], raw: unknown, type: string | undefined, description?: unknown) => {
    const p = path.join('.');
    const value = toCssValue(raw, type);
    if (value === undefined) {
      issues.push(`Token "${p}" has a value that can't be expressed as a single CSS value.`);
      return;
    }
    tokens.push({
      path: p,
      cssVar: tokenVar(p),
      value,
      ...(type ? { type } : {}),
      ...(typeof description === 'string' ? { description } : {}),
    });
  };
  const walk = (node: Record<string, unknown>, path: string[], inheritedType?: string) => {
    const groupType = typeof node.$type === 'string' ? node.$type : inheritedType;
    if ('$value' in node) {
      push(path, node.$value, groupType, node.$description);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (!TOKEN_NAME.test(key)) {
        issues.push(
          `Token name "${[...path, key].join('.')}" may only contain letters, digits, - and _.`,
        );
        continue;
      }
      if (isPlainObject(child)) walk(child, [...path, key], groupType);
      else if (typeof child === 'string' || typeof child === 'number') {
        push([...path, key], child, groupType);
      }
    }
  };
  walk(tree, []);
  return { tokens, issues };
}

export function getTokenLeaf(tree: TokenTree, path: string): Record<string, unknown> | undefined {
  let node: unknown = tree;
  for (const seg of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[seg];
  }
  if (isPlainObject(node) && '$value' in node) return node;
  if (typeof node === 'string' || typeof node === 'number') return { $value: node };
  return undefined;
}

/** Token CSS variables mapped to their final values, following `var(--…)` aliases. */
export function resolvedTokenValues(tokens: FlatToken[]): Map<string, string> {
  const raw = new Map(tokens.map((t) => [t.cssVar, t.value]));
  const out = new Map<string, string>();
  for (const [name, value] of raw) {
    let current = value;
    for (let depth = 0; depth < 10; depth++) {
      const alias = /^var\((--[A-Za-z0-9_-]+)\)$/.exec(current.trim());
      const next = alias && raw.get(alias[1]!);
      if (!next) break;
      current = next;
    }
    out.set(name, current);
  }
  return out;
}
