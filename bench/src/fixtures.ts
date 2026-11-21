import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  createPolicy,
  createStore,
  type PolicyOptions,
  type SiteDoc,
  type Store,
} from '@bowerbirdjs/core';

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

const SAAS = [
  { op: 'section.insert', section: 'nav', page: 'home', content: { brand: { text: 'Clockwise' } } },
  {
    op: 'section.insert',
    section: 'hero',
    page: 'home',
    content: {
      heading: { text: 'Know where every hour goes' },
      subheading: { text: 'Time tracking that turns into invoices.' },
    },
  },
  { op: 'section.insert', section: 'features', page: 'home' },
  { op: 'section.insert', section: 'pricing', page: 'home' },
  {
    op: 'section.insert',
    section: 'footer',
    page: 'home',
    content: { brand: { text: 'Clockwise' } },
  },
];

const FIXTURES: Record<string, () => SiteDoc> = {
  /** One empty home page. */
  empty: () => build([]),
  /** A product landing page: nav, hero, feature grid, pricing, footer. */
  'saas-landing': () => build(SAAS),
  /** The landing page plus a contact section with its form, before the footer. */
  'saas-contact': () =>
    build([
      ...SAAS,
      { op: 'section.insert', section: 'contact', page: 'home', before: 'footer-1' },
    ]),
  /** Two pages (home and about), each with a footer of its own. */
  'two-pages': () =>
    build([
      ...SAAS,
      { op: 'page.create', id: 'about', path: '/about', title: 'About' },
      {
        op: 'section.insert',
        section: 'nav',
        page: 'about',
        content: { brand: { text: 'Clockwise' } },
      },
      {
        op: 'section.insert',
        section: 'page-header',
        page: 'about',
        content: { heading: { text: 'About Clockwise' } },
      },
      { op: 'section.insert', section: 'content', page: 'about' },
      {
        op: 'section.insert',
        section: 'footer',
        page: 'about',
        content: { brand: { text: 'Clockwise' } },
      },
    ]),
};

export const FIXTURE_NAMES = Object.keys(FIXTURES);

/** A fresh store for a task's starting document, under the task's policy. History starts empty. */
export function fixtureStore(name: string, policy?: PolicyOptions): Store {
  const make = FIXTURES[name];
  if (!make) throw new Error(`Unknown fixture "${name}". Fixtures: ${FIXTURE_NAMES.join(', ')}.`);
  return createStore({
    registry: createDefaultRegistry(),
    doc: make(),
    ...(policy ? { policy: createPolicy(policy) } : {}),
  });
}
