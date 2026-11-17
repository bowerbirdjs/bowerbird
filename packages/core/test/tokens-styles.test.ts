import {
  checkValue,
  findRawValue,
  flattenTokens,
  parseDeclarations,
  toCssValue,
} from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

describe('tokens', () => {
  it('flattens DTCG trees with inherited types and aliases', () => {
    const { tokens, issues } = flattenTokens({
      color: {
        $type: 'color',
        brand: { 600: { $value: '#4f46e5' } },
        accent: { $value: '{color.brand.600}' },
      },
      space: { $type: 'dimension', lg: { $value: { value: 1.5, unit: 'rem' } } },
      font: {
        body: { $type: 'fontFamily', $value: ['Inter Variable', 'system-ui', 'sans-serif'] },
      },
      radius: { md: '8px' },
    });
    expect(issues).toEqual([]);
    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'color.brand.600',
          cssVar: '--color-brand-600',
          value: '#4f46e5',
          type: 'color',
        }),
        expect.objectContaining({ path: 'color.accent', value: 'var(--color-brand-600)' }),
        expect.objectContaining({ cssVar: '--space-lg', value: '1.5rem' }),
        expect.objectContaining({
          cssVar: '--font-body',
          value: '"Inter Variable", system-ui, sans-serif',
        }),
        expect.objectContaining({ cssVar: '--radius-md', value: '8px' }),
      ]),
    );
  });

  it('converts DTCG colour and shadow objects', () => {
    expect(toCssValue({ colorSpace: 'srgb', components: [1, 0, 0], hex: '#ff0000' })).toBe(
      '#ff0000',
    );
    expect(toCssValue({ colorSpace: 'oklch', components: [0.6, 0.2, 260], alpha: 0.5 })).toBe(
      'oklch(0.6 0.2 260 / 0.5)',
    );
    expect(
      toCssValue({
        color: '#0000001a',
        offsetX: { value: 0, unit: 'px' },
        offsetY: { value: 1, unit: 'px' },
        blur: { value: 3, unit: 'px' },
        spread: { value: 0, unit: 'px' },
      }),
    ).toBe('0px 1px 3px 0px #0000001a');
  });
});

describe('declarations', () => {
  it('splits on semicolons outside parentheses', () => {
    const { decls, issues } = parseDeclarations(
      'grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-lg);',
    );
    expect(issues).toEqual([]);
    expect(decls).toEqual([
      ['grid-template-columns', 'repeat(3, minmax(0, 1fr))'],
      ['gap', 'var(--space-lg)'],
    ]);
  });

  it('flags custom properties and malformed declarations', () => {
    expect(parseDeclarations('--x: 1').issues[0]?.hint).toContain('vars.set');
    expect(parseDeclarations('just words').issues[0]?.code).toBe('invalid_style');
  });

  it('detects raw design values but allows keywords, numbers and percentages', () => {
    expect(findRawValue('padding', '24px')).toBe('24px');
    expect(findRawValue('margin', 'calc(var(--space-lg) * -1)')).toBeUndefined();
    expect(findRawValue('margin', '0 auto')).toBeUndefined();
    expect(findRawValue('width', '100%')).toBeUndefined();
    expect(findRawValue('line-height', '1.2')).toBeUndefined();
    expect(findRawValue('color', 'white')).toBe('white');
    expect(findRawValue('color', 'rgb(0 0 0)')).toBe('rgb()');
    expect(findRawValue('gap', 'var(--space-x, 12px)')).toBe('12px');
  });

  it('checks values against known variables', () => {
    const ctx = { vars: new Set(['--space-lg']), allowRaw: false };
    expect(checkValue('gap', 'var(--space-lg)', ctx)).toEqual([]);
    expect(checkValue('gap', 'var(--space-xl)', ctx)[0]?.code).toBe('unknown_token');
    expect(
      checkValue('background', 'url(javascript:alert(1))', { ...ctx, allowRaw: true })[0]?.code,
    ).toBe('invalid_style');
  });
});
