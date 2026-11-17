import { didYouMean, type Issue } from './errors.js';

/** Interaction states a node style can target, mapped to their CSS pseudo-class. */
export const STATE_PSEUDO: Record<string, string> = {
  default: '',
  hover: ':hover',
  focus: ':focus',
  'focus-visible': ':focus-visible',
  'focus-within': ':focus-within',
  active: ':active',
  disabled: ':disabled',
};

/** Variables provided by Bowerbird itself; always valid in style values. */
export const BUILTIN_VARS = ['--bb-viewport-height'] as const;

const PROP_RE = /^-?[a-z][a-z0-9-]*$/;
const UNSAFE_RE = /[{}<>\\;]|\/\*|\*\/|@|expression\s*\(|javascript:|!important/i;
const VAR_REF_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const LENGTH_RE =
  /(?:^|[\s(,/+*-])(-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|ex|ch|cap|lh|rlh|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|cm|mm|q|in))\b/i;
const COLOR_FN_RE = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i;
const HEX_RE = /#[0-9a-f]{3,8}\b/i;
const URL_RE = /\burl\s*\(/i;
const STRING_RE = /["']/;
const NAMED_COLORS = new Set(
  (
    'aqua azure beige black blue brown chartreuse chocolate coral crimson cyan fuchsia gold gray green ' +
    'grey indigo ivory khaki lavender lime magenta maroon navy olive orange orchid pink plum purple red ' +
    'salmon silver tan teal tomato turquoise violet white yellow'
  ).split(' '),
);
const STRING_PROPS = new Set([
  'content',
  'quotes',
  'grid-template-areas',
  'grid-area',
  'font-feature-settings',
]);

/** Splits a declaration list on `;`, ignoring semicolons inside parentheses or quotes. */
export function splitDeclarations(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseDeclarations(css: string): { decls: [string, string][]; issues: Issue[] } {
  const decls: [string, string][] = [];
  const issues: Issue[] = [];
  for (const piece of splitDeclarations(css)) {
    const colon = piece.indexOf(':');
    if (colon <= 0) {
      issues.push({
        code: 'invalid_style',
        message: `"${piece}" is not a CSS declaration.`,
        hint: 'Write declarations as "property: value; property: value".',
      });
      continue;
    }
    const prop = piece.slice(0, colon).trim().toLowerCase();
    const value = piece.slice(colon + 1).trim();
    if (prop.startsWith('--')) {
      issues.push({
        code: 'invalid_style',
        message: `Custom property "${prop}" can't be set with style.set.`,
        path: prop,
        hint: 'Use the vars.set op to set CSS variables on a node.',
      });
      continue;
    }
    if (!PROP_RE.test(prop)) {
      issues.push({
        code: 'invalid_style',
        message: `"${prop}" is not a valid CSS property name.`,
        path: prop,
      });
      continue;
    }
    if (!value) {
      issues.push({
        code: 'invalid_style',
        message: `Property "${prop}" has no value.`,
        path: prop,
      });
      continue;
    }
    decls.push([prop, value]);
  }
  return { decls, issues };
}

/** Returns the first fragment of `value` that is a raw (non-token) design value, if any. */
export function findRawValue(prop: string, value: string): string | undefined {
  const stripped = value
    .replace(/var\(\s*--[A-Za-z0-9_-]+\s*\)/g, ' ')
    .replace(/var\(\s*--[A-Za-z0-9_-]+\s*,/g, '(');
  const length = LENGTH_RE.exec(stripped);
  if (length) return length[1];
  const hex = HEX_RE.exec(stripped);
  if (hex) return hex[0];
  const fn = COLOR_FN_RE.exec(stripped);
  if (fn) return `${fn[1]}()`;
  if (URL_RE.test(stripped)) return 'url()';
  if (STRING_RE.test(stripped) && !STRING_PROPS.has(prop)) return 'a quoted string';
  for (const word of stripped.toLowerCase().split(/[\s,()/]+/)) {
    if (NAMED_COLORS.has(word)) return word;
  }
  return undefined;
}

const FAMILY_BY_PROP: [RegExp, string][] = [
  [
    /^(color|background(-color)?|border(-\w+)*-color|outline-color|fill|stroke|accent-color|caret-color|text-decoration-color|column-rule-color)$/,
    '--color-',
  ],
  [/^(margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)(-\w+)*$/, '--space-'],
  [/^font-size$/, '--text-'],
  [/^font-family$/, '--font-'],
  [/^font-weight$/, '--weight-'],
  [/^line-height$/, '--leading-'],
  [/^border(-\w+)*-radius$/, '--radius-'],
  [/^(box-shadow|text-shadow)$/, '--shadow-'],
  [/^(width|height|min-width|max-width|min-height|max-height|flex-basis)$/, '--size-'],
];

/** Token variables that fit a CSS property, for hints. */
export function tokensForProperty(prop: string, vars: Iterable<string>, limit = 6): string[] {
  const family = FAMILY_BY_PROP.find(([re]) => re.test(prop))?.[1];
  if (!family) return [];
  return [...vars].filter((v) => v.startsWith(family)).slice(0, limit);
}

export interface StyleCheckContext {
  /** All CSS variables that may be referenced (tokens, section variables, built-ins). */
  vars: ReadonlySet<string>;
  /** Whether raw values (px, hex colours, …) are allowed by policy. */
  allowRaw: boolean;
}

/** Validates one CSS value. `prop` is a CSS property or a custom property name. */
export function checkValue(prop: string, value: string, ctx: StyleCheckContext): Issue[] {
  const issues: Issue[] = [];
  if (value.length > 500) {
    return [{ code: 'invalid_style', message: `Value for "${prop}" is too long.`, path: prop }];
  }
  if (UNSAFE_RE.test(value)) {
    return [
      {
        code: 'invalid_style',
        message: `Value for "${prop}" contains characters or syntax that aren't allowed: "${value}".`,
        path: prop,
        hint: 'Values may not contain { } < > ; \\ @, comments, !important or javascript:.',
      },
    ];
  }
  for (const match of value.matchAll(VAR_REF_RE)) {
    const name = match[1]!;
    if (!ctx.vars.has(name)) {
      issues.push({
        code: 'unknown_token',
        message: `"${name}" is not a design token or variable available here.${didYouMean(name, ctx.vars)}`,
        path: prop,
        hint: 'Call list_tokens to see the available tokens.',
      });
    }
  }
  if (!ctx.allowRaw) {
    const raw = findRawValue(prop, value);
    if (raw) {
      const examples = tokensForProperty(prop, ctx.vars, 4).map((v) => `var(${v})`);
      issues.push({
        code: 'raw_value',
        message: `"${prop}: ${value}" uses the raw value ${raw}; this site only allows design tokens.`,
        path: prop,
        hint: examples.length
          ? `Use a token instead, e.g. ${examples.join(', ')}.`
          : 'Use a design token, e.g. var(--space-md), instead of a raw value.',
      });
    }
  }
  return issues;
}
