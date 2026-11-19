// A React app drawing its own components on the Bowerbird canvas: the promo card is a code
// component the editor stores and arranges, and React renders (with state, context and its own
// CSS). Its texts are marked with `data-bb-edit`, so they are edited on the page.
import { createEmptyDoc, createRegistry, createStore, defineComponent } from '@bowerbirdjs/core';
import { endDrag, startDrag } from '@bowerbirdjs/editor';
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
  // Badges inside the card are nodes too; the card draws them (host-drawn children).
  children: { allow: ['promo-badge'] },
  contentProps: ['heading', 'body', 'href'],
});

const promoBadge = defineComponent({
  name: 'promo-badge',
  kind: 'code',
  tag: 'promo-badge',
  title: 'Hinweis',
  description: 'A short note on a promotion card.',
  props: z.object({ text: z.string().min(1) }),
  children: false,
  contentProps: ['text'],
});

const store = createStore({
  registry: createRegistry({ components: [promoCard, promoBadge] }),
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
        body: i ? 'Alles für den Garten.' : 'Zwei zum Preis von einem.\n\nNur im April.',
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
  const edit = (prop: string, label: string, more: object = {}) =>
    JSON.stringify([{ prop, label, ...more }]);
  return (
    <section className="promo" data-testid={`promo-${mount.id}`}>
      {/* The span only styles the text: the heading is still edited on the page. */}
      <h2 data-bb-edit={edit('heading', 'Überschrift', { required: true })}>
        <span className="promo-title">{heading}</span>
      </h2>
      {body ? (
        <div data-bb-edit={edit('body', 'Text', { kind: 'multiline' })}>
          {body.split(/\n{2,}/).map((para) => (
            <p key={para}>{para}</p>
          ))}
        </div>
      ) : null}
      {mount.children.map((badge) => (
        <span
          key={badge.id}
          className="badge"
          data-bb-node={badge.id}
          data-bb-edit={edit('text', 'Hinweis', { required: true })}
        >
          {String(badge.props.text)}
        </span>
      ))}
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
  features: { structure: false, inspector: false, toolbar: false },
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
        <button
          type="button"
          className="palette"
          draggable
          onDragStart={(e) =>
            startDrag(e.nativeEvent, {
              kind: 'node',
              input: { type: 'promo-badge', props: { text: 'Neu' } },
            })
          }
          onDragEnd={() => endDrag()}
        >
          Hinweis ziehen
        </button>
        <code id="status">revision {revision}</code>
      </header>
      <BowerbirdEditor
        store={store}
        ui={ui}
        pageAttributes={page}
        renderComponent={(mount) => <Promo mount={mount} />}
        pageStart={
          <nav className="shop-nav">
            <a href="https://example.com/shop">Shop</a>
            <a href="https://example.com/kontakt" target="_blank" rel="noreferrer">
              Kontakt
            </a>
          </nav>
        }
        onChange={({ doc }) => setRevision(doc.revision)}
      />
    </Currency.Provider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
