export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** False for keys that would reach an object's prototype (`__proto__`, `constructor`, `prototype`). */
export function isSafeKey(key: string): boolean {
  return !UNSAFE_KEYS.has(key);
}

/** `record[key]` if it's an own property, otherwise undefined. */
export function own<V>(record: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Returns `record[key]`, creating it with `make()` first if it's missing. */
export function ensure<V>(record: Record<string, V>, key: string, make: () => NoInfer<V>): V {
  if (!isSafeKey(key)) throw new Error(`Unsafe key "${key}".`);
  const existing = own(record, key);
  if (existing !== undefined) return existing;
  const created = make();
  record[key] = created;
  return created;
}

/** Map version of `ensure`. */
export function ensureIn<K, V>(map: Map<K, V>, key: K, make: () => NoInfer<V>): V {
  const existing = map.get(key);
  if (existing !== undefined) return existing;
  const created = make();
  map.set(key, created);
  return created;
}

/** Removes empty nested objects (two levels deep, as used by node styles). */
export function pruneEmpty<T extends Record<string, Record<string, Record<string, unknown>>>>(
  styles: T,
): T | undefined {
  for (const [bp, states] of Object.entries(styles)) {
    for (const [state, decls] of Object.entries(states)) {
      if (Object.keys(decls).length === 0) delete states[state];
    }
    if (Object.keys(states).length === 0) delete styles[bp];
  }
  return Object.keys(styles).length ? styles : undefined;
}
