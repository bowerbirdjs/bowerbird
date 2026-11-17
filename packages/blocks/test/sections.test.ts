import {
  createDefaultRegistry,
  createStarterDoc,
  defaultTokens,
  SECTIONS,
} from '@bowerbirdjs/blocks';
import { createStore, flattenTokens } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

function variantCombos(variants: Record<string, string[]> = {}): Record<string, string>[] {
  return Object.entries(variants).reduce<Record<string, string>[]>(
    (combos, [axis, values]) => combos.flatMap((c) => values.map((v) => ({ ...c, [axis]: v }))),
    [{}],
  );
}

describe('starter sections', () => {
  for (const section of SECTIONS) {
    it(`inserts "${section.name}" in every variant with valid props, tokens and ids`, () => {
      for (const variant of variantCombos(section.variants)) {
        const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
        const res = store.apply({
          ops: [
            { op: 'page.create', path: '/', title: 'Home' },
            { op: 'section.insert', section: section.name, variant },
          ],
        });
        expect(res.ok, JSON.stringify(res)).toBe(true);
        expect(store.doc.nodes[`${section.name}-1`]?.section?.variant).toEqual(variant);
      }
    });
  }

  it('only references tokens that exist in the default theme', () => {
    const tokenVars = new Set(flattenTokens(defaultTokens).tokens.map((t) => t.cssVar));
    const missing: string[] = [];
    for (const section of SECTIONS) {
      const own = new Set(Object.keys(section.vars ?? {}));
      for (const match of (section.css ?? '').matchAll(/var\((--[\w-]+)/g)) {
        const name = match[1]!;
        if (!own.has(name) && !tokenVars.has(name)) missing.push(`${section.name}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('flattens the default tokens without issues', () => {
    expect(flattenTokens(defaultTokens).issues).toEqual([]);
  });
});
