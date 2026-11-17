/**
 * Node ids are short, readable and stable: `hero-1`, `hero-1/heading`, `pricing-1/tier-pro/badge`.
 * Segments are lowercase kebab-case, separated by `/`. Ids identify nodes; they are not paths, so
 * a node keeps its id when moved.
 */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
export const PAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidId(id: string): boolean {
  return id.length <= 200 && ID_PATTERN.test(id);
}

export function slugify(input: string, fallback = 'node'): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** `prefix-1`, `prefix-2`, … — the first that doesn't exist. */
export function nextId(prefix: string, exists: (id: string) => boolean): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!exists(id)) return id;
  }
}

/** Id for a copy: `item-3` → `item-4`, `heading` → `heading-2`. */
export function duplicateId(id: string, exists: (id: string) => boolean): string {
  const match = /^(.*)-(\d+)$/.exec(id);
  const base = match ? match[1]! : id;
  let n = match ? Number(match[2]) + 1 : 2;
  for (; ; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
}
