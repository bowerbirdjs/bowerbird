import { sanitizeUrl } from './url.js';

/**
 * Rich text is a small, safe subset of inline HTML: emphasis, links and line breaks. It is
 * sanitized when written and again when rendered (stored documents aren't re-validated), by
 * rebuilding well-formed markup from scratch: anything not on the list is kept as text.
 */
export const RICH_TEXT_TAGS = [
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'code',
  'mark',
  'sub',
  'sup',
  'small',
  'a',
  'br',
] as const;
const ALLOWED = new Set<string>(RICH_TEXT_TAGS);

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the entities people and agents commonly write (named basics and numeric). */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, '&quot;');

/** Block-level tags: dropped, but their boundaries become line breaks (e.g. pasted paragraphs). */
const BLOCKS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'nav',
  'main',
  'figure',
  'figcaption',
  'address',
  'table',
  'tr',
  'hr',
]);

interface Tag {
  name: string;
  closing: boolean;
  attrs: [string, string][];
  /** Index just after the tag's `>`. */
  end: number;
}

const isSpace = (c: string | undefined) =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isAlpha = (c: string | undefined) => !!c && /[a-zA-Z]/.test(c);
const isNameChar = (c: string | undefined) => !!c && /[a-zA-Z0-9]/.test(c);

/**
 * Reads the tag that starts at `input[at] === '<'` the way a browser's tokenizer does: attribute
 * values may be quoted or unquoted, and `>` inside quotes doesn't end the tag. Returns `null` when
 * the `<` doesn't start a tag (it's text), or `'eof'` when the tag never ends.
 */
function readTag(input: string, at: number): Tag | null | 'eof' {
  const n = input.length;
  let i = at + 1;
  const closing = input[i] === '/';
  if (closing) i++;
  if (!isAlpha(input[i])) return null;
  const nameStart = i;
  while (isNameChar(input[i])) i++;
  const name = input.slice(nameStart, i).toLowerCase();
  if (i < n && !isSpace(input[i]) && input[i] !== '/' && input[i] !== '>') return null;
  const attrs: [string, string][] = [];
  while (i < n) {
    while (i < n && (isSpace(input[i]) || input[i] === '/')) i++;
    if (i >= n) break;
    if (input[i] === '>') return { name, closing, attrs, end: i + 1 };
    const keyStart = i++;
    while (i < n && !isSpace(input[i]) && input[i] !== '/' && input[i] !== '>' && input[i] !== '=')
      i++;
    const key = input.slice(keyStart, i).toLowerCase();
    while (i < n && isSpace(input[i])) i++;
    let value = '';
    if (input[i] === '=') {
      i++;
      while (i < n && isSpace(input[i])) i++;
      const quote = input[i];
      if (quote === '"' || quote === "'") {
        const close = input.indexOf(quote, i + 1);
        if (close < 0) return 'eof';
        value = input.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isSpace(input[i]) && input[i] !== '>') i++;
        value = input.slice(valueStart, i);
      }
    }
    attrs.push([key, value]);
  }
  return 'eof';
}

/** Returns sanitized, well-formed inline HTML for the rich-text subset. Linear in the input. */
export function sanitizeRichText(input: string): string {
  const out: string[] = [];
  const open: string[] = [];
  // After a block boundary the next content starts on a new line (never at the very start).
  let pendingBreak = false;
  let hasContent = false;
  const flushBreak = () => {
    if (pendingBreak && hasContent) out.push('<br>');
    pendingBreak = false;
  };
  const text = (s: string) => {
    if (!s) return;
    if (/\S/.test(s)) flushBreak();
    else if (pendingBreak) return; // indentation between blocks
    out.push(escapeText(decode(s)));
    hasContent = true;
  };
  let last = 0;
  let i = input.indexOf('<');
  while (i >= 0) {
    const tag = readTag(input, i);
    if (tag === null) {
      i = input.indexOf('<', i + 1);
      continue;
    }
    // A tag that never ends: keep the rest as text (browsers drop it; either way it's inert).
    if (tag === 'eof') break;
    text(input.slice(last, i));
    last = tag.end;
    i = input.indexOf('<', last);
    const { name, closing } = tag;
    if (BLOCKS.has(name)) {
      pendingBreak = true;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (name === 'br') {
      if (!closing) {
        pendingBreak = false;
        out.push('<br>');
        hasContent = true;
      }
      continue;
    }
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at < 0) continue;
      // Close anything opened inside it, so the result is always well formed.
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (open.length >= 20) continue;
    flushBreak();
    if (name === 'a') {
      if (open.includes('a')) continue;
      // The first href attribute wins, as in browsers.
      const raw = tag.attrs.find(([k]) => k === 'href')?.[1];
      const href = sanitizeUrl(raw === undefined ? '#' : decode(raw), 'href');
      out.push(`<a href="${escapeAttr(href)}">`);
    } else out.push(`<${name}>`);
    open.push(name);
  }
  text(input.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** Drops the links from sanitized rich text, keeping their text (for rich text inside a link). */
export function stripRichTextLinks(html: string): string {
  return html.replace(/<a href="[^"]*">|<\/a>/g, '');
}

/** Plain text of rich text (for outlines, lint and search). */
export function richTextToPlain(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}
