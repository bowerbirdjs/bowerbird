import { type NodeInput, sanitizeUrl } from '@bowerbirdjs/core';
import { type ChildNode, type Element, isTag, isText } from 'domhandler';
import { parseDocument } from 'htmlparser2';

export interface HtmlImportOptions {
  /** Keep `style` attributes as node CSS (validated against tokens when applied). Default true. */
  keepStyles?: boolean;
  /** Stop after this many nodes. Default 400. */
  maxNodes?: number;
}

export interface HtmlImportResult {
  nodes: NodeInput[];
  /** What was dropped or simplified, phrased for the person or agent who wrote the HTML. */
  warnings: string[];
}

const BOX_TAGS = new Set([
  'div',
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'article',
  'aside',
  'ul',
  'ol',
  'li',
  'figure',
  'blockquote',
  'address',
]);
const TEXT_TAGS: Record<string, string> = {
  p: 'p',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  span: 'span',
  small: 'small',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  figcaption: 'figcaption',
  cite: 'cite',
  label: 'label',
};
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'br',
  'cite',
  'code',
  'em',
  'i',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
]);
const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'head',
  'title',
  'svg',
  'canvas',
  'video',
  'audio',
  'form',
  'input',
  'select',
  'textarea',
  'picture',
]);
const MAX_DEPTH = 30;

const collapse = (s: string) => s.replace(/\s+/g, ' ');

/** Text content, skipping scripts, styles and other dropped elements. Iterative, so deep markup is safe. */
function textOf(node: ChildNode): string {
  let out = '';
  const stack: ChildNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (isText(n)) out += n.data;
    else if (isTag(n)) {
      const name = n.name.toLowerCase();
      if (name === 'br') out += ' ';
      else if (!SKIP.has(name))
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
    }
  }
  return out;
}

/** Text limits of the primitives, so an import never fails on one long paragraph. */
const MAX_TEXT: Record<string, number> = { text: 5000, link: 500, button: 200 };

const isInline = (node: ChildNode) =>
  isText(node) || (isTag(node) && INLINE.has(node.name.toLowerCase()));
const hasBlockContent = (el: Element) =>
  el.children.some((c) => isTag(c) && !INLINE.has(c.name.toLowerCase()));

/** Converts an HTML fragment into node inputs for `node.insert`. Works without a DOM. */
export function htmlToNodes(html: string, options: HtmlImportOptions = {}): HtmlImportResult {
  const keepStyles = options.keepStyles ?? true;
  const maxNodes = options.maxNodes ?? 400;
  const warnings = new Set<string>();
  let count = 0;

  const common = (el: Element): Pick<NodeInput, 'css'> => {
    if (el.attribs.class)
      warnings.add('class attributes were ignored; use style="…" with design tokens instead.');
    const style = el.attribs.style?.trim();
    return keepStyles && style ? { css: style } : {};
  };

  const clip = (text: string, type: string): string => {
    const t = collapse(text).trim();
    const max = MAX_TEXT[type] ?? 5000;
    if (t.length <= max) return t;
    warnings.add(`Some text was longer than ${max} characters and was shortened.`);
    return `${t.slice(0, max - 1)}…`;
  };

  const safeUrl = (url: string, kind: 'href' | 'src'): string => {
    const clean = sanitizeUrl(url, kind);
    if (clean !== url.trim())
      warnings.add(`Unsafe ${kind} values (for example javascript: URLs) were removed.`);
    return clean.length > (kind === 'href' ? 2048 : 100_000) ? (kind === 'href' ? '#' : '') : clean;
  };

  const textNode = (text: string, tag: string, el?: Element): NodeInput | undefined => {
    const t = clip(text, 'text');
    if (!t) return undefined;
    count++;
    return { type: 'text', props: { tag, text: t }, ...(el ? common(el) : {}) };
  };

  const children = (parent: Element, depth: number, looseTag = 'p'): NodeInput[] => {
    const out: NodeInput[] = [];
    let run: ChildNode[] = [];
    const flush = () => {
      if (!run.length) return;
      if (run.some((n) => isTag(n) && n.name === 'a')) {
        warnings.add(
          'Links inside running text were flattened to plain text (rich text is not supported yet).',
        );
      }
      const node = textNode(run.map(textOf).join(''), looseTag);
      if (node) out.push(node);
      run = [];
    };
    for (const child of parent.children) {
      if (count >= maxNodes) {
        warnings.add(`Stopped after ${maxNodes} nodes; the rest of the HTML was not imported.`);
        break;
      }
      const blockLink = isTag(child) && child.name === 'a';
      if (isInline(child) && !blockLink) {
        run.push(child);
        continue;
      }
      // A text-only link mixed into running text is flattened; a link on its own, or one that
      // wraps an image or other blocks, becomes a real link node.
      if (blockLink && !hasBlockContent(child) && run.some((n) => textOf(n).trim())) {
        run.push(child);
        continue;
      }
      flush();
      out.push(...convert(child, depth + 1));
    }
    flush();
    return out;
  };

  const convert = (node: ChildNode, depth: number): NodeInput[] => {
    if (count >= maxNodes) {
      warnings.add(`Stopped after ${maxNodes} nodes.`);
      return [];
    }
    if (depth > MAX_DEPTH) {
      warnings.add(`Content nested deeper than ${MAX_DEPTH} levels was dropped.`);
      return [];
    }
    if (isText(node)) {
      const t = textNode(node.data, 'p');
      return t ? [t] : [];
    }
    if (!isTag(node)) return [];
    const tag = node.name.toLowerCase();
    if (SKIP.has(tag)) {
      warnings.add(`<${tag}> elements were skipped.`);
      return [];
    }
    if (tag === 'br' || tag === 'hr') return [];

    if (tag === 'img') {
      count++;
      const { src = '', alt, width, height } = node.attribs;
      if (alt === undefined)
        warnings.add('Some images had no alt attribute; they were given empty alt text.');
      const size = (v: string | undefined) =>
        v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : undefined;
      const w = size(width);
      const h = size(height);
      return [
        {
          type: 'image',
          props: {
            src: safeUrl(src, 'src'),
            alt: collapse(alt ?? '')
              .trim()
              .slice(0, 500),
            ...(w ? { width: w } : {}),
            ...(h ? { height: h } : {}),
          },
          ...common(node),
        },
      ];
    }
    if (tag === 'a') {
      count++;
      const { href = '#', target } = node.attribs;
      const props: Record<string, unknown> = {
        href: safeUrl(href, 'href'),
        ...(target === '_blank' ? { target: '_blank' } : {}),
      };
      if (!hasBlockContent(node))
        return [
          {
            type: 'link',
            props: { ...props, text: clip(textOf(node), 'link') },
            ...common(node),
          },
        ];
      return [{ type: 'link', props, children: children(node, depth), ...common(node) }];
    }
    if (tag === 'button') {
      count++;
      return [{ type: 'button', props: { text: clip(textOf(node), 'button') }, ...common(node) }];
    }
    const textTag = TEXT_TAGS[tag];
    if (textTag) {
      if (node.children.some((c) => isTag(c) && c.name === 'a')) {
        warnings.add(
          'Links inside running text were flattened to plain text (rich text is not supported yet).',
        );
      }
      const t = textNode(textOf(node), textTag, node);
      return t ? [t] : [];
    }
    // A list item that only holds one link keeps the link (navigation lists).
    const meaningful = node.children.filter((c) => !(isText(c) && !c.data.trim()));
    const only = meaningful[0];
    if (tag === 'li' && meaningful.length === 1 && only && isTag(only) && only.name === 'a') {
      count++;
      return [
        { type: 'box', props: { tag: 'li' }, children: convert(only, depth + 1), ...common(node) },
      ];
    }
    if (tag === 'li' && node.children.every(isInline)) {
      if (node.children.some((c) => isTag(c) && c.name === 'a')) {
        warnings.add(
          'Links inside running text were flattened to plain text (rich text is not supported yet).',
        );
      }
      const t = textNode(textOf(node), 'li', node);
      return t ? [t] : [];
    }
    let boxTag = tag;
    if (!BOX_TAGS.has(tag)) {
      if (tag !== 'body' && tag !== 'html') warnings.add(`<${tag}> was converted to a <div>.`);
      boxTag = 'div';
      if (tag === 'body' || tag === 'html') return children(node, depth);
    }
    count++;
    return [
      { type: 'box', props: { tag: boxTag }, children: children(node, depth), ...common(node) },
    ];
  };

  if (html.length > 1_000_000) {
    return { nodes: [], warnings: ['The HTML is larger than 1 MB; split it into smaller parts.'] };
  }
  const doc = parseDocument(html, { lowerCaseTags: true, lowerCaseAttributeNames: true });
  const nodes: NodeInput[] = [];
  for (const child of doc.children) nodes.push(...convert(child, 0));
  return { nodes, warnings: [...warnings] };
}
