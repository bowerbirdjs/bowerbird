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
          // Emphasis and links in running text are kept as rich text.
          { type: 'rich-text', props: { tag: 'p', html: 'We started in <strong>2019</strong>.' } },
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

  it('drops scripts, keeps inline links as rich text and explains what changed', () => {
    const { nodes, warnings } = htmlToNodes(
      '<div class="x"><script>alert(1)</script><p>See <a href="/a">this</a></p><img src="a.png"><custom-thing>Hi</custom-thing></div>',
    );
    expect(JSON.stringify(nodes)).not.toContain('alert');
    expect(nodes[0]?.children?.[0]).toEqual({
      type: 'rich-text',
      props: { tag: 'p', html: 'See <a href="/a">this</a>' },
    });
    expect(warnings).toEqual(
      expect.arrayContaining([
        '<script> elements were skipped.',
        expect.stringContaining('class attributes were ignored'),
        expect.stringContaining('no alt attribute'),
        '<custom-thing> was converted to a <div>.',
      ]),
    );
    // Formatting in an element rich text can't render stays plain text, and says so.
    const label = htmlToNodes('<label>Name <b>required</b></label>');
    expect(label.nodes[0]).toEqual({
      type: 'text',
      props: { tag: 'label', text: 'Name required' },
    });
    expect(label.warnings[0]).toMatch(/imported as plain text/);
  });

  it('wraps loose text and keeps block links with children', () => {
    const { nodes } = htmlToNodes(
      '<div>Hello <em>there</em><a href="/x"><img src="a.png" alt="A"></a></div>',
    );
    expect(nodes[0]?.children).toEqual([
      { type: 'rich-text', props: { tag: 'p', html: 'Hello <em>there</em>' } },
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

  it('keeps links in navigation lists', () => {
    const { nodes, warnings } = htmlToNodes('<ul><li><a href="/about">About</a></li></ul>');
    expect(warnings).toEqual([]);
    expect(nodes[0]?.children?.[0]).toEqual({
      type: 'box',
      props: { tag: 'li' },
      children: [{ type: 'link', props: { href: '/about', text: 'About' } }],
    });
  });

  it('never imports script or style text, unsafe URLs, or invalid sizes', () => {
    const { nodes, warnings } = htmlToNodes(
      '<p>Hello <script>steal()</script><style>.x{}</style>world</p><a href="javascript:alert(1)">x</a><img src="t.gif" alt="" width="0">',
    );
    expect(nodes[0]?.props?.text).toBe('Hello world');
    expect(nodes[1]?.props?.href).toBe('#');
    expect(nodes[2]?.props).toEqual({ src: 't.gif', alt: '' });
    expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining('Unsafe href')]));
  });

  it('shortens very long text and says when it stops early', () => {
    const long = htmlToNodes(`<p>${'a'.repeat(6000)}</p>`);
    expect(String(long.nodes[0]?.props?.text).length).toBe(5000);
    expect(long.warnings[0]).toContain('shortened');
    const capped = htmlToNodes('<section><p>a</p><p>b</p><p>c</p></section>', { maxNodes: 2 });
    expect(capped.warnings.join(' ')).toContain('Stopped after 2 nodes');
  });

  it('handles very deeply nested inline markup', () => {
    const html = `<p>${'<span>'.repeat(5000)}deep${'</span>'.repeat(5000)}</p>`;
    expect(htmlToNodes(html).nodes[0]?.props?.text).toBe('deep');
  });

  it('keeps buttons inside a link as text, so the import is accepted', () => {
    const { nodes, warnings } = htmlToNodes(
      '<a href="/buy"><img src="a.png" alt="Plan"><button>Buy now</button></a>',
    );
    expect(nodes[0]?.children?.[1]).toEqual({
      type: 'text',
      props: { tag: 'span', text: 'Buy now' },
    });
    expect(warnings).toContain('Links, buttons and form fields inside a link were kept as text.');
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const res = store.apply({
      ops: nodes.map((node) => ({ op: 'node.insert', parent: 'root-home', node })),
    });
    expect(res.ok).toBe(true);
  });
});
