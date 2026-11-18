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
};

const label = (key: string) =>
  LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, ' ');

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
    if (options) kind = 'select';
    else if (type === 'number' || type === 'integer') kind = 'number';
    else if (type === 'boolean') kind = 'checkbox';
    else if (type === 'array' || type === 'object' || (!type && !prop.enum)) kind = 'json';
    else if (key === 'href') kind = 'url';
    else if (key === 'src') kind = 'image';
    else if (key === 'text' && typeof prop.maxLength === 'number' && prop.maxLength > 500)
      kind = 'textarea';
    fields.push({
      key,
      label: label(key),
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
  if (field.kind === 'number') return raw.trim() === '' ? null : Number(raw);
  if (raw === '' && !field.required && field.kind !== 'textarea' && field.key !== 'text')
    return null;
  return raw;
}
