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
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** True for the interaction states node styles support (own keys only). */
export function isStyleState(state: string): boolean {
  return Object.hasOwn(STATE_PSEUDO, state);
}

/**
 * Why a CSS value can't be embedded safely in a stylesheet, or undefined if it can: no braces,
 * semicolons, angle brackets, backslashes, comments, at-rules, control characters or
 * `!important`, and parentheses, brackets and quotes must be balanced.
 */
export function cssValueSyntaxError(value: string): string | undefined {
  if (CONTROL_RE.test(value)) return 'contains line breaks or control characters';
  if (UNSAFE_RE.test(value)) {
    return "contains characters or syntax that aren't allowed ({ } < > ; \\ @, comments, !important, javascript:)";
  }
  const stack: string[] = [];
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') stack.push(ch);
    else if (ch === ')' || ch === ']') {
      const open = stack.pop();
      if ((ch === ')' && open !== '(') || (ch === ']' && open !== '['))
        return `has an unmatched "${ch}"`;
    }
  }
  if (quote) return 'has an unclosed quote';
  if (stack.length) return `has an unclosed "${stack.at(-1)}"`;
  return undefined;
}

/** Problem with a CSS property name used in node styles, if any. */
export function checkProperty(prop: string): Issue | undefined {
  if (prop.startsWith('--')) {
    return {
      code: 'invalid_style',
      message: `Custom property "${prop}" can't be set with style.set.`,
      path: prop,
      hint: 'Use the vars.set op to set CSS variables on a node.',
    };
  }
  if (!PROP_RE.test(prop)) {
    return {
      code: 'invalid_style',
      message: `"${prop}" is not a valid CSS property name.`,
      path: prop,
    };
  }
  return undefined;
}
const VAR_REF_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const LENGTH_RE =
  /(?:^|[\s(,/+*-])(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px|rem|em|ex|ch|cap|lh|rlh|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|pt|pc|cm|mm|q|in))\b/i;
const COLOR_FN_RE = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i;
const HEX_RE = /#[0-9a-f]{3,8}\b/i;
const URL_RE = /\burl\s*\(/i;
const STRING_RE = /["']/;
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown ' +
    'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan ' +
    'darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid ' +
    'darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet ' +
    'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ' +
    'ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow ' +
    'lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine ' +
    'mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise ' +
    'mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab ' +
    'orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru ' +
    'pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan ' +
    'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
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
    const propIssue = checkProperty(prop);
    if (propIssue) {
      issues.push(propIssue);
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
  /** Final values of token variables, used to suggest the closest token for a raw value. */
  tokenValues?: ReadonlyMap<string, string>;
}

function toPx(value: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'px' ? n : n * 16;
}

function hexToRgb(value: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return undefined;
  let hex = m[1]!;
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Tokens whose value is closest to a raw length or hex colour, e.g. 24px → var(--space-lg). */
export function closestTokens(
  prop: string,
  raw: string,
  ctx: StyleCheckContext,
  limit = 3,
): string[] {
  if (!ctx.tokenValues) return [];
  const px = toPx(raw);
  const rgb = px === undefined ? hexToRgb(raw) : undefined;
  if (px === undefined && !rgb) return [];
  const family =
    FAMILY_BY_PROP.find(([re]) => re.test(prop))?.[1] ?? (rgb ? '--color-' : undefined);
  const scored: { name: string; value: string; d: number }[] = [];
  for (const [name, value] of ctx.tokenValues) {
    if (family && !name.startsWith(family)) continue;
    if (px !== undefined) {
      const v = toPx(value);
      if (v !== undefined) scored.push({ name, value, d: Math.abs(v - px) });
    } else if (rgb) {
      const v = hexToRgb(value);
      if (v)
        scored.push({ name, value, d: Math.hypot(v[0] - rgb[0], v[1] - rgb[1], v[2] - rgb[2]) });
    }
  }
  return scored
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((s) => `var(${s.name}) = ${s.value}`);
}

/** Validates one CSS value. `prop` is a CSS property or a custom property name. */
export function checkValue(prop: string, value: string, ctx: StyleCheckContext): Issue[] {
  const issues: Issue[] = [];
  if (value.length > 500) {
    return [{ code: 'invalid_style', message: `Value for "${prop}" is too long.`, path: prop }];
  }
  const syntax = cssValueSyntaxError(value);
  if (syntax) {
    return [
      { code: 'invalid_style', message: `Value for "${prop}" ${syntax}: "${value}".`, path: prop },
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
      const nearest = closestTokens(prop, raw, ctx);
      const examples = tokensForProperty(prop, ctx.vars, 4).map((v) => `var(${v})`);
      issues.push({
        code: 'raw_value',
        message: `"${prop}: ${value}" uses the raw value ${raw}; this site only allows design tokens.`,
        path: prop,
        hint: nearest.length
          ? `Closest tokens: ${nearest.join(', ')}.`
          : examples.length
            ? `Use a token instead, e.g. ${examples.join(', ')}.`
            : 'Use a design token, e.g. var(--space-md), instead of a raw value.',
      });
    }
  }
  return issues;
}
