import {
  createEmptyDoc,
  createPolicy,
  createRegistry,
  createStore,
  defineSection,
  type PolicyOptions,
  type Store,
  t,
} from '@bowerbirdjs/core';

export const hero = defineSection({
  name: 'hero',
  version: 1,
  title: 'Hero',
  description: 'Intro with headline and call to action.',
  variants: { layout: ['centered', 'split'] },
  vars: { '--hero-bg': { type: 'color', default: 'var(--color-surface)' } },
  css: '.bb-hero { background: var(--hero-bg); }',
  template: ({ variant }) =>
    t.box({ tag: 'section' }, [
      t.box({ part: 'content' }, [
        t.text({ part: 'heading', tag: 'h1', text: 'Your headline' }),
        t.text({ part: 'subheading', text: 'Supporting copy' }),
        t.link({ part: 'cta', href: '#', text: 'Get started' }),
      ]),
      variant.layout === 'split' && t.image({ part: 'media', src: '/hero.png', alt: '' }),
    ]),
});

export const features = defineSection({
  name: 'features',
  version: 1,
  title: 'Features',
  description: 'A grid of feature items.',
  template: () =>
    t.box({ tag: 'section' }, [
      t.text({ part: 'heading', tag: 'h2', text: 'Features' }),
      t.box({ part: 'grid', tag: 'ul' }, [
        ...['1', '2', '3'].map((key) =>
          t.box({ part: 'item', key, tag: 'li' }, [
            t.text({ part: 'title', tag: 'h3', text: `Feature ${key}` }),
            t.text({ part: 'body', text: 'Description' }),
          ]),
        ),
      ]),
    ]),
});

export const tokens = {
  color: {
    $type: 'color',
    surface: { $value: '#ffffff' },
    accent: { $value: '#4f46e5' },
    'accent-hover': { $value: '{color.accent}' },
  },
  space: {
    $type: 'dimension',
    md: { $value: { value: 1, unit: 'rem' } },
    lg: { $value: { value: 1.5, unit: 'rem' } },
  },
};

export function makeStore(policy?: PolicyOptions): Store {
  const registry = createRegistry({ sections: [hero, features] });
  const store = createStore({
    registry,
    doc: createEmptyDoc({ tokens }),
    ...(policy ? { policy: createPolicy(policy) } : {}),
  });
  const res = store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
  if (!res.ok) throw new Error('fixture setup failed');
  return store;
}

export const agent = { kind: 'agent', id: 'claude' } as const;
export const human = { kind: 'user', id: 'ana' } as const;
