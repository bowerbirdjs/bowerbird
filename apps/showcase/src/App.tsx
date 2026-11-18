import {
  type Actor,
  createPolicy,
  type HistoryEntry,
  outline,
  type Store,
} from '@bowerbirdjs/core';
import type { BowerbirdEditor as EditorElement } from '@bowerbirdjs/editor';
import { renderDocument } from '@bowerbirdjs/html';
import { BowerbirdEditor } from '@bowerbirdjs/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type AgentRunner,
  type ChatLine,
  claudeAgent,
  demoAgent,
  describeError,
} from './agents.js';
import { demoAssets } from './assets.js';
import { createEventStore, EVENTS, type EventInfo } from './events.js';

const USER = { kind: 'user' as const, id: 'sam', name: 'Sam (you)' };

type Role = 'designer' | 'marketer';
const ROLE_LEVELS = {
  designer: { user: 'code', agent: 'design' },
  marketer: { user: 'content', agent: 'design' },
} as const;

/** Role decides what people may change; agents never overwrite people's edits without asking. */
const policyFor = (role: Role, askFirst: boolean) =>
  createPolicy({
    levels: ROLE_LEVELS[role],
    protectHumanEdits: 'confirm',
    ...(askFirst ? { review: { agent: true } } : {}),
  });

const PALETTES: Record<string, Record<string, string>> = {
  Indigo: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
  },
  Teal: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
  },
  Sunset: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
  },
};

const SUGGESTIONS = [
  'Check the mobile layout',
  'Build a page for this event',
  'Add a speakers section',
  'Make the hero split',
  'Use a teal brand',
];

function useStores() {
  return useMemo(() => new Map<string, Store>(EVENTS.map((e) => [e.id, createEventStore(e)])), []);
}

export function App() {
  const stores = useStores();
  const [eventId, setEventId] = useState(EVENTS[0]!.id);
  const event = EVENTS.find((e) => e.id === eventId) as EventInfo;
  const store = stores.get(eventId)!;
  const [role, setRole] = useState<Role>('designer');
  const [panel, setPanel] = useState<'agent' | 'developer'>('agent');
  const [last, setLast] = useState<HistoryEntry | null>(null);
  const [, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [askFirst, setAskFirst] = useState(false);
  const editor = useRef<EditorElement | null>(null);

  useEffect(() => {
    for (const s of stores.values()) s.setPolicy(policyFor(role, askFirst));
  }, [role, askFirst, stores]);

  const applyPalette = (name: string) => {
    const palette = PALETTES[name]!;
    const result = store.apply({
      actor: USER,
      label: `Palette: ${name}`,
      ops: Object.entries(palette).map(([step, value]) => ({
        op: 'token.set',
        path: `color.brand.${step}`,
        value,
      })),
    });
    setNotice(
      result.ok ? null : (result.errors[0]?.message ?? 'The palette could not be changed.'),
    );
  };

  const exportHtml = () => {
    const html = renderDocument(store.doc, store.registry, 'home');
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.id}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◆
          </span>{' '}
          Acme Events
        </div>
        <div className="control event-switch">
          <select aria-label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {EVENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <span className="crumb">
          {event.name} <span className="muted">/ Event page</span>
        </span>
        <span className="spacer" />
        <label className="control">
          Role{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="designer">Designer (everything)</option>
            <option value="marketer">Marketer (text and images only)</option>
          </select>
        </label>
        <label className="control">
          Agent changes{' '}
          <select
            value={askFirst ? 'review' : 'apply'}
            onChange={(e) => setAskFirst(e.target.value === 'review')}
          >
            <option value="apply">Apply directly</option>
            <option value="review">Ask me first</option>
          </select>
        </label>
        <label className="control">
          Brand{' '}
          <select value="" onChange={(e) => e.target.value && applyPalette(e.target.value)}>
            <option value="" disabled>
              Palette…
            </option>
            {Object.keys(PALETTES).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <button type="button" className="button" onClick={exportHtml}>
          Export HTML
        </button>
      </header>
      {notice ? (
        <div className="notice" role="status">
          {notice}
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      <nav className="sidebar" aria-label="Events">
        <p className="label">Your events</p>
        {EVENTS.map((e) => (
          <button
            type="button"
            key={e.id}
            className={e.id === eventId ? 'event active' : 'event'}
            aria-current={e.id === eventId ? 'page' : undefined}
            onClick={() => setEventId(e.id)}
          >
            <strong>{e.name}</strong>
            <span>
              {e.date} · {e.city}
            </span>
          </button>
        ))}
      </nav>
      <main className="workspace">
        <BowerbirdEditor
          ref={editor}
          key={eventId}
          assets={demoAssets}
          className="editor"
          store={store}
          actor={USER}
          onTransaction={({ entry }) => {
            setLast(entry);
            setRevision(entry.revision);
          }}
        />
      </main>
      <aside className="assistant" aria-label="Assistant">
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'agent'}
            onClick={() => setPanel('agent')}
          >
            Assistant
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'developer'}
            onClick={() => setPanel('developer')}
          >
            Developer
          </button>
        </div>
        {panel === 'agent' ? (
          <AgentPanel
            key={eventId}
            store={store}
            preview={(ops, actor) => editor.current?.controller?.showPreview(ops, { actor })}
          />
        ) : (
          <DeveloperPanel store={store} last={last} />
        )}
      </aside>
    </div>
  );
}

/** Stores with an assistant run in progress: one run per event at a time, across remounts. */
const running = new WeakSet<Store>();

function AgentPanel({
  store,
  preview,
}: {
  store: Store;
  preview: (ops: unknown[] | null, actor: Actor) => void;
}) {
  const [runner, setRunner] = useState<AgentRunner>(demoAgent);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      kind: 'note',
      text: 'Ask the assistant to change the page. You can keep editing while it works; every change is attributed and undoable.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLOListElement>(null);

  // Leaving the event (the panel is keyed by it) stops the run in progress.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    // Scroll to the newest line whenever one is added.
    if (lines.length) log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [lines]);

  const send = async (prompt: string) => {
    if (!prompt.trim() || busy) return;
    if (running.has(store)) {
      setLines((l) => [
        ...l,
        {
          kind: 'note',
          text: 'The assistant is still finishing an earlier request for this event.',
        },
      ]);
      return;
    }
    running.add(store);
    setInput('');
    setBusy(true);
    setLines((l) => [...l, { kind: 'user', text: prompt }]);
    abort.current = new AbortController();
    try {
      await runner.send(
        prompt,
        store,
        (line) => setLines((l) => [...l, line]),
        abort.current.signal,
        preview,
      );
    } catch (error) {
      setLines((l) => [...l, { kind: 'error', text: describeError(error) }]);
    } finally {
      running.delete(store);
      setBusy(false);
    }
  };

  return (
    <div className="agent">
      <label className="control block">
        Agent
        <select
          value={runner.id}
          onChange={(e) => setRunner(e.target.value === 'claude' ? claudeAgent : demoAgent)}
          disabled={busy}
        >
          <option value="demo">{demoAgent.label}</option>
          <option value="claude">{claudeAgent.label}</option>
        </select>
      </label>
      <ol className="chat" ref={log} aria-live="polite">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: chat lines are append-only
          <li key={i} className={`line ${line.kind}`}>
            {line.text}
          </li>
        ))}
      </ol>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button type="button" key={s} disabled={busy} onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          aria-label="Message the assistant"
          placeholder="Ask for a change…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="button" onClick={() => abort.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="button primary" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function DeveloperPanel({ store, last }: { store: Store; last: HistoryEntry | null }) {
  return (
    <div className="developer">
      <section>
        <h3>Last transaction</h3>
        {last ? (
          <pre>
            {JSON.stringify(
              {
                txId: last.txId,
                actor: last.actor,
                label: last.label,
                changes: last.changes.map((c) =>
                  c.kind === 'tokens' || c.kind === 'themes'
                    ? c.kind
                    : `${c.kind} ${c.id}${!c.before ? ' (created)' : !c.after ? ' (removed)' : ''}`,
                ),
              },
              null,
              2,
            )}
          </pre>
        ) : (
          <p className="muted">Make a change to see it here.</p>
        )}
      </section>
      <section>
        <h3>Outline (what an agent reads)</h3>
        <pre>{outline(store.view, { depth: 2 })}</pre>
      </section>
      <section>
        <h3>Embedding</h3>
        <pre>{`import { BowerbirdEditor } from '@bowerbirdjs/react';

<BowerbirdEditor
  store={store}
  actor={{ kind: 'user', id: 'sam' }}
  onTransaction={({ entry }) => save(entry)}
/>`}</pre>
      </section>
    </div>
  );
}
