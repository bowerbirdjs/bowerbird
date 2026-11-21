import { z } from 'zod';
import { didYouMean, listPreview } from './errors.js';
import { ICON_NAME } from './icons.js';
import type { ComponentDef, ElementSpec } from './registry.js';
import { RICH_TEXT_TAGS, sanitizeRichText } from './richtext.js';
import type { BNode } from './types.js';

const BOX_TAGS = [
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
] as const;

const TEXT_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'small',
  'strong',
  'em',
  'blockquote',
  'figcaption',
  'cite',
  'li',
  'label',
  'summary',
] as const;

const str = (s: unknown) => (typeof s === 'string' ? s : undefined);
/** A value from an allowed list (documents loaded from storage are not re-validated). */
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export const root: ComponentDef = {
  name: 'root',
  kind: 'primitive',
  description: 'The root of a page. Created with the page; cannot be inserted, moved or removed.',
  props: z.strictObject({}),
  children: true,
  insertable: false,
  render: () => ({ tag: 'div', attrs: { class: 'bb-page' } }),
};

export const box: ComponentDef = {
  name: 'box',
  kind: 'primitive',
  description: `Layout container. Props: tag (${BOX_TAGS.join('|')}), label (aria-label).`,
  props: z.strictObject({
    tag: z.enum(BOX_TAGS).default('div'),
    label: z.string().max(200).optional(),
  }),
  children: true,
  contentProps: ['label'],
  render: (node) => ({
    tag: pick(node.props.tag, BOX_TAGS, 'div'),
    attrs: { 'aria-label': str(node.props.label) },
  }),
};

export const text: ComponentDef = {
  name: 'text',
  kind: 'primitive',
  description: `A run of text. Props: text, tag (${TEXT_TAGS.join('|')}; summary only as the first child of a details).`,
  props: z.strictObject({
    tag: z.enum(TEXT_TAGS).default('p'),
    text: z.string().max(5000).default(''),
  }),
  children: false,
  contentProps: ['text'],
  render: (node) => ({
    tag: pick(node.props.tag, TEXT_TAGS, 'p'),
    text: str(node.props.text) ?? '',
  }),
};

export const link: ComponentDef = {
  name: 'link',
  kind: 'primitive',
  description:
    'A hyperlink. Props: href, text, target (_self|_blank), label (aria-label). May contain children instead of text.',
  props: z.strictObject({
    href: z.string().max(2048).default('#'),
    text: z.string().max(500).default(''),
    target: z.enum(['_self', '_blank']).optional(),
    label: z.string().max(200).optional(),
  }),
  // Browsers split nested interactive content, so a link holds no links, buttons or form parts.
  children: { deny: ['link', 'button', 'form', 'field', 'details'] },
  contentProps: ['text', 'href', 'label'],
  render: (node) => ({
    tag: 'a',
    attrs: {
      href: str(node.props.href) ?? '#',
      target: str(node.props.target),
      rel: node.props.target === '_blank' ? 'noopener noreferrer' : undefined,
      'aria-label': str(node.props.label),
    },
    text: str(node.props.text) ?? '',
  }),
};

export const button: ComponentDef = {
  name: 'button',
  kind: 'primitive',
  description: 'A button. Props: text, type (button|submit|reset), label (aria-label).',
  props: z.strictObject({
    text: z.string().max(200).default(''),
    type: z.enum(['button', 'submit', 'reset']).default('button'),
    label: z.string().max(200).optional(),
  }),
  children: false,
  contentProps: ['text', 'label'],
  render: (node) => ({
    tag: 'button',
    attrs: {
      type: pick(node.props.type, ['button', 'submit', 'reset'] as const, 'button'),
      'aria-label': str(node.props.label),
    },
    text: str(node.props.text) ?? '',
  }),
};

export const image: ComponentDef = {
  name: 'image',
  kind: 'primitive',
  description:
    'An image. Props: src, alt (required; use "" only for decorative images), width, height, loading (lazy|eager).',
  props: z.strictObject({
    src: z.string().max(100_000),
    alt: z.string().max(500),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    loading: z.enum(['lazy', 'eager']).default('lazy'),
  }),
  children: false,
  contentProps: ['src', 'alt'],
  render: (node) => ({
    tag: 'img',
    void: true,
    attrs: {
      src: str(node.props.src) ?? '',
      alt: str(node.props.alt) ?? '',
      width: typeof node.props.width === 'number' ? node.props.width : undefined,
      height: typeof node.props.height === 'number' ? node.props.height : undefined,
      loading: str(node.props.loading) ?? 'lazy',
      decoding: 'async',
    },
  }),
};

const RICH_TEXT_MAX = 40_000;

const RICH_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
  'figcaption',
  'div',
] as const;

export const richText: ComponentDef = {
  name: 'rich-text',
  kind: 'primitive',
  description: `Text with inline formatting. Props: html (only ${RICH_TEXT_TAGS.map((t) => `<${t}>`).join(' ')}; links need href), tag (${RICH_TAGS.join('|')}).`,
  props: z.strictObject({
    tag: z.enum(RICH_TAGS).default('p'),
    // Checked after sanitizing (escaping makes text longer), so stored values stay valid.
    html: z
      .string()
      .max(100_000)
      .default('')
      .transform(sanitizeRichText)
      .pipe(
        z.string().max(RICH_TEXT_MAX, `Too long: at most ${RICH_TEXT_MAX} characters of HTML.`),
      ),
  }),
  children: false,
  contentProps: ['html'],
  render: (node) => ({
    tag: pick(node.props.tag, RICH_TAGS, 'p'),
    html: str(node.props.html) ?? '',
  }),
};

export const details: ComponentDef = {
  name: 'details',
  kind: 'primitive',
  title: 'Accordion item',
  description:
    'Collapsible block (an accordion item, e.g. one FAQ question). First child: a text with tag "summary", the line that stays visible; the other children show when it is opened. Props: open (starts open), group (items with the same group close each other).',
  props: z.strictObject({
    open: z.boolean().optional(),
    group: z
      .string()
      .max(64)
      .regex(
        /^[A-Za-z][A-Za-z0-9_-]*$/,
        'Use letters, digits, "-" and "_", starting with a letter.',
      )
      .optional(),
  }),
  children: true,
  render: (node, ctx) => {
    const open = node.props.open === true;
    // While editing, every item is open so its content can be reached; the editor closes the ones
    // marked here again in preview.
    const editing = ctx.mode === 'editor';
    return {
      tag: 'details',
      attrs: {
        open: open || editing,
        name: str(node.props.group),
        'data-bb-closed': editing && !open ? '' : undefined,
      },
    };
  },
};

export const form: ComponentDef = {
  name: 'form',
  kind: 'primitive',
  title: 'Form',
  description:
    'A form that sends its fields to a URL. Children: field nodes, a button with type "submit", and any text or boxes around them. Props: action (http(s) or /path URL the form is sent to), method (post|get), label (aria-label).',
  props: z.strictObject({
    action: z.string().max(2048).default(''),
    method: z.enum(['post', 'get']).default('post'),
    label: z.string().max(200).optional(),
  }),
  // Browsers drop a form inside a form.
  children: { deny: ['form'] },
  contentProps: ['label'],
  render: (node) => ({
    tag: 'form',
    attrs: {
      // An empty action would post to the page itself; leave it out until one is set.
      action: str(node.props.action)?.trim() || undefined,
      method: pick(node.props.method, ['post', 'get'] as const, 'post'),
      'aria-label': str(node.props.label),
    },
  }),
};

export const FIELD_TYPES = [
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'time',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'hidden',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** What browsers offer to fill in, where the type says what the field is. */
const AUTOCOMPLETE: Partial<Record<FieldType, string>> = { email: 'email', tel: 'tel', url: 'url' };

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((o): o is string => typeof o === 'string') : [];

/** A form field: its label and its control as one element, so the label always names the control. */
function renderField(node: BNode, editing: boolean): ElementSpec {
  const p = node.props;
  const type = pick(p.type, FIELD_TYPES, 'text');
  const name = str(p.name) ?? '';
  const required = p.required === true;
  const value = str(p.value);
  const options = stringList(p.options);
  const labelSpec = (tag: string): ElementSpec => ({
    tag,
    attrs: { class: 'bb-field__label' },
    text: str(p.label) ?? '',
    edit: { prop: 'label', label: 'Label' },
  });
  const help: ElementSpec[] = str(p.help)
    ? [
        {
          tag: 'span',
          attrs: { class: 'bb-field__help' },
          text: str(p.help)!,
          edit: { prop: 'help', label: 'Help text' },
        },
      ]
    : [];
  const classes = (kind: string) =>
    `bb-field bb-field--${kind}${required ? ' bb-field--required' : ''}`;

  if (type === 'hidden') {
    // Nothing to see on the published page; the editor shows a chip so it can be selected.
    return editing
      ? {
          tag: 'span',
          attrs: { class: 'bb-field bb-field--hidden' },
          text: `Hidden field: ${name}`,
        }
      : { tag: 'input', void: true, attrs: { type: 'hidden', name, value: value ?? '' } };
  }
  if (type === 'checkbox' && !options.length) {
    return {
      tag: 'label',
      attrs: { class: classes('check') },
      children: [
        {
          tag: 'input',
          void: true,
          attrs: { class: 'bb-field__box', type: 'checkbox', name, value, required },
        },
        labelSpec('span'),
        ...help,
      ],
    };
  }
  if (type === 'radio' || type === 'checkbox') {
    return {
      tag: 'fieldset',
      attrs: { class: classes('group') },
      children: [
        labelSpec('legend'),
        ...options.map(
          (option): ElementSpec => ({
            tag: 'label',
            attrs: { class: 'bb-field__option' },
            children: [
              {
                tag: 'input',
                void: true,
                attrs: {
                  class: 'bb-field__box',
                  type,
                  name,
                  value: option,
                  // One required radio makes the group required; required checkboxes would all
                  // have to be ticked.
                  required: required && type === 'radio',
                  checked: option === value,
                },
              },
              { tag: 'span', text: option },
            ],
          }),
        ),
        ...help,
      ],
    };
  }
  const shared = { class: 'bb-field__control', name, required };
  let control: ElementSpec;
  if (type === 'textarea') {
    control = {
      tag: 'textarea',
      attrs: {
        ...shared,
        placeholder: str(p.placeholder),
        rows: typeof p.rows === 'number' ? p.rows : 4,
      },
      text: value ?? '',
    };
  } else if (type === 'select') {
    control = {
      tag: 'select',
      attrs: shared,
      children: [
        // The prompt ("Choose…") is an empty choice, so a required field can't be left on it.
        ...(str(p.placeholder)
          ? [{ tag: 'option', attrs: { value: '' }, text: str(p.placeholder)! }]
          : []),
        ...options.map(
          (option): ElementSpec => ({
            tag: 'option',
            attrs: { selected: option === value },
            text: option,
          }),
        ),
      ],
    };
  } else {
    control = {
      tag: 'input',
      void: true,
      attrs: {
        ...shared,
        type,
        placeholder: str(p.placeholder),
        value,
        autocomplete: AUTOCOMPLETE[type],
      },
    };
  }
  return {
    tag: 'label',
    attrs: { class: classes(type === 'textarea' || type === 'select' ? type : 'input') },
    children: [labelSpec('span'), control, ...help],
  };
}

export const field: ComponentDef = {
  name: 'field',
  kind: 'primitive',
  title: 'Form field',
  description: `One form field: a label with its control. Put it in a form. Props: type (${FIELD_TYPES.join('|')}), name (the key it is sent as), label (required unless hidden), placeholder, help, required, options (choices of select, radio or a checkbox group), value (preset; the value of a hidden field), rows (textarea).`,
  props: z.strictObject({
    type: z.enum(FIELD_TYPES).default('text'),
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(
        /^[A-Za-z_][A-Za-z0-9_.[\]-]*$/,
        'Use letters, digits, "_", "-", "." and "[]", starting with a letter.',
      ),
    label: z.string().max(200).default(''),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(300).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1).max(200)).max(100).optional(),
    value: z.string().max(2000).optional(),
    rows: z.number().int().min(2).max(20).optional(),
  }),
  children: false,
  contentProps: ['label', 'placeholder', 'help', 'options'],
  validate: (props) => {
    const type = props.type as FieldType;
    const options = stringList(props.options);
    if ((type === 'select' || type === 'radio') && !options.length) {
      return [
        {
          path: 'options',
          message: `A ${type} field needs "options": the choices it offers.`,
          hint: 'e.g. "options": ["Yes", "No"].',
        },
      ];
    }
    if (options.length && type !== 'select' && type !== 'radio' && type !== 'checkbox') {
      return [
        {
          path: 'options',
          message: `A ${type} field has no choices; "options" is for select, radio and checkbox fields.`,
          hint: 'Remove "options" (set it to null) or change "type".',
        },
      ];
    }
    return [];
  },
  render: (node, ctx) => renderField(node, ctx.mode === 'editor'),
};

export const icon: ComponentDef = {
  name: 'icon',
  kind: 'primitive',
  title: 'Icon',
  description:
    "An icon from the site's icon set, in the text colour and size (style it with color and font-size). Props: name (get_context lists the icons), label (what it means, when it stands alone; leave out if text next to it says the same).",
  props: z.strictObject({
    name: z.string().max(64).regex(ICON_NAME, 'Icon names are lowercase kebab-case.'),
    label: z.string().max(200).optional(),
  }),
  children: false,
  contentProps: ['name', 'label'],
  validate: (props, registry) => {
    const name = String(props.name);
    if (registry.icon(name)) return [];
    const names = registry.listIcons();
    return [
      {
        path: 'name',
        message: names.length
          ? `No icon "${name}".${didYouMean(name, names)}`
          : `No icon "${name}": this site has no icons.`,
        ...(names.length ? { hint: `Icons: ${listPreview(names, 80)}.` } : {}),
      },
    ];
  },
  render: (node) => {
    const label = str(node.props.label)?.trim();
    return {
      tag: 'span',
      attrs: {
        class: 'bb-icon',
        role: label ? 'img' : undefined,
        'aria-label': label || undefined,
        'aria-hidden': label ? undefined : 'true',
      },
      icon: str(node.props.name) ?? '',
    };
  },
};

export const PRIMITIVES: ComponentDef[] = [
  root,
  box,
  text,
  richText,
  link,
  button,
  image,
  icon,
  details,
  form,
  field,
];
