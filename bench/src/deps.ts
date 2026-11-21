export {
  type BNode,
  descendants,
  findRawValue,
  getTokenLeaf,
  lintPage,
  pageNodes,
  richTextToPlain,
  type SiteDoc,
  type Store,
  toCssValue,
} from '@bowerbirdjs/core';

/** Structural equality for JSON-like values (key order doesn't matter). */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqualJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
