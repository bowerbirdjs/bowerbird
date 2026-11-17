import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { htmlToNodes } from '@bowerbirdjs/import';
import { describe, expect, it } from 'vitest';

describe('htmlToNodes', () => {
  it('maps semantic HTML to primitives', () => {
    const { nodes, warnings } = htmlToNodes(`
      <section style="padding-block: var(--space-2xl)">
        <h2>Our story</h2>
        <p>We started in <strong>2019</strong>.</p>
        <ul><li>Fast</li><li>Fair</li></ul>
        <a href="/about">Read more</a>
        <img src="/team.jpg" alt="The team" width="800">
      </section>`);
    expect(warnings).toEqual([]);
    expect(nodes).toEqual([
      {
        type: 'box',
        props: { tag: 'section' },
        css: 'padding-block: var(--space-2xl)',
        children: [
          { type: 'text', props: { tag: 'h2', text: 'Our story' } },
          { type: 'text', props: { tag: 'p', text: 'We started in 2019.' } },
          {
            type: 'box',
            props: { tag: 'ul' },
            children: [
              { type: 'text', props: { tag: 'li', text: 'Fast' } },
              { type: 'text', props: { tag: 'li', text: 'Fair' } },
            ],
          },
          { type: 'link', props: { href: '/about', text: 'Read more' } },
          { type: 'image', props: { src: '/team.jpg', alt: 'The team', width: 800 } },
        ],
      },
    ]);
  });

  it('drops scripts, flattens inline links and explains what changed', () => {
    const { nodes, warnings } = htmlToNodes(
      '<div class="x"><script>alert(1)</script><p>See <a href="/a">this</a></p><img src="a.png"><custom-thing>Hi</custom-thing></div>',
    );
    expect(JSON.stringify(nodes)).not.toContain('alert');
    expect(warnings).toEqual(
      expect.arrayContaining([
        '<script> elements were skipped.',
        expect.stringContaining('class attributes were ignored'),
        expect.stringContaining('Links inside running text'),
        expect.stringContaining('no alt attribute'),
        '<custom-thing> was converted to a <div>.',
      ]),
    );
  });

  it('wraps loose text and keeps block links with children', () => {
    const { nodes } = htmlToNodes(
      '<div>Hello <em>there</em><a href="/x"><img src="a.png" alt="A"></a></div>',
    );
    expect(nodes[0]?.children).toEqual([
      { type: 'text', props: { tag: 'p', text: 'Hello there' } },
      {
        type: 'link',
        props: { href: '/x' },
        children: [{ type: 'image', props: { src: 'a.png', alt: 'A' } }],
      },
    ]);
  });

  it('produces nodes the store accepts', () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const { nodes } = htmlToNodes('<section><h1>Hi</h1><p>Text</p><a href="/x">Go</a></section>');
    const res = store.apply({
      ops: nodes.map((node) => ({ op: 'node.insert', parent: 'root-home', node })),
    });
    expect(res.ok).toBe(true);
    // nodes outside sections are not scoped, so the heading is text-1
    expect(store.doc.nodes['text-1']?.props.text).toBe('Hi');
    expect(store.doc.nodes['text-1']?.parent).toBe('box-1');
  });
});
