import { generateKeyBetween } from 'fractional-indexing';

/** A fractional-index key that sorts between `a` and `b` (either may be null for open ends). */
export function keyBetween(a: string | null | undefined, b: string | null | undefined): string {
  return generateKeyBetween(a ?? null, b ?? null);
}

export function compareOrder(a: { order: string; id: string }, b: { order: string; id: string }) {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
