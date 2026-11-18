import {
  type BNode,
  createEmptyDoc,
  createRegistry,
  DEFAULT_BREAKPOINTS,
  defineSection,
  t,
} from '@bowerbirdjs/core';
import { compileCss, nodeCss, sectionCss, tokenDeclarations } from '@bowerbirdjs/css';
import { describe, expect, it } from 'vitest';

const node = (id: string, extra: Partial<BNode>): BNode => ({
  id,
  type: 'box',
  parent: 'root',
  order: 'a0',
  props: {},
  ...extra,
});

describe('tokenDeclarations', () => {
  it('emits base tokens and theme overrides with aliases resolved to variables', () => {
    const doc = createEmptyDoc({
      tokens: { color: { surface: { $value: '#fff' }, ink: { $value: '#111' } } },
      themes: { dark: { 'color.surface': '{color.ink}' } },
    });
    expect(tokenDeclarations(doc)).toEqual({
      base: ['--color-surface: #fff;', '--color-ink: #111;'],
      themes: [['dark', ['--color-surface: var(--color-ink);']]],
    });
  });
});

describe('nodeCss', () => {
  it('orders breakpoints mobile-first and maps states to pseudo-classes', () => {
    const css = nodeCss(
      [
        node('a', {
          vars: { '--x': 'var(--y)' },
          styles: {
            lg: { default: { gap: 'var(--space-lg)' } },
            base: { default: { gap: 'var(--space-sm)' }, hover: { color: 'var(--c)' } },
            md: { 'focus-visible': { outline: 'var(--o)' } },
          },
        }),
      ],
      DEFAULT_BREAKPOINTS,
    );
    const iVars = css.indexOf('--x: var(--y)');
    const iBase = css.indexOf('gap: var(--space-sm)');
    const iHover = css.indexOf('[data-bb-node="a"]:hover');
    const iMd = css.indexOf('@container bb-page (min-width: 768px)');
    const iLg = css.indexOf('@container bb-page (min-width: 1024px)');
    expect([iVars, iBase, iHover, iMd, iLg].every((i) => i >= 0)).toBe(true);
    expect(iVars < iBase && iBase < iHover && iHover < iMd && iMd < iLg).toBe(true);
    expect(css).toContain('[data-bb-node="a"]:focus-visible');
  });

  it('skips nodes without styles', () => {
    expect(nodeCss([node('a', {})], DEFAULT_BREAKPOINTS)).toBe('');
  });
});

describe('sectionCss', () => {
  it('emits variable defaults once per section, before its CSS', () => {
    const registry = createRegistry({
      sections: [
        defineSection({
          name: 'promo',
          version: 1,
          title: 'Promo',
          description: 'x',
          vars: { '--promo-bg': { type: 'color', default: 'var(--color-surface)' } },
          css: '.bb-promo { background: var(--promo-bg); }',
          template: () => t.box({}, []),
        }),
      ],
    });
    const css = sectionCss(registry, ['promo', 'promo', 'unknown']);
    expect(css).toBe(
      '.bb-promo {\n  --promo-bg: var(--color-surface);\n}\n\n.bb-promo { background: var(--promo-bg); }',
    );
  });
});

describe('compileCss', () => {
  it('uses a custom canvas selector in editor mode', () => {
    const doc = createEmptyDoc({ tokens: { space: { sm: '4px' } } });
    const css = compileCss(doc, createRegistry(), { mode: 'editor', canvasSelector: '#canvas' });
    expect(css.startsWith('#canvas {\n  --space-sm: 4px;\n}')).toBe(true);
    expect(css).toContain('#canvas {\n  .bb-page { all: initial; display: block; }');
  });

  it('editor mode converts rem to px and boosts node rules above section rules', () => {
    const doc = createEmptyDoc({ tokens: { space: { lg: '1.5rem' } } });
    doc.nodes['box-1'] = {
      id: 'box-1',
      type: 'box',
      parent: null,
      order: 'a0',
      props: {},
      styles: { base: { default: { padding: 'var(--space-lg)' } } },
    };
    const css = compileCss(doc, createRegistry(), { mode: 'editor' });
    expect(css).toContain('--space-lg: calc(1.5 * 16px);');
    expect(css).toContain('[data-bb-node="box-1"]:is(#bb-node, *) {');
    const published = compileCss(doc, createRegistry());
    expect(published).toContain('--space-lg: 1.5rem;');
    expect(published).not.toContain(':is(#bb-node');
  });
});
