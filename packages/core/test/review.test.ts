import { createPolicy, type Store } from '@bowerbirdjs/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { agent, human, makeStore } from './fixtures.js';

const sys = { kind: 'system', id: 'setup' } as const;

describe('provenance', () => {
  let store: Store;
  beforeEach(() => {
    store = makeStore();
    store.apply({ ops: [{ op: 'section.insert', section: 'hero' }], actor: sys });
  });

  it('stamps created nodes and changed fields with the actor and revision', () => {
    expect(store.view.node('hero-1/heading')?.edited?.node).toMatchObject({
      by: 'setup',
      kind: 'system',
    });
    const res = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Hi' } }],
      actor: human,
    });
    expect(res.ok && res.revision).toBeTruthy();
    expect(store.view.node('hero-1/heading')?.edited?.['props.text']).toEqual({
      by: 'ana',
      kind: 'user',
      rev: store.doc.revision,
    });
  });

  it('warns by default when an agent overwrites a person’s edit', () => {
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Hi' } }],
      actor: human,
    });
    const res = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Agent' } }],
      actor: agent,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.map((w) => w.code)).toContain('human_edit');
    // System and agent-written content is not protected.
    const other = store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'x' } }],
      actor: agent,
    });
    expect(other.ok && other.warnings.some((w) => w.code === 'human_edit')).toBe(false);
  });

  it('with confirm, refuses until overwrite is set, and undo restores the stamps', () => {
    store.setPolicy(createPolicy({ protectHumanEdits: 'confirm' }));
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Hi' } }],
      actor: human,
    });
    const ops = [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Agent' } }];
    const refused = store.apply({ ops, actor: agent });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]).toMatchObject({ code: 'human_edit', nodeId: 'hero-1/heading' });
      expect(refused.errors[0]?.message).toMatch(/ana \(user\)/);
      expect(refused.errors.at(-1)?.hint).toMatch(/overwrite: true/);
    }
    expect(store.apply({ ops, actor: agent, overwrite: true }).ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.edited?.['props.text']?.by).toBe('claude');
    store.undo({ actorId: agent.id });
    expect(store.view.node('hero-1/heading')?.edited?.['props.text']?.by).toBe('ana');
    // Removing a section a person edited is protected too.
    const removed = store.apply({ ops: [{ op: 'node.remove', id: 'hero-1' }], actor: agent });
    expect(removed.ok).toBe(false);
  });

  it('duplicates are stamped as new nodes by whoever duplicated them', () => {
    store.apply({
      ops: [{ op: 'props.set', id: 'hero-1/heading', props: { text: 'Hi' } }],
      actor: human,
    });
    store.apply({ ops: [{ op: 'node.duplicate', id: 'hero-1' }], actor: agent });
    expect(store.view.node('hero-2/heading')?.edited).toEqual({
      node: { by: 'claude', kind: 'agent', rev: store.doc.revision },
    });
  });
});

describe('changesets', () => {
  let store: Store;
  beforeEach(() => {
    store = makeStore({ review: { agent: true } });
  });

  it('agents with review required must propose', () => {
    const res = store.apply({ ops: [{ op: 'section.insert', section: 'hero' }], actor: agent });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe('review_required');
  });

  it('proposals pin created ids, record dependencies and change nothing until accepted', () => {
    const revision = store.doc.revision;
    const proposed = store.propose({
      actor: agent,
      label: 'Hero and features',
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'props.set', id: 'hero-1/heading', props: { text: 'Proposed' } },
        { op: 'section.insert', section: 'features' },
      ],
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const cs = proposed.changeset;
    expect(store.doc.revision).toBe(revision);
    expect(cs.ops[0]).toMatchObject({ op: 'section.insert', id: 'hero-1' });
    expect(cs.needs).toEqual([[], [0], []]);
    expect(cs.summary.created).toContain('hero-1/heading');

    // Something else happens meanwhile: a person inserts a hero first.
    store.apply({ ops: [{ op: 'section.insert', section: 'features' }], actor: human });

    const preview = store.previewChangeset(cs.id);
    expect(preview.doc?.nodes['hero-1/heading']?.props.text).toBe('Proposed');

    const partial = store.acceptChangeset(cs.id, { by: human, ops: [1] });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.errors[0]?.hint).toMatch(/Accept op 0/);

    const accepted = store.acceptChangeset(cs.id, { by: human, ops: [0, 1] });
    expect(accepted.ok).toBe(true);
    expect(store.view.node('hero-1/heading')?.props.text).toBe('Proposed');
    const entry = store.history.at(-1)!;
    expect(entry.actor.id).toBe('claude');
    expect(entry.approvedBy?.id).toBe('ana');
    expect(entry.changeset).toBe(cs.id);
    expect(store.changeset(cs.id)?.status).toEqual(['accepted', 'accepted', 'open']);

    // The person who accepted can undo it as their own change.
    expect(store.undo({ actorId: human.id }).ok).toBe(true);
    expect(store.view.node('hero-1')).toBeUndefined();
  });

  it('accepting after someone took a pinned id uses a fresh id and rewrites later ops', () => {
    const proposed = store.propose({
      actor: agent,
      ops: [
        { op: 'section.insert', section: 'features' },
        { op: 'props.set', id: 'features-1/item-2/title', props: { text: 'Rebased' } },
      ],
    });
    if (!proposed.ok) throw new Error('propose failed');
    store.apply({ ops: [{ op: 'section.insert', section: 'features' }], actor: human });
    const res = store.acceptChangeset(proposed.changeset.id, { by: human });
    expect(res.ok).toBe(true);
    expect(store.view.node('features-2/item-2/title')?.props.text).toBe('Rebased');
    expect(store.view.node('features-1/item-2/title')?.props.text).toBe('Feature 2');
  });

  it('rejecting an op rejects the ops that need it', () => {
    const proposed = store.propose({
      actor: agent,
      ops: [
        { op: 'section.insert', section: 'hero' },
        { op: 'props.set', id: 'hero-1/heading', props: { text: 'x' } },
      ],
    });
    if (!proposed.ok) throw new Error('propose failed');
    const events: number[] = [];
    store.onChangesets((all) => events.push(all.length));
    const res = store.rejectChangeset(proposed.changeset.id, { by: human, ops: [0] });
    expect(res.rejected).toEqual([0, 1]);
    expect(events).toEqual([1]);
    expect(store.acceptChangeset(proposed.changeset.id, { by: human }).ok).toBe(false);
  });

  it('acceptance is checked against the approver’s policy too', () => {
    store.setPolicy(createPolicy({ review: { agent: true }, levels: { user: 'content' } }));
    const proposed = store.propose({
      actor: agent,
      ops: [{ op: 'section.insert', section: 'hero' }],
    });
    if (!proposed.ok) throw new Error('propose failed');
    const res = store.acceptChangeset(proposed.changeset.id, { by: human });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]?.code).toBe('policy');
  });

  it('invalid proposals fail like apply and unknown changesets explain themselves', () => {
    const bad = store.propose({ actor: agent, ops: [{ op: 'props.set', id: 'nope', props: {} }] });
    expect(bad.ok).toBe(false);
    const missing = store.acceptChangeset('cs-9', { by: human });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors[0]?.code).toBe('unknown_changeset');
  });

  it('simulate returns the would-be document without committing', () => {
    const { result, doc } = store.simulate({
      ops: [{ op: 'section.insert', section: 'hero' }],
      actor: agent,
    });
    expect(result.ok).toBe(true);
    expect(doc?.nodes['hero-1']).toBeDefined();
    expect(store.view.node('hero-1')).toBeUndefined();
  });
});
