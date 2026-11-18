import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { importPuck, type PuckData } from '@bowerbirdjs/import';
import { describe, expect, it } from 'vitest';

const data: PuckData = {
  root: { props: { title: 'Launch page' } },
  content: [
    {
      type: 'HeroBlock',
      props: {
        id: 'HeroBlock-1',
        title: 'Hello from Puck',
        description: 'Moved over',
        buttonText: 'Go',
      },
    },
    {
      type: 'Columns',
      props: {
        id: 'Columns-1',
        // Newer Puck: slots are arrays of components in props.
        left: [{ type: 'Text', props: { id: 'Text-1', text: 'Left column' } }],
      },
    },
    {
      type: 'Mystery',
      props: { id: 'Mystery-1', title: 'Unknown block', body: 'Still imported', href: '/x' },
    },
  ],
  // Legacy drop zones.
  zones: { 'Columns-1:right': [{ type: 'Text', props: { id: 'Text-2', text: 'Right column' } }] },
};

describe('importPuck', () => {
  it('maps Puck components to sections and nodes, keeping unknown ones as text', () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const page = store.doc.pages.home!;
    const { ops, warnings, title } = importPuck(data, {
      page: page.id,
      parent: page.rootId,
      map: {
        HeroBlock: (p) => ({
          section: 'hero',
          content: {
            heading: { text: String(p.title) },
            subheading: { text: String(p.description) },
            primary: { text: String(p.buttonText) },
          },
        }),
        Columns: (_p, children) => ({
          node: { type: 'box', props: {}, children: [...children('left'), ...children('right')] },
        }),
        Text: (p) => ({ node: { type: 'text', props: { text: String(p.text) } } }),
      },
    });
    expect(title).toBe('Launch page');
    expect(warnings).toEqual(['No mapping for Mystery; imported as plain boxes with their text.']);
    const res = store.apply({ ops });
    expect(res.ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Hello from Puck');
    const texts = Object.values(store.doc.nodes)
      .filter((n) => n.type === 'text' && !n.id.startsWith('hero-1'))
      .map((n) => n.props.text);
    expect(texts).toEqual(['Left column', 'Right column', 'Unknown block', 'Still imported']);
  });

  it('warns instead of guessing where plain nodes go', () => {
    const { ops, warnings } = importPuck({ content: [{ type: 'X', props: { title: 'x' } }] });
    expect(ops).toEqual([]);
    expect(warnings[0]).toMatch(/pass the page root id as "parent"/);
  });
});
