import { type NodeInput, RICH_TEXT_TAGS, sanitizeRichText, sanitizeUrl } from '@bowerbirdjs/core';
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
  summary: 'summary',
  legend: 'p',
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
  'picture',
]);

/** `<input type>` values a field can be; anything else is imported as a text field (or skipped). */
const INPUT_TYPES: Record<string, string> = {
  text: 'text',
  search: 'text',
  email: 'email',
  tel: 'tel',
  url: 'url',
  number: 'number',
  date: 'date',
  time: 'time',
  checkbox: 'checkbox',
  radio: 'radio',
  hidden: 'hidden',
};
/** Inputs that are buttons. */
const INPUT_BUTTONS = new Set(['submit', 'button', 'reset', 'image']);
/** Files and secrets: not what a page's form should collect. */
const INPUT_SKIPPED = new Set(['file', 'password']);
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.[\]-]*$/;
const MAX_DEPTH = 30;
/** Controls whose inner text (a select's options, a textarea's preset) isn't part of a label. */
/** Elements that become a field, a button or an accordion item wherever they sit. */
const CONTROLS: ReadonlySet<string> = new Set([
  'input',
  'select',
  'textarea',
  'button',
  'label',
  'details',
  'form',
]);
const CONTROL_TEXT: ReadonlySet<string> = new Set(['select', 'textarea']);

const collapse = (s: string) => s.replace(/\s+/g, ' ');

/** Text content, skipping scripts, styles and other dropped elements. Iterative, so deep markup is safe. */
function textExcept(node: ChildNode, except?: ReadonlySet<string>): string {
  let out = '';
  const stack: ChildNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (isText(n)) out += n.data;
    else if (isTag(n)) {
      const name = n.name.toLowerCase();
      if (name === 'br') out += ' ';
      else if (!SKIP.has(name) && !except?.has(name))
        for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
    }
  }
  return out;
}

const textOf = (node: ChildNode): string => textExcept(node);

/** Formatting rich text keeps (other inline tags, like <span>, are unwrapped). */
const RICH = new Set<string>(RICH_TEXT_TAGS);
/** Tags a rich-text node can render as. */
const RICH_BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'figcaption']);
/** Rich text longer than this (as HTML) is imported as plain text. */
const RICH_MAX = 20_000;

const escapeText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Whether inline content has formatting or links that rich text can keep. */
function hasFormatting(nodes: ChildNode[]): boolean {
  const stack = [...nodes];
  while (stack.length) {
    const n = stack.pop()!;
    if (!isTag(n)) continue;
    const name = n.name.toLowerCase();
    if (name !== 'br' && RICH.has(name)) return true;
    if (!SKIP.has(name)) stack.push(...n.children);
  }
  return false;
}

/**
 * Inline content as rich-text HTML: kept tags are written out (links with their href only),
 * others unwrapped, dropped elements skipped. Iterative, so deep markup is safe. The result still
 * goes through `sanitizeRichText`.
 */
function inlineHtml(nodes: ChildNode[], safeHref: (url: string) => string): string {
  let out = '';
  const stack: (ChildNode | string)[] = [...nodes].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (typeof n === 'string') out += n;
    else if (isText(n)) out += escapeText(n.data.replace(/\s+/g, ' '));
    else if (isTag(n)) {
      const name = n.name.toLowerCase();
      if (SKIP.has(name)) continue;
      if (name === 'br') {
        out += '<br>';
        continue;
      }
      const keep = RICH.has(name);
      if (keep) {
        const href = name === 'a' ? safeHref(n.attribs.href ?? '#') : '';
        out += name === 'a' ? `<a href="${href.replace(/"/g, '&quot;')}">` : `<${name}>`;
        stack.push(`</${name}>`);
      }
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
    }
  }
  return out.trim();
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
    const max = (Object.hasOwn(MAX_TEXT, type) ? MAX_TEXT[type] : undefined) ?? 5000;
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

  /** Running text: rich text when it has emphasis or links (and the tag allows), else plain text. */
  const inlineNode = (nodes: ChildNode[], tag: string, el?: Element): NodeInput | undefined => {
    if (RICH_BLOCK_TAGS.has(tag) && hasFormatting(nodes)) {
      const html = sanitizeRichText(inlineHtml(nodes, (url) => safeUrl(url, 'href')));
      if (html && html.length <= RICH_MAX) {
        count++;
        return { type: 'rich-text', props: { tag, html }, ...(el ? common(el) : {}) };
      }
    }
    if (hasFormatting(nodes))
      warnings.add(
        "Some formatted text was imported as plain text (it was too long, or in an element rich text can't render, like <label>).",
      );
    return textNode(nodes.map(textOf).join(''), tag, el);
  };

  // Filled in by `scanForms` before anything is converted: labels and legends that name a control
  // become that field's label instead of text of their own, wherever they sit in the markup.
  /** `<label for>` texts, by the id of the control they point at. */
  const labelsFor = new Map<string, string>();
  /** Labels and legends that became a field's label. */
  const usedLabels = new WeakSet<Element>();
  /** Radios and same-named checkboxes that are one question: every control → its group. */
  const groups = new Map<Element, { controls: Element[]; legend: string }>();
  /** Groups already imported (one field per group). */
  const doneGroups = new Set<object>();

  const elementsIn = (root: { children: ChildNode[] }, names: string[]): Element[] => {
    const out: Element[] = [];
    const stack: ChildNode[] = [...root.children].reverse();
    while (stack.length) {
      const n = stack.pop()!;
      if (!isTag(n)) continue;
      if (names.includes(n.name.toLowerCase())) out.push(n);
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
    }
    return out;
  };
  const ancestor = (el: Element, name: string): Element | undefined => {
    for (let p = el.parent; p && isTag(p); p = p.parent) if (p.name === name) return p;
    return undefined;
  };
  /** Elements with a form control or button somewhere inside: never just text. */
  const holders = new WeakSet<Element>();
  /** The nearest form at or above each element, remembered so deep markup is walked once. */
  const formMemo = new WeakMap<Element, Element | null>();
  const formOf = (el: Element): Element | undefined => {
    const path: Element[] = [];
    let found: Element | null = null;
    for (let p = el.parent; p && isTag(p); p = p.parent) {
      const memo = formMemo.get(p);
      if (memo !== undefined) {
        found = memo;
        break;
      }
      path.push(p);
      if (p.name === 'form') {
        found = p;
        break;
      }
    }
    // Everything below the form found (or below the top) shares the answer.
    for (const p of path) formMemo.set(p, found);
    return found ?? undefined;
  };
  const inputType = (el: Element) => (el.attribs.type ?? 'text').toLowerCase();

  /** Reads which labels name which controls, and which radios or checkboxes are one question. */
  const scanForms = (root: { children: ChildNode[] }): void => {
    const controls = elementsIn(root, ['input', 'select', 'textarea']);
    for (const el of [...controls, ...elementsIn(root, ['button', 'details', 'form'])]) {
      for (let p = el.parent; p && isTag(p) && !holders.has(p); p = p.parent) holders.add(p);
    }
    const ids = new Set(controls.map((c) => c.attribs.id).filter(Boolean));
    for (const label of elementsIn(root, ['label'])) {
      const target = label.attribs.for;
      if (!target || !ids.has(target) || labelsFor.has(target)) continue;
      labelsFor.set(target, collapse(textOf(label)).trim());
      usedLabels.add(label);
    }
    // Radios or checkboxes that share a name in a form are one question.
    const byKey = new Map<string, Element[]>();
    const forms = new Map<Element | undefined, number>();
    for (const control of controls) {
      const type = control.name === 'input' ? inputType(control) : '';
      const name = control.attribs.name ?? '';
      if ((type !== 'radio' && type !== 'checkbox') || !name) continue;
      const form = formOf(control);
      if (!forms.has(form)) forms.set(form, forms.size);
      const key = `${forms.get(form)}:${type}:${name}`;
      const list = byKey.get(key);
      if (list) list.push(control);
      else byKey.set(key, [control]);
    }
    for (const members of byKey.values()) {
      const memberSet = new Set(members);
      // One on its own is a yes-or-no question, not a group.
      if (members.length < 2) continue;
      // The question is the legend of a fieldset that holds this group and nothing else.
      const fieldset = ancestor(members[0]!, 'fieldset');
      const alone =
        fieldset &&
        elementsIn(fieldset, ['input', 'select', 'textarea']).every((c) => memberSet.has(c));
      const legend = alone
        ? fieldset.children.find((c): c is Element => isTag(c) && c.name === 'legend')
        : undefined;
      if (legend) usedLabels.add(legend);
      const group = { controls: members, legend: legend ? collapse(textOf(legend)).trim() : '' };
      for (const member of members) groups.set(member, group);
    }
  };

  /** The label of a control: a `<label>` around it or pointing at it, else its ARIA label. */
  const labelOf = (control: Element): string => {
    const around = ancestor(control, 'label');
    if (around) {
      // The label's own words, without those of the control inside it (a select's options).
      const own = around.children
        .filter((c) => c !== control)
        .map((c) => textExcept(c, CONTROL_TEXT))
        .join(' ');
      return collapse(own).trim();
    }
    const id = control.attribs.id;
    const pointed = id ? labelsFor.get(id) : undefined;
    return pointed ?? collapse(control.attribs['aria-label'] ?? '').trim();
  };

  /** A form control as a field node (label and control in one), or nothing if it isn't one. */
  const fieldNode = (control: Element): NodeInput | undefined => {
    const tag = control.name.toLowerCase();
    const raw = inputType(control);
    if (tag === 'input' && INPUT_BUTTONS.has(raw)) {
      count++;
      // A picture that sends the form becomes an ordinary submit button with its words.
      const words = raw === 'image' ? control.attribs.alt : control.attribs.value;
      const text = clip(words || (raw === 'reset' ? 'Reset' : 'Submit'), 'button') || 'Submit';
      const kind = raw === 'image' ? 'submit' : raw;
      return { type: 'button', props: { text, ...(kind === 'button' ? {} : { type: kind }) } };
    }
    if (tag === 'input' && INPUT_SKIPPED.has(raw)) {
      warnings.add(
        `<input type="${raw}"> fields were skipped: forms here can't collect files or passwords.`,
      );
      return undefined;
    }
    const group = groups.get(control);
    if (group) {
      if (doneGroups.has(group)) return undefined;
      doneGroups.add(group);
    }
    const type =
      tag === 'input' ? (Object.hasOwn(INPUT_TYPES, raw) ? INPUT_TYPES[raw]! : 'text') : tag;
    const name = control.attribs.name?.trim() ?? '';
    const props: Record<string, unknown> = {
      type,
      name: FIELD_NAME.test(name) && name.length <= 64 ? name : `field-${count + 1}`,
      label: (group ? group.legend : labelOf(control)).slice(0, 200),
    };
    if (name && props.name !== name)
      warnings.add("Some field names had characters a field name can't hold and were replaced.");
    const placeholder = collapse(control.attribs.placeholder ?? '').trim();
    if (placeholder && type !== 'checkbox' && type !== 'radio' && type !== 'hidden')
      props.placeholder = placeholder.slice(0, 200);
    if (
      (group?.controls ?? [control]).some((c) => 'required' in c.attribs) &&
      !(group && type === 'checkbox')
    )
      props.required = true;
    if (group) {
      // Each control of the group is one choice, named by its own label (or its value).
      const options = group.controls
        .map((c) => (labelOf(c) || c.attribs.value || '').slice(0, 200))
        .filter(Boolean);
      if (!options.length) {
        warnings.add(
          'A group of radio buttons or checkboxes without labels or values was skipped.',
        );
        return undefined;
      }
      props.options = [...new Set(options)].slice(0, 100);
      const checked = group.controls.find((c) => 'checked' in c.attribs);
      if (checked && type === 'radio') props.value = labelOf(checked) || checked.attribs.value;
    } else if (type === 'radio') {
      // A lone radio is a yes-or-no question: a checkbox says that better.
      props.type = 'checkbox';
    } else if (type === 'select') {
      const all = elementsIn(control, ['option']);
      const options = all
        .filter((o) => o.attribs.value !== '')
        .map((o) => collapse(textOf(o)).trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 100);
      // A select without choices can't be one; keep the question as a text field.
      if (options.length) props.options = [...new Set(options)];
      else props.type = 'text';
      const prompt = all.find((o) => o.attribs.value === '');
      if (prompt && options.length)
        props.placeholder = collapse(textOf(prompt)).trim().slice(0, 200) || undefined;
      const chosen = all.find((o) => 'selected' in o.attribs && o.attribs.value !== '');
      const preset = chosen ? collapse(textOf(chosen)).trim().slice(0, 200) : '';
      if (preset && options.includes(preset)) props.value = preset;
    } else if (type === 'textarea') {
      const preset = textOf(control).replace(/^\n/, '');
      if (preset.trim() && preset.length <= 2000) props.value = preset;
    } else if (type === 'hidden' || control.attribs.value) {
      const value = control.attribs.value ?? '';
      if (value.length <= 2000) props.value = value;
    }
    if (type === 'checkbox' && !group && 'checked' in control.attribs)
      warnings.add('Checkboxes that were ticked in the HTML start unticked here.');
    if (type === 'textarea') {
      const rows = Number(control.attribs.rows);
      if (Number.isInteger(rows) && rows >= 2 && rows <= 20) props.rows = rows;
    }
    if (props.placeholder === undefined) delete props.placeholder;
    if (!props.label && props.type !== 'hidden')
      warnings.add(
        'Some form fields had no label; give each a "label" so people know what to enter.',
      );
    count++;
    return { type: 'field', props };
  };

  const children = (parent: Element, depth: number, looseTag = 'p'): NodeInput[] => {
    const out: NodeInput[] = [];
    let run: ChildNode[] = [];
    const flush = () => {
      if (!run.length) return;
      const node = inlineNode(run, looseTag);
      if (node) out.push(node);
      run = [];
    };
    for (const child of parent.children) {
      if (count >= maxNodes) {
        warnings.add(`Stopped after ${maxNodes} nodes; the rest of the HTML was not imported.`);
        break;
      }
      const blockLink = isTag(child) && child.name === 'a';
      const control = isTag(child) && (holders.has(child) || CONTROLS.has(child.name));
      if (isInline(child) && !blockLink && !control) {
        run.push(child);
        continue;
      }
      // A text-only link mixed into running text stays in that text (as rich text); a link on its
      // own, or one that wraps an image or other blocks, becomes a real link node.
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

    if (tag === 'form') {
      count++;
      const { action = '', method = '' } = node.attribs;
      const props: Record<string, unknown> = {};
      const safe = action.trim() ? safeUrl(action, 'href') : '';
      if (safe && safe !== '#') props.action = safe;
      if (method.toLowerCase() === 'get') props.method = 'get';
      // (A form inside a form never gets here: like browsers, the parser ignores its start tag.)
      return [{ type: 'form', props, children: children(node, depth), ...common(node) }];
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const fieldInput = fieldNode(node);
      return fieldInput ? [fieldInput] : [];
    }
    // A label around a control is that field; one naming a control elsewhere became its label.
    if (tag === 'label') {
      const controls = elementsIn(node, ['input', 'select', 'textarea']);
      if (controls.length) return controls.flatMap((c) => convert(c, depth + 1));
      if (usedLabels.has(node)) return [];
    }
    if (tag === 'legend' && usedLabels.has(node)) return [];
    if (tag === 'fieldset') {
      // A fieldset that is one question (a radio group) is that field; otherwise a box.
      const inner = children(node, depth);
      if (inner.length === 1 && inner[0]!.type === 'field') return inner;
      count++;
      return [{ type: 'box', props: {}, children: inner, ...common(node) }];
    }
    if (tag === 'details') {
      count++;
      const summary = node.children.find((c): c is Element => isTag(c) && c.name === 'summary');
      const rest = { ...node, children: node.children.filter((c) => c !== summary) } as Element;
      const head = summary ? textNode(textOf(summary), 'summary', summary) : undefined;
      return [
        {
          type: 'details',
          props: 'open' in node.attribs ? { open: true } : {},
          children: [...(head ? [head] : []), ...children(rest, depth)],
          ...common(node),
        },
      ];
    }

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
      // Links can't hold links or buttons: keep their text instead.
      const flatten = (n: NodeInput): NodeInput[] => {
        if (n.type === 'link' || n.type === 'button' || n.type === 'field') {
          warnings.add('Links, buttons and form fields inside a link were kept as text.');
          const words = n.type === 'field' ? n.props?.label : n.props?.text;
          const text = typeof words === 'string' ? words : '';
          return text ? [{ type: 'text', props: { tag: 'span', text } }] : [];
        }
        const inner = (n.children ?? []).flatMap(flatten);
        if (n.type === 'form' || n.type === 'details') {
          warnings.add('Forms and accordion items inside a link were kept as plain blocks.');
          return [{ type: 'box', props: {}, children: inner }];
        }
        // A summary only works in an accordion item.
        if (n.type === 'text' && n.props?.tag === 'summary')
          return [{ ...n, props: { ...n.props, tag: 'p' } }];
        return [n.children ? { ...n, children: inner } : n];
      };
      return [
        {
          type: 'link',
          props,
          children: children(node, depth).flatMap(flatten),
          ...common(node),
        },
      ];
    }
    if (tag === 'button') {
      count++;
      // A button in a form sends it unless it says otherwise.
      const kind = (node.attribs.type ?? (formOf(node) ? 'submit' : 'button')).toLowerCase();
      return [
        {
          type: 'button',
          props: {
            text: clip(textOf(node), 'button'),
            ...(kind === 'submit' || kind === 'reset' ? { type: kind } : {}),
          },
          ...common(node),
        },
      ];
    }
    // An element with a field or button inside is a container, whatever its tag says.
    const holds = holders.has(node);
    const textTag = !holds && Object.hasOwn(TEXT_TAGS, tag) ? TEXT_TAGS[tag] : undefined;
    if (textTag) {
      // <strong>, <em>… on their own are text in that tag; inside a paragraph they are formatting.
      const t = RICH.has(tag)
        ? textNode(textOf(node), textTag, node)
        : inlineNode(node.children, textTag, node);
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
    if (tag === 'li' && !holds && node.children.every(isInline)) {
      const t = inlineNode(node.children, 'li', node);
      return t ? [t] : [];
    }
    let boxTag = tag;
    if (!BOX_TAGS.has(tag)) {
      if (tag !== 'body' && tag !== 'html' && !holds)
        warnings.add(`<${tag}> was converted to a <div>.`);
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
  scanForms(doc);
  const nodes: NodeInput[] = [];
  for (const child of doc.children) nodes.push(...convert(child, 0));
  return { nodes, warnings: [...warnings] };
}
