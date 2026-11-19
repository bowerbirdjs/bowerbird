import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { type Actor, createStore } from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type { BowerbirdEditor } from '@bowerbirdjs/editor';
import { createSyncServer, memoryChannelPair, SyncedStore } from '@bowerbirdjs/sync';

// The "server": the authoritative store. In a real product it runs on your backend and clients
// connect over a WebSocket (see socketChannel); here everything is in one page.
const registry = createDefaultRegistry();
const server = createStore({ registry, doc: createStarterDoc() });
server.apply({
  actor: { kind: 'system', id: 'setup' },
  ops: [
    { op: 'page.create', path: '/', title: 'Home' },
    {
      op: 'section.insert',
      section: 'hero',
      content: { heading: { text: 'Edit me from either side' } },
    },
    { op: 'section.insert', section: 'features' },
  ],
});
const sync = createSyncServer(server);

function connect(id: string, actor: Actor) {
  const store = new SyncedStore({ registry });
  const { client, server: end } = memoryChannelPair();
  sync.connect(end);
  store.connect(client, { actor });
  const editor = document.getElementById(id) as BowerbirdEditor;
  editor.actor = actor;
  editor.store = store;
  return store;
}

connect('sam', { kind: 'user', id: 'sam', name: 'Sam' });
connect('ana', { kind: 'user', id: 'ana', name: 'Ana' });

const revision = document.getElementById('revision')!;
revision.textContent = `revision ${server.doc.revision}`;
server.subscribe(({ doc }) => {
  revision.textContent = `revision ${doc.revision}`;
});

// An agent working on the server store directly (as it would through MCP).
const agent: Actor = { kind: 'agent', id: 'helper', name: 'Helper agent' };
let step = 0;
document.getElementById('agent')!.addEventListener('click', () => {
  const edits = [
    {
      label: 'Rewrite subheading',
      ops: [
        {
          op: 'props.set',
          id: 'hero-1/subheading',
          props: { text: 'Written by the agent while you both watch.' },
        },
      ],
    },
    {
      label: 'Add call to action',
      ops: [
        {
          op: 'section.insert',
          section: 'cta',
          content: { heading: { text: 'Ready when you are' } },
        },
      ],
    },
    {
      label: 'Retitle features',
      ops: [
        { op: 'props.set', id: 'features-1/heading', props: { text: 'What the agent changed' } },
      ],
    },
  ];
  const edit = edits[step++ % edits.length]!;
  server.apply({ actor: agent, ...edit });
});
