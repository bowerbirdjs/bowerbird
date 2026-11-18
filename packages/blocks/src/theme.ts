import type { TokenTree } from '@bowerbirdjs/core';

const px = (value: number) => ({ value, unit: 'px' });
const rem = (value: number) => ({ value, unit: 'rem' });

/**
 * The default design tokens (W3C DTCG format). Semantic tokens (`color.surface`, `color.accent`, …)
 * alias the palette; sections and agents should use the semantic ones.
 */
export const defaultTokens: TokenTree = {
  color: {
    $type: 'color',
    brand: {
      50: { $value: '#eef2ff' },
      100: { $value: '#e0e7ff' },
      200: { $value: '#c7d2fe' },
      300: { $value: '#a5b4fc' },
      400: { $value: '#818cf8' },
      500: { $value: '#6366f1' },
      600: { $value: '#4f46e5' },
      700: { $value: '#4338ca' },
    },
    neutral: {
      0: { $value: '#ffffff' },
      50: { $value: '#f8fafc' },
      100: { $value: '#f1f5f9' },
      200: { $value: '#e2e8f0' },
      400: { $value: '#94a3b8' },
      600: { $value: '#475569' },
      800: { $value: '#1e293b' },
      900: { $value: '#0f172a' },
      950: { $value: '#020617' },
    },
    surface: { $value: '{color.neutral.0}', $description: 'Default page background.' },
    'surface-muted': {
      $value: '{color.neutral.50}',
      $description: 'Alternate section background.',
    },
    'surface-inverse': { $value: '{color.neutral.950}', $description: 'Dark section background.' },
    'on-surface': { $value: '{color.neutral.900}', $description: 'Text on surface.' },
    'on-surface-muted': {
      $value: '{color.neutral.600}',
      $description: 'Secondary text on surface.',
    },
    'on-inverse': { $value: '{color.neutral.50}', $description: 'Text on surface-inverse.' },
    accent: { $value: '{color.brand.600}', $description: 'Primary actions and highlights.' },
    'accent-hover': { $value: '{color.brand.700}' },
    'accent-subtle': {
      $value: '{color.brand.50}',
      $description: 'Tinted backgrounds, icon chips.',
    },
    'on-accent': { $value: '{color.neutral.0}', $description: 'Text on accent.' },
    border: { $value: '{color.neutral.200}' },
  },
  space: {
    $type: 'dimension',
    '2xs': { $value: rem(0.25) },
    xs: { $value: rem(0.5) },
    sm: { $value: rem(0.75) },
    md: { $value: rem(1) },
    lg: { $value: rem(1.5) },
    xl: { $value: rem(2) },
    '2xl': { $value: rem(3) },
    '3xl': { $value: rem(4) },
    '4xl': { $value: rem(6) },
  },
  size: {
    $type: 'dimension',
    content: { $value: rem(72), $description: 'Maximum content width.' },
    prose: { $value: rem(42), $description: 'Comfortable reading width.' },
  },
  text: {
    $type: 'dimension',
    xs: { $value: rem(0.75) },
    sm: { $value: rem(0.875) },
    md: { $value: rem(1) },
    lg: { $value: rem(1.125) },
    xl: { $value: rem(1.25) },
    '2xl': { $value: rem(1.5) },
    '3xl': { $value: rem(1.875) },
    '4xl': { $value: rem(2.25) },
    '5xl': { $value: rem(3) },
    '6xl': { $value: rem(3.75) },
  },
  font: {
    $type: 'fontFamily',
    body: {
      $value: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
    },
    heading: { $value: '{font.body}' },
    mono: { $value: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
  },
  weight: {
    $type: 'fontWeight',
    regular: { $value: 400 },
    medium: { $value: 500 },
    semibold: { $value: 600 },
    bold: { $value: 700 },
  },
  leading: {
    $type: 'number',
    tight: { $value: 1.15 },
    snug: { $value: 1.35 },
    normal: { $value: 1.6 },
  },
  radius: {
    $type: 'dimension',
    sm: { $value: px(6) },
    md: { $value: px(10) },
    lg: { $value: px(16) },
    full: { $value: px(9999) },
  },
  shadow: {
    $type: 'shadow',
    sm: {
      $value: { color: '#0f172a14', offsetX: px(0), offsetY: px(1), blur: px(2), spread: px(0) },
    },
    lg: {
      $value: { color: '#0f172a1f', offsetX: px(0), offsetY: px(12), blur: px(32), spread: px(-8) },
    },
  },
};

/**
 * A dark theme: alternate values for the semantic colour tokens. The accent is a lighter step with
 * dark text on it, so buttons and accent text keep WCAG AA contrast on dark surfaces.
 */
export const darkTheme: Record<string, string> = {
  'color.surface': '{color.neutral.950}',
  'color.surface-muted': '{color.neutral.900}',
  'color.surface-inverse': '{color.neutral.900}',
  'color.on-surface': '{color.neutral.50}',
  'color.on-surface-muted': '{color.neutral.400}',
  'color.on-inverse': '{color.neutral.50}',
  'color.accent': '{color.brand.400}',
  'color.accent-hover': '{color.brand.300}',
  'color.on-accent': '{color.neutral.950}',
  'color.accent-subtle': '{color.neutral.800}',
  'color.border': '{color.neutral.800}',
};
