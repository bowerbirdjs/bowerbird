// A React app drawing its own components on the Bowerbird canvas: the promo card is a code
// component the editor stores and arranges, and React renders (with state, context and its own
// CSS). Its texts are marked with `data-bb-edit`, so they are edited on the page.
import { createEmptyDoc, createRegistry, createStore, defineComponent } from '@bowerbirdjs/core';
import { BowerbirdEditor, type ComponentMount, type EditorUI } from '@bowerbirdjs/react';
import { createContext, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';

const promoCard = defineComponent({
  name: 'promo-card',
  kind: 'code',
  tag: 'promo-card',
  title: 'Aktion',
  description: 'A promotion with a heading, a text and a link (drawn by React).',
  props: z.object({
    heading: z.string().min(1),
    body: z.string().optional(),
    href: z.string().optional(),
  }),
  children: false,
  contentProps: ['heading', 'body', 'href'],
});

const store = createStore({
  registry: createRegistry({ components: [promoCard] }),
  doc: createEmptyDoc(),
});
const system = { kind: 'system', id: 'example' } as const;
store.apply({
  actor: system,
  ops: [{ op: 'page.create', path: '/', title: 'Start', id: 'home' }],
});
store.apply({
  actor: system,
  ops: ['spring', 'summer'].map((id, i) => ({
    op: 'node.insert',
    parent: store.doc.pages.home!.rootId,
    node: {
      type: 'promo-card',
      id,
      props: {
        heading: i ? 'Sommerfest' : 'Frühlingsaktion',
        body: i ? 'Alles für den Garten.' : 'Zwei zum Preis von einem.',
        href: '/aktion',
      },
    },
  })),
});

/** App context the components read: proof that they render inside the app's React tree. */
const Currency = createContext('EUR');

function Promo({ mount }: { mount: ComponentMount }) {
  const currency = useContext(Currency);
  const [likes, setLikes] = useState(0);
  const { heading, body, href } = mount.props as { heading: string; body?: string; href?: string };
  return (
    <section className="promo" data-testid={`promo-${mount.id}`}>
      <h2
        data-bb-edit={JSON.stringify([{ prop: 'heading', label: 'Überschrift', required: true }])}
      >
        {heading}
      </h2>
      {body ? (
        <p data-bb-edit={JSON.stringify([{ prop: 'body', label: 'Text', kind: 'multiline' }])}>
          {body}
        </p>
      ) : null}
      <p>
        <a href={href ?? '#'}>Mehr</a> · <span data-testid="currency">{currency}</span>{' '}
        <button type="button" onClick={() => setLikes((n) => n + 1)} data-testid="like">
          Gefällt {likes}
        </button>
      </p>
    </section>
  );
}

const ui: EditorUI = {
  features: { structure: false, inspector: false, toolbar: false, insert: false },
  strings: {
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    duplicate: 'Duplizieren',
    delete: 'Löschen',
    drag: 'Ziehen zum Verschieben',
    parent: 'Übergeordnetes Element',
    selectionLabel: (n) => n.title ?? n.type,
  },
};
const page = { 'data-shop': '', style: '--brand: #0f766e', lang: 'de' };

function App() {
  const [revision, setRevision] = useState(store.doc.revision);
  return (
    <Currency.Provider value="CHF">
      <header>
        <strong>React components on the canvas</strong>
        <code id="status">revision {revision}</code>
      </header>
      <BowerbirdEditor
        store={store}
        ui={ui}
        pageAttributes={page}
        renderComponent={(mount) => <Promo mount={mount} />}
        onChange={({ doc }) => setRevision(doc.revision)}
      />
    </Currency.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
