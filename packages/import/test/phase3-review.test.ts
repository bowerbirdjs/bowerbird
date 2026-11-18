import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { importPuck, type PuckData } from '@bowerbirdjs/import';
import { describe, expect, it } from 'vitest';

const ROOT = { parent: 'root-home' };

describe('Puck import of unusual data', () => {
  it('cuts zone loops instead of overflowing the stack', () => {
    const data = {
      content: [{ type: 'Columns', props: { id: 'a' } }],
      zones: {
        'a:left': [{ type: 'Card', props: { id: 'b' } }],
        'b:inner': [{ type: 'Columns', props: { id: 'a' } }],
      },
    } as PuckData;
    const { ops, warnings } = importPuck(data, ROOT);
    expect(ops).toHaveLength(1);
    expect(warnings.join('\n')).toMatch(/"Columns" \(a\) contains itself/);
  });

  it('limits deep nesting', () => {
    let item: { type: string; props: Record<string, unknown> } = {
      type: 'Leaf',
      props: { text: 'deep' },
    };
    for (let i = 0; i < 200; i++) item = { type: 'Wrap', props: { slot: [item] } };
    const { warnings } = importPuck({ content: [item] }, ROOT);
    expect(warnings.join('\n')).toMatch(/nested deeper than 40/);
  });

  it('the nodes it makes fit in a document, even when text sits under 40 nested boxes', () => {
    let item: { type: string; props: Record<string, unknown> } = {
      type: 'Leaf',
      props: { text: 'deep' },
    };
    for (let i = 0; i < 39; i++) item = { type: 'Wrap', props: { title: `L${i}`, slot: [item] } };
    const { ops, warnings } = importPuck({ content: [item] }, ROOT);
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const res = store.apply({ ops });
    expect(res.ok).toBe(true);
    expect(warnings.join('\n')).toMatch(/1 node\(s\) nested deeper than 40 levels were left out/);
  });

  it('never uses prototype members as mappers, and skips items without props', () => {
    const data = {
      content: [
        { type: 'toString', props: { text: 'A' } },
        { type: 'constructor', props: { text: 'B' } },
        { type: 'Text', props: null },
        { type: 'Text', props: [] },
      ],
    } as unknown as PuckData;
    const { ops, warnings } = importPuck(data, { ...ROOT, map: {} });
    expect(ops).toEqual([
      expect.objectContaining({
        op: 'node.insert',
        node: expect.objectContaining({ name: 'toString' }),
      }),
      expect.objectContaining({
        op: 'node.insert',
        node: expect.objectContaining({ name: 'constructor' }),
      }),
    ]);
    expect(warnings.filter((w) => /not a Puck component/.test(w))).toHaveLength(2);
  });

  it('imports a slot and a legacy zone with the same name once each', () => {
    const data: PuckData = {
      content: [
        {
          type: 'Columns',
          props: {
            id: 'cols',
            left: [{ type: 'Text', props: { id: 't1', text: 'From the slot' } }],
          },
        },
      ],
      zones: { 'cols:left': [{ type: 'Text', props: { id: 't2', text: 'From the zone' } }] },
    };
    const { ops } = importPuck(data, ROOT);
    const json = JSON.stringify(ops);
    expect(json.match(/From the slot/g)).toHaveLength(1);
    expect(json.match(/From the zone/g)).toHaveLength(1);
  });
});
