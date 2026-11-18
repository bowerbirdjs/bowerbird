import { lintPage } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { makeStore } from './fixtures.js';

const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r, null, 2));
  return r as Extract<T, { ok: true }>;
};
const errors = (r: {
  ok: boolean;
  errors?: { code: string; message: string; hint?: string }[];
}) => {
  if (r.ok) throw new Error('expected failure');
  return r.errors!;
};

describe('section.variant', () => {
  it('switches variants while keeping content, styles and added nodes', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero', content: { heading: { text: 'Kept' } } },
          { op: 'style.set', id: 'hero-1/heading', css: 'color: var(--color-accent)' },
          {
            op: 'node.insert',
            parent: 'hero-1/content',
            node: { type: 'text', props: { text: 'Added' } },
          },
          { op: 'node.remove', id: 'hero-1/subheading' },
        ],
      }),
    );
    ok(
      store.apply({ ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'split' } }] }),
    );
    const n = store.doc.nodes;
    expect(n['hero-1']?.section?.variant).toEqual({ layout: 'split' });
    expect(n['hero-1/media']?.type).toBe('image');
    expect(n['hero-1/heading']?.props.text).toBe('Kept');
    expect(n['hero-1/heading']?.styles).toEqual({
      base: { default: { color: 'var(--color-accent)' } },
    });
    expect(n['hero-1/text-1']?.parent).toBe('hero-1/content');
    expect(n['hero-1/subheading']).toBeUndefined();
    expect(store.view.children('hero-1/content').map((c) => c.id)).toEqual([
      'hero-1/heading',
      'hero-1/cta',
      'hero-1/text-1',
    ]);
  });

  it('warns about dropped parts and undo restores them', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [{ op: 'section.insert', section: 'hero', variant: { layout: 'split' } }],
      }),
    );
    ok(
      store.apply({ ops: [{ op: 'props.set', id: 'hero-1/media', props: { alt: 'Team photo' } }] }),
    );
    const res = ok(
      store.apply({
        ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'centered' } }],
      }),
    );
    expect(res.warnings[0]).toMatchObject({ code: 'parts_removed', nodeId: 'hero-1' });
    expect(store.doc.nodes['hero-1/media']).toBeUndefined();
    ok(store.undo());
    expect(store.doc.nodes['hero-1/media']?.props.alt).toBe('Team photo');
    expect(store.doc.nodes['hero-1']?.section?.variant).toEqual({ layout: 'split' });
  });

  it('rejects non-section nodes and invalid values', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [e] = errors(
      store.apply({ ops: [{ op: 'section.variant', id: 'hero-1/heading', variant: {} }] }),
    );
    expect(e?.hint).toContain('"hero-1"');
    expect(
      errors(
        store.apply({ ops: [{ op: 'section.variant', id: 'hero-1', variant: { layout: 'x' } }] }),
      )[0]?.code,
    ).toBe('invalid_variant');
  });
});

describe('tokens in use', () => {
  it('refuses to remove a referenced token unless forced', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    ok(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'color: var(--color-accent)' }] }),
    );
    const [e] = errors(
      store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: null }] }),
    );
    expect(e?.code).toBe('token_in_use');
    expect(e?.message).toContain('node "hero-1"');
    expect(e?.message).toContain('token "color.accent-hover"');
    ok(store.apply({ ops: [{ op: 'token.set', path: 'color.accent', value: null, force: true }] }));
  });
});

describe('raw value hints', () => {
  it('suggests the closest token by value', () => {
    const store = makeStore();
    ok(store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] }));
    const [pad] = errors(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'padding: 24px' }] }),
    );
    expect(pad?.hint).toMatch(/^Closest tokens: var\(--space-lg\) = 1\.5rem/);
    const [color] = errors(
      store.apply({ ops: [{ op: 'style.set', id: 'hero-1', css: 'color: #4f46e6' }] }),
    );
    expect(color?.hint).toMatch(/^Closest tokens: var\(--color-accent\) = #4f46e5/);
  });
});

describe('lintPage', () => {
  it('reports headings, links and leftover template copy', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          { op: 'section.insert', section: 'hero' },
          { op: 'section.insert', section: 'features' },
        ],
      }),
    );
    let rules = lintPage(store.view, store.registry, 'home').map(
      (i) => `${i.rule}:${i.nodeId ?? ''}`,
    );
    expect(rules).toContain('template-text:hero-1/heading');
    expect(rules).toContain('placeholder-link:hero-1/cta');
    expect(rules).toContain('page-description:');

    ok(
      store.apply({
        ops: [
          { op: 'props.set', id: 'hero-1/heading', props: { text: 'Real headline' } },
          { op: 'props.set', id: 'features-1/heading', props: { tag: 'h1' } },
          { op: 'props.set', id: 'features-1/item-1/title', props: { tag: 'h4' } },
          { op: 'props.set', id: 'hero-1/cta', props: { text: '', href: 'javascript:alert(1)' } },
        ],
      }),
    );
    const issues = lintPage(store.view, store.registry, 'home');
    rules = issues.map((i) => `${i.rule}:${i.nodeId ?? ''}`);
    expect(rules).not.toContain('template-text:hero-1/heading');
    expect(rules).toContain('single-h1:features-1/heading');
    expect(rules).toContain('heading-order:features-1/item-1/title');
    expect(rules).toContain('link-name:hero-1/cta');
    expect(rules).toContain('unsafe-url:hero-1/cta');
    expect(issues[0]?.severity).toBe('error');
  });

  it('requires an accessible name for links that only wrap an image, and agrees with the renderer on URLs', () => {
    const store = makeStore();
    ok(
      store.apply({
        ops: [
          {
            op: 'node.insert',
            parent: 'root-home',
            node: {
              type: 'link',
              id: 'logo',
              props: { href: '/' },
              children: [{ type: 'image', props: { src: '/logo.png', alt: '' } }],
            },
          },
          {
            op: 'node.insert',
            parent: 'root-home',
            node: {
              type: 'link',
              id: 'bad',
              props: { href: 'data:image/png;base64,AAAA', text: 'x' },
            },
          },
          {
            op: 'node.insert',
            parent: 'root-home',
            node: { type: 'link', id: 'ctl', props: { href: 'java\nscript:alert(1)', text: 'x' } },
          },
        ],
      }),
    );
    const rules = lintPage(store.view, store.registry, 'home').map(
      (i) => `${i.rule}:${i.nodeId ?? ''}`,
    );
    expect(rules).toContain('link-name:logo');
    expect(rules).toContain('unsafe-url:bad');
    expect(rules).toContain('unsafe-url:ctl');
  });
});
