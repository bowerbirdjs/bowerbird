// Regressions for the Phase 1 review (findings that live in the engine rather than the editor UI).
import { createPolicy, createStore, type SiteDoc } from '@bowerbirdjs/core';
import { renderDocument, renderPage } from '@bowerbirdjs/html';
import { describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

describe('stored documents cannot inject markup through props', () => {
  it('falls back to safe tags for box/text and never emits denied tags', () => {
    const store = makeStore();
    store.apply({ ops: [{ op: 'section.insert', section: 'hero' }] });
    const doc = structuredClone(store.doc) as SiteDoc;
    doc.nodes['hero-1/heading']!.props = { tag: 'style', text: 'body{background:red}' };
    doc.nodes['hero-1/subheading']!.props = { tag: 'script', text: 'alert(1)' };
    doc.nodes['hero-1/content']!.props = { tag: 'iframe' };
    const loaded = createStore({ registry: store.registry, doc });
    const html = renderDocument(loaded.doc, loaded.registry, 'home');
    const body = html.slice(html.indexOf('<body'));
    expect(body).not.toMatch(/<(style|script|iframe)\b/);
    expect(body).toContain('<p class="bb-hero__heading">body{background:red}</p>');
    expect(body).toContain('alert(1)</p>');
    expect(renderPage(loaded.doc, loaded.registry, 'home', { mode: 'editor' }).html).not.toMatch(
      /<(style|script|iframe)\b/,
    );
  });
});

describe('undo, redo and revert follow the policy', () => {
  it('a content-level person cannot undo an agent’s layout change', () => {
    const store = makeStore();
    store.apply({ ops: [{ op: 'section.insert', section: 'hero' }], actor: agent });
    store.setPolicy(createPolicy({ levels: { user: 'content', agent: 'design' } }));
    const res = store.undo({ actorId: agent.id, actor: human });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toMatchObject({ code: 'policy' });
    expect(store.view.node('hero-1')).toBeDefined();
    // Content edits can still be undone at content level.
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'x' } }],
      actor: agent,
    });
    expect(store.undo({ actorId: agent.id, actor: human }).ok).toBe(true);
  });

  it('locked nodes cannot be changed by undo either', () => {
    const store = makeStore();
    store.apply({ ops: [{ op: 'section.insert', section: 'hero' }], actor: human });
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'x' } }],
      actor: agent,
    });
    store.setPolicy(createPolicy({ lockedNodes: ['hero-1'] }));
    expect(store.undo({ actorId: agent.id }).ok).toBe(false);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('x');
  });
});

describe('store.load', () => {
  it('notifies load listeners', () => {
    const store = makeStore();
    const other = makeStore();
    other.apply({ ops: [{ op: 'section.insert', section: 'hero' }] });
    const seen: number[] = [];
    const off = store.onLoad((doc) => seen.push(doc.revision));
    store.load(other.doc);
    off();
    store.load(other.doc);
    expect(seen).toEqual([other.doc.revision]);
  });
});
