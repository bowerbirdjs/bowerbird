import { z } from 'zod';
import type { ComponentDef } from './registry.js';

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
  description: `A run of text. Props: text, tag (${TEXT_TAGS.join('|')}).`,
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
  children: true,
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

export const PRIMITIVES: ComponentDef[] = [root, box, text, link, button, image];
