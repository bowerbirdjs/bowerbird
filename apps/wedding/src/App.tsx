import { type Actor, diffDocs, type SiteDoc, type Store } from '@bowerbirdjs/core';
import type { BowerbirdEditor as EditorElement, EditorUI } from '@bowerbirdjs/editor';
import { BowerbirdEditor } from '@bowerbirdjs/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DesignPanel } from './DesignPanel.js';
import { Details } from './Details.js';
import { JOY_ICONS } from './joy/icons.js';
import { JoyMark } from './joy/mark.js';
import type { EventInfo, SiteLocale } from './site/facts.js';
import { OCCASIONS } from './site/facts.js';
import {
  createEventSite,
  DEMO,
  EVENT_BLOCK_TYPES,
  renderSite,
  STARTER_FACTS,
  starterFactOps,
} from './site/site.js';
import { forget, inlineAssets, load, openSite, save } from './storage.js';

/** The person using the planner. Agents would get their own actor and the same policy. */
const HOST: Actor = { kind: 'user', id: 'host', name: 'You' };

/**
 * The editor as a structured editor: event blocks only, whole sections, content fields and
 * layout/background choices, no styling (designs do that) and nothing technical.
 */
const EDITOR_UI: EditorUI = {
  preset: 'full',
  // Joy Phone's icon set (the rest of the theme is CSS: ./joy/editor-theme.css).
  icons: JOY_ICONS,
  sections: EVENT_BLOCK_TYPES,
  features: {
    'insert.elements': false,
    components: false,
    'inspector.styles': false,
    'inspector.section.settings': false,
    'inspector.content.advanced': false,
    'inspector.info': false,
    'inspector.page': false,
    'toolbar.theme': false,
    'toolbar.language': false,
    'canvas.label': false,
  },
};

type Tab = 'details' | 'design';

/** Components that show facts, and the Details group that holds them. */
const FACT_COMPONENT_GROUP: Record<string, string> = {
  'schedule-items': 'schedule',
  'venue-cards': 'venues',
  'travel-info': 'travel',
  'dresscode-info': 'dresscode',
  'faq-items': 'faq',
  'gift-links': 'gifts',
  'event-date': 'event',
  'countdown-days': 'event',
  monogram: 'event',
};

export function App() {
  const initial = useMemo(load, []);
  const [store, setStore] = useState<Store>(initial.store);
  const [published, setPublished] = useState<SiteDoc | null>(initial.published);
  const [revision, setRevision] = useState(store.doc.revision);
  const [tab, setTab] = useState<Tab>('details');
  const [focus, setFocus] = useState<{ path: string; at: number; field: boolean } | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [preview, setPreview] = useState<null | 'draft' | 'live'>(null);
  const [creating, setCreating] = useState(false);
  const editor = useRef<EditorElement | null>(null);

  // Re-render on every change, from the editor, the details or the design panel.
  useEffect(() => {
    setRevision(store.doc.revision);
    const off = store.subscribe(() => setRevision(store.doc.revision));
    const offLoad = store.onLoad(() => setRevision(store.doc.revision));
    return () => {
      off();
      offLoad();
    };
  }, [store]);

  // Autosave shortly after changes.
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: saves when the document changes
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved('saving');
    const t = setTimeout(() => setSaved(save(store.doc, published) ? 'saved' : 'failed'), 500);
    return () => clearTimeout(t);
  }, [revision, store, published]);

  // A section that shows facts, added to a page whose facts are empty, brings starter facts.
  useEffect(
    () =>
      store.subscribe(({ entry }) => {
        if (entry.actor.id !== HOST.id || entry.kind !== 'edit') return;
        // New section roots (only roots carry `section`).
        const added = entry.changes.flatMap((c) =>
          c.kind === 'node' && !c.before && c.after?.section ? [c.after.section.name] : [],
        );
        const ops = [...new Set(added)].flatMap((type) => starterFactOps(store, type));
        const unique = ops.filter(
          (op, i) =>
            ops.findIndex((o) => (o as { key: string }).key === (op as { key: string }).key) === i,
        );
        if (unique.length)
          queueMicrotask(() => store.apply({ actor: HOST, ops: unique, label: 'Starter details' }));
      }),
    [store],
  );

  const change = useCallback(
    (ops: unknown[], label: string) => store.apply({ actor: HOST, ops, label }),
    [store],
  );

  const event = store.view.data('event') as EventInfo;
  const unpublished = !published || diffDocs(published, store.doc).length > 0;

  const switchLanguage = (locale: SiteLocale) => {
    if (locale === event.locale) return;
    const result = change(
      [{ op: 'data.set', key: 'event', path: ['locale'], value: locale }],
      'Language',
    );
    // New sections bring starter text in the site's language, so the editor gets that registry.
    if (result.ok) setStore(openSite(store.doc));
  };

  const startEvent = (doc: SiteDoc) => {
    setStore(openSite(doc));
    setPublished(null);
    setTab('details');
    setCreating(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="logo">
            <JoyMark size={26} />
          </span>
          Wedding planner
        </span>
        <span className="event-title">{event.title}</span>
        <span className={`save ${saved}`} role="status">
          {saved === 'saving'
            ? 'Saving…'
            : saved === 'failed'
              ? 'Not saved: storage is full'
              : 'Saved'}
        </span>
        <span className="spacer" />
        <button type="button" className="button" onClick={() => setCreating(true)}>
          New event
        </button>
        <button type="button" className="button" onClick={() => setPreview('draft')}>
          View site
        </button>
        {published ? (
          <button type="button" className="button" onClick={() => setPreview('live')}>
            Live site
          </button>
        ) : null}
        <button
          type="button"
          className={`button${unpublished ? ' primary' : ''}`}
          onClick={() => {
            setPublished(store.doc);
            save(store.doc, store.doc);
          }}
        >
          {unpublished ? 'Publish' : 'Published'}
        </button>
      </header>

      <aside className="side" aria-label="Event">
        <div className="tabs" role="tablist">
          {(['details', 'design'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
            >
              {t === 'details' ? 'Details' : 'Design'}
            </button>
          ))}
        </div>
        <div className="side-body" role="tabpanel">
          {tab === 'details' ? (
            <Details store={store} change={change} focus={focus} onLanguage={switchLanguage} />
          ) : (
            <DesignPanel store={store} change={change} />
          )}
        </div>
      </aside>

      <main className="workspace">
        <BowerbirdEditor
          ref={editor}
          className="editor joy-editor"
          store={store}
          actor={HOST}
          ui={EDITOR_UI}
          assets={inlineAssets}
          onDataClick={({ path }) => {
            setTab('details');
            // Editing happens on the page; the details show where the value lives.
            setFocus({ path, at: Date.now(), field: false });
          }}
          onSelection={({ id }) => {
            // Selecting what shows facts opens their group (keyboard focus stays on the page).
            const group = id ? FACT_COMPONENT_GROUP[store.view.node(id)?.type ?? ''] : undefined;
            if (group) {
              setTab('details');
              setFocus({ path: group, at: Date.now(), field: false });
            }
          }}
        />
      </main>

      {preview ? (
        <Preview
          title={preview === 'live' ? 'Live site' : 'Preview of your draft'}
          html={renderSite(preview === 'live' && published ? published : store.doc, store.registry)}
          onClose={() => setPreview(null)}
        />
      ) : null}
      {creating ? (
        <NewEvent
          onCancel={() => setCreating(false)}
          onCreate={(info) =>
            startEvent(createEventSite({ event: info, ...STARTER_FACTS[info.locale] }).doc)
          }
          onDemo={(locale) => {
            forget();
            startEvent(createEventSite(DEMO[locale]).doc);
          }}
        />
      ) : null}
    </div>
  );
}

/** The site as guests see it, in a frame without scripts, at phone or desktop width. */
function Preview({ title, html, onClose }: { title: string; html: string; onClose: () => void }) {
  const [width, setWidth] = useState<'phone' | 'desktop'>('desktop');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="overlay-bar">
        <strong>{title}</strong>
        <div className="segmented">
          {(['phone', 'desktop'] as const).map((w) => (
            <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)}>
              {w === 'phone' ? 'Phone' : 'Desktop'}
            </button>
          ))}
        </div>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      <iframe title={title} className={`preview-frame ${width}`} sandbox="" srcDoc={html} />
    </div>
  );
}

function NewEvent({
  onCreate,
  onCancel,
  onDemo,
}: {
  onCreate: (info: EventInfo) => void;
  onCancel: () => void;
  onDemo: (locale: SiteLocale) => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [locale, setLocale] = useState<SiteLocale>('de');
  const [occasion, setOccasion] = useState<EventInfo['occasion']>('wedding');
  // The dialog's first field takes focus when it opens.
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="overlay center" role="dialog" aria-modal="true" aria-labelledby="new-h">
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({ title: title.trim() || 'Unser Fest', date: date || null, locale, occasion });
        }}
      >
        <h2 id="new-h">New event</h2>
        <p className="muted">
          You get a complete page to start from. Everything can be changed later.
        </p>
        <label className="field">
          <span>Your names or the event’s title</span>
          <input
            value={title}
            ref={first}
            placeholder="Lena & Jonas"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Language of the site</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as SiteLocale)}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">
          <span>Occasion</span>
          <select
            value={occasion}
            onChange={(e) => setOccasion(e.target.value as EventInfo['occasion'])}
          >
            {OCCASIONS.map((o) => (
              <option key={o} value={o}>
                {o[0]!.toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="link" onClick={() => onDemo('de')}>
            Demo (Deutsch)
          </button>
          <button type="button" className="link" onClick={() => onDemo('en')}>
            Demo (English)
          </button>
          <span className="spacer" />
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
