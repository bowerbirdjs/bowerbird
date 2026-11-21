import { compactParts, createAgentTools, runTool, sectionParts } from '@bowerbirdjs/agent';
import {
  createDefaultRegistry,
  createStarterDoc,
  faq,
  features,
  pricing,
} from '@bowerbirdjs/blocks';
import { createRegistry, createStore } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

function setup(registry = createDefaultRegistry()) {
  const store = createStore({ registry, doc: createStarterDoc() });
  store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'test-agent' } });
  return { store, run: (name: string, input: unknown = {}) => runTool(tools, name, input) };
}

describe('compactParts', () => {
  it('folds runs of numbered items that hold the same parts', () => {
    expect(compactParts(sectionParts(features).map((p) => p.path))).toBe(
      'header, heading, intro, grid, item-1 … item-6 (each: icon, title, body)',
    );
    expect(compactParts(sectionParts(faq).map((p) => p.path))).toBe(
      'header, heading, intro, list, item-1 … item-4 (each: question, answer)',
    );
    expect(compactParts(['a', 'b-1', 'b-2', 'b-3', 'c'])).toBe('a, b-1 … b-3, c');
  });

  it('keeps items apart when their parts differ or the count has a gap', () => {
    // The Pro tier has a badge and one more feature, so every tier is listed.
    expect(compactParts(sectionParts(pricing).map((p) => p.path))).toBe(
      'header, heading, intro, tiers, ' +
        'tier-starter (name, price-row, price, period, description, features, feature-1 … feature-3, cta), ' +
        'tier-pro (badge, name, price-row, price, period, description, features, feature-1 … feature-4, cta), ' +
        'tier-team (name, price-row, price, period, description, features, feature-1 … feature-3, cta)',
    );
    expect(compactParts(['item-1', 'item-1/a', 'item-2', 'item-2/b', 'item-3', 'item-3/b'])).toBe(
      'item-1 (a), item-2 … item-3 (each: b)',
    );
    expect(compactParts(['x-1', 'x-3', 'x-4', 'y-5'])).toBe('x-1, x-3 … x-4, y-5');
    expect(compactParts([])).toBe('');
  });
});

describe('the catalog agents read', () => {
  it('lists every section in a few lines; details come by name', async () => {
    const { run, store } = setup();
    const list = (await run('list_sections')).text;
    for (const s of store.registry.listSections()) expect(list).toContain(`${s.name} — ${s.title}`);
    expect(list).toContain(
      'faq — Questions and answers (content): Frequently asked questions as an accordion',
    );
    expect(list).toContain(
      '  variants: layout=centered|side\n  parts: header, heading, intro, list, item-1 … item-4 (each: question, answer)',
    );
    // Style variables are part of the details, not of the catalog.
    expect(list).not.toContain('--faq-bg');
    expect(list.length).toBeLessThan(9000);
    const one = (await run('list_sections', { name: 'faq' })).text;
    expect(one).toContain('vars: --faq-bg (color, default var(--color-surface))');
    expect(one).toContain(
      'item-2/question  text<summary>  "Do I need a developer to make changes?"',
    );
    expect((await run('list_sections', { query: 'form' })).text).toContain('newsletter — ');
  });

  it('names the icons and the new components', async () => {
    const { run } = setup();
    const ctx = (await run('get_context')).text;
    expect(ctx).toContain(
      'Components: box, text, rich-text, link, button, image, icon, details, form, field',
    );
    expect(ctx).toMatch(/Icons \(for icon nodes\): arrow-right, .*, bookmark\n/);
    // A registry without icons doesn't mention them.
    const bare = setup(createRegistry());
    expect((await bare.run('get_context')).text).not.toContain('Icons (');
  });

  it('builds a page from the new sections in one call, filled in', async () => {
    const { run, store } = setup();
    const res = await run('apply', {
      ops: [
        { op: 'section.insert', section: 'page-header', content: { heading: { text: 'Contact' } } },
        {
          op: 'section.insert',
          section: 'faq',
          variant: { layout: 'side' },
          content: {
            'item-1/question': { text: 'Where are you?' },
            'item-1/answer': { text: 'In Lisbon.' },
          },
        },
        {
          op: 'section.insert',
          section: 'contact',
          content: {
            form: { action: '/api/contact' },
            'detail-email/value': { text: 'team@example.com', href: 'mailto:team@example.com' },
            'detail-email/icon': { name: 'send' },
          },
        },
        { op: 'node.duplicate', id: 'faq-1/item-4' },
      ],
    });
    expect(res.isError, res.text).toBeFalsy();
    expect(store.doc.nodes['faq-1/item-5/question']?.props.text).toBe('Can agents edit my pages?');
    expect(store.doc.nodes['contact-1/form']?.props.action).toBe('/api/contact');
    const lint = (await run('lint')).text;
    expect(lint).toContain('0 errors, 0 warnings');
    // A wrong part or icon is explained.
    const bad = await run('apply', {
      ops: [
        {
          op: 'section.insert',
          section: 'contact',
          content: { 'detail-mail/icon': { name: 'x' } },
        },
      ],
    });
    expect(bad.text).toContain(
      'Section "contact" has no part "detail-mail/icon". Did you mean "detail-email/icon"',
    );
    const icon = await run('apply', {
      ops: [{ op: 'props.set', id: 'contact-1/detail-email/icon', props: { name: 'mial' } }],
    });
    expect(icon.text).toContain('No icon "mial". Did you mean "mail"?');
  });
});
