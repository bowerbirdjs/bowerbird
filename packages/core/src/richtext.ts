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

/** The `href` of an `<a …>` tag, if any. */
function hrefOf(attrs: string): string | undefined {
  const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attrs);
  const raw = m ? (m[1] ?? m[2] ?? m[3] ?? '') : undefined;
  return raw === undefined ? undefined : decode(raw);
}

/** Returns sanitized, well-formed inline HTML for the rich-text subset. */
export function sanitizeRichText(input: string): string {
  const out: string[] = [];
  const open: string[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
  let last = 0;
  const text = (s: string) => {
    if (s) out.push(escapeText(decode(s)));
  };
  for (let m = tag.exec(input); m; m = tag.exec(input)) {
    text(input.slice(last, m.index));
    last = tag.lastIndex;
    const closing = m[1] === '/';
    const name = m[2]!.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (name === 'br') {
      if (!closing) out.push('<br>');
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
    if (name === 'a') {
      if (open.includes('a')) continue;
      const href = sanitizeUrl(hrefOf(m[3] ?? '') ?? '#', 'href');
      out.push(`<a href="${escapeAttr(href)}">`);
    } else out.push(`<${name}>`);
    open.push(name);
  }
  text(input.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}

/** Plain text of rich text (for outlines, lint and search). */
export function richTextToPlain(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}
