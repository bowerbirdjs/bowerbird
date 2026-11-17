import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, type SiteDoc, type Store } from '@bowerbirdjs/core';

const SYSTEM = { kind: 'system', id: 'pagebench' } as const;

function build(ops: unknown[]): SiteDoc {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({
    actor: SYSTEM,
    ops: [{ op: 'page.create', path: '/', title: 'Home' }, ...ops],
  });
  if (!res.ok) throw new Error(`Fixture failed to build: ${JSON.stringify(res.errors)}`);
  return store.doc;
}

const FIXTURES: Record<string, () => SiteDoc> = {
  empty: () => build([]),
  'saas-landing': () =>
    build([
      { op: 'section.insert', section: 'nav', content: { brand: { text: 'Clockwise' } } },
      {
        op: 'section.insert',
        section: 'hero',
        content: {
          heading: { text: 'Know where every hour goes' },
          subheading: { text: 'Time tracking that turns into invoices.' },
        },
      },
      { op: 'section.insert', section: 'features' },
      { op: 'section.insert', section: 'pricing' },
      { op: 'section.insert', section: 'footer', content: { brand: { text: 'Clockwise' } } },
    ]),
};

export const FIXTURE_NAMES = Object.keys(FIXTURES);

/** A fresh store for a task's starting document. History starts empty. */
export function fixtureStore(name: string): Store {
  const make = FIXTURES[name];
  if (!make) throw new Error(`Unknown fixture "${name}". Fixtures: ${FIXTURE_NAMES.join(', ')}.`);
  return createStore({ registry: createDefaultRegistry(), doc: make() });
}
