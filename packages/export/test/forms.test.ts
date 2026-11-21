import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, t } from '@bowerbirdjs/core';
import { exportReact } from '@bowerbirdjs/export';
import { renderPage } from '@bowerbirdjs/html';
import { type ChildNode, isTag, isText } from 'domhandler';
import { parseDocument } from 'htmlparser2';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { describe, expect, it, vi } from 'vitest';

describe('exportReact with forms, accordion items and icons', () => {
  it('renders the same markup as the page, with fields people can still type in', async () => {
    const registry = createDefaultRegistry();
    const store = createStore({ registry, doc: createStarterDoc() });
    const res = store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        {
          op: 'node.insert',
          parent: 'root-home',
          node: t.form({ action: '/api/rsvp', label: 'RSVP' }, [
            t.field({ field: 'name', label: 'Name', value: 'Ada', required: true }),
            t.field({
              field: 'note',
              type: 'textarea',
              label: 'Note',
              value: 'Line "one"\nLine two',
            }),
            t.field({
              field: 'meal',
              type: 'select',
              label: 'Meal',
              options: ['Fish', 'Veggie'],
              value: 'Veggie',
              placeholder: 'Choose…',
            }),
            t.field({
              field: 'go',
              type: 'radio',
              label: 'Coming?',
              options: ['Yes', 'No'],
              value: 'Yes',
            }),
            t.field({ field: 'terms', type: 'checkbox', label: 'I agree', value: 'yes' }),
            t.field({ field: 'list', type: 'hidden', label: '', value: '42' }),
            t.button({ text: 'Send', type: 'submit' }),
          ]),
        },
        {
          op: 'node.insert',
          parent: 'root-home',
          node: t.details({ open: true, group: 'faq' }, [
            t.text({ tag: 'summary', text: 'Why?' }),
            t.text({ text: 'Because.' }),
          ]),
        },
        {
          op: 'node.insert',
          parent: 'root-home',
          node: t.icon({ icon: 'check-circle', label: 'Yes' }),
        },
      ],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const files = exportReact(store.doc, registry);
    const source = files.find((f) => f.path === 'pages/Home.tsx')!.contents;
    // Presets are starting values, so React doesn't lock the fields (or warn about it).
    expect(source).toContain(
      '<input className="bb-field__control" name="name" required type="text" defaultValue="Ada" />',
    );
    expect(source).toContain(
      '<textarea className="bb-field__control" name="note" rows="4" defaultValue={"Line \\"one\\"\\nLine two"} />',
    );
    expect(source).toContain(
      '<select className="bb-field__control" name="meal" defaultValue="Veggie">',
    );
    expect(source).toContain('type="radio" name="go" value="Yes" defaultChecked');
    expect(source).toContain('<input type="hidden" name="list" value="42" />');
    expect(source).toContain('<details open name="faq">');
    expect(source).toContain(
      '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">',
    );

    const { code } = await transformWithOxc(source, 'Home.tsx', {
      jsx: { runtime: 'classic', pragma: 'React.createElement' },
      lang: 'tsx',
    });
    const component = new Function(
      'React',
      code.replace(/export default function/, 'return function').replace(/export const/g, 'const'),
    )({ createElement });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const markup = renderToStaticMarkup(createElement(component));
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
    warn.mockRestore();
    // Same elements, attributes and text; React orders attributes its own way and closes
    // SVG shapes with end tags, so compare the parsed trees.
    const tree = (html: string) => {
      const walk = (nodes: ChildNode[]): unknown[] =>
        nodes.flatMap((n): unknown[] => {
          if (isText(n)) return n.data.trim() ? [n.data.replace(/\s+/g, ' ')] : [];
          if (!isTag(n)) return [];
          const attrs = Object.entries(n.attribs).sort(([a], [b]) => a.localeCompare(b));
          return [{ tag: n.name, attrs, children: walk(n.children) }];
        });
      return walk(parseDocument(html).children);
    };
    expect(tree(markup)).toEqual(tree(renderPage(store.doc, registry, 'home').html));
  });
});
