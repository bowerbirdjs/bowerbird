import type { ComponentDef } from '@bowerbirdjs/core';
import { z } from 'zod';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'checkbox'
  | 'url'
  | 'image'
  /** A list of strings (a field's choices), edited one per line. */
  | 'lines'
  /** The name of an icon from the registry's icon set, picked from a grid. */
  | 'icon'
  /** Arrays and objects (e.g. code component props), edited as JSON. */
  | 'json';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  maxLength?: number;
  description?: string;
}

const LABELS: Record<string, string> = {
  href: 'Link',
  src: 'Image',
  alt: 'Alt text',
  tag: 'Element',
  label: 'Accessible label',
  target: 'Open in',
  html: 'Formatted text (HTML)',
};

/** Labels that depend on the component: a field's `label` is its visible label, not an ARIA one. */
const COMPONENT_LABELS: Record<string, Record<string, string>> = {
  icon: { name: 'Icon', label: 'Meaning (for screen readers)' },
  details: { open: 'Starts open', group: 'Group (opening one closes the others)' },
  form: { action: 'Send to (URL)', method: 'Method' },
  field: {
    type: 'Kind',
    name: 'Name (sent with the form)',
    label: 'Label',
    help: 'Help text',
    options: 'Choices (one per line)',
    value: 'Preset value',
  },
};

const label = (key: string, component?: string) =>
  (component && COMPONENT_LABELS[component]?.[key]) ??
  LABELS[key] ??
  key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, ' ');

const cache = new WeakMap<ComponentDef, Field[]>();

/** Form fields for a component's props, derived from its Zod schema (one source of truth). */
export function fieldsFor(def: ComponentDef): Field[] {
  const cached = cache.get(def);
  if (cached) return cached;
  const schema = z.toJSONSchema(def.props, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  const fields: Field[] = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const options = Array.isArray(prop.enum) ? (prop.enum as unknown[]).map(String) : undefined;
    const type = prop.type;
    let kind: FieldKind = 'text';
    const items = prop.items as { type?: unknown } | undefined;
    if (options) kind = 'select';
    else if (def.name === 'icon' && key === 'name') kind = 'icon';
    else if (type === 'number' || type === 'integer') kind = 'number';
    else if (type === 'boolean') kind = 'checkbox';
    else if (type === 'array' && items?.type === 'string') kind = 'lines';
    else if (type === 'array' || type === 'object' || (!type && !prop.enum)) kind = 'json';
    else if (key === 'href') kind = 'url';
    else if (key === 'src') kind = 'image';
    else if (key === 'html') kind = 'textarea';
    else if (key === 'text' && typeof prop.maxLength === 'number' && prop.maxLength > 500)
      kind = 'textarea';
    fields.push({
      key,
      label: label(key, def.name),
      kind,
      required: required.has(key) && prop.default === undefined,
      ...(options ? { options } : {}),
      ...(typeof prop.maxLength === 'number' ? { maxLength: prop.maxLength } : {}),
      ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
    });
  }
  cache.set(def, fields);
  return fields;
}

const CHOICE_FIELDS = new Set(['select', 'radio', 'checkbox']);

/**
 * The fields worth showing for a node as it is now. A form field offers only what its kind uses:
 * choices for a select, radio or checkbox group, rows for a text area, no label for a hidden one.
 */
export function fieldsForNode(def: ComponentDef, props: Record<string, unknown>): Field[] {
  const fields = fieldsFor(def);
  if (def.name !== 'field') return fields;
  const type = typeof props.type === 'string' ? props.type : 'text';
  const hidden = new Set<string>();
  if (!CHOICE_FIELDS.has(type)) hidden.add('options');
  if (type !== 'textarea') hidden.add('rows');
  if (type === 'radio' || type === 'checkbox' || type === 'hidden') hidden.add('placeholder');
  if (type === 'hidden') for (const key of ['label', 'help', 'required']) hidden.add(key);
  return fields.filter((f) => !hidden.has(f.key));
}

/**
 * A change to one prop with the others it brings along: turning a form field into a select or
 * radio group gives it two choices to start from (it can't be one without any), and turning it
 * into a kind without choices drops them.
 */
export function withCompanions(
  def: ComponentDef,
  props: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (def.name !== 'field' || typeof patch.type !== 'string' || 'options' in patch) return patch;
  const has = Array.isArray(props.options) && props.options.length > 0;
  if ((patch.type === 'select' || patch.type === 'radio') && !has)
    return { ...patch, options: ['Option 1', 'Option 2'] };
  if (!CHOICE_FIELDS.has(patch.type) && props.options !== undefined)
    return { ...patch, options: null };
  return patch;
}

/** Turns a form input value into a prop patch value (`null` removes an optional prop). */
export function fieldValue(
  field: Field,
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): unknown {
  if (field.kind === 'checkbox') return (input as HTMLInputElement).checked;
  if (field.kind === 'json') {
    const raw = input.value.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${field.label}: not valid JSON.`);
    }
  }
  const raw = input.value;
  if (field.kind === 'lines') return linesValue(raw);
  if (field.kind === 'number') return raw.trim() === '' ? null : Number(raw);
  if (raw === '' && !field.required && field.kind !== 'textarea' && field.key !== 'text')
    return null;
  return raw;
}

/** A list typed one item per line (blank lines dropped); `null` when nothing is left. */
export function linesValue(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : null;
}
