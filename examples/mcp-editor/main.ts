import { createDefaultRegistry } from '@bowerbirdjs/blocks';
import '@bowerbirdjs/editor/define';
import type { BowerbirdEditor } from '@bowerbirdjs/editor';
import { httpChannel, SyncedStore } from '@bowerbirdjs/sync';

// Connects to a running MCP server (`bowerbird-mcp --file site.json`): you and the agent edit the
// same site, and see each other's selections. ?sync= is the sync URL the server prints (it holds
// a key made for that run).
const params = new URLSearchParams(location.search);
const sync = params.get('sync');
const name = params.get('name') ?? 'You';
const actor = {
  kind: 'user' as const,
  id: `person-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
};

const status = document.getElementById('status')!;
const store = new SyncedStore({ registry: createDefaultRegistry() });
const editor = document.querySelector('bowerbird-editor') as BowerbirdEditor;
editor.actor = actor;
editor.store = store;

if (!sync) {
  status.textContent =
    'Add ?sync=<the sync URL bowerbird-mcp printed> to this page’s address to connect.';
} else {
  const server = new URL(sync).host;
  // Refused changes show in the editor; the status line says whether we're connected.
  store.connect(httpChannel(sync), { actor });
  const describe = () => {
    if (!store.connected)
      return store.id ? `Reconnecting to ${server}…` : `Connecting to ${server}…`;
    const others = store.peers.map((p) => p.actor.name ?? p.actor.id);
    const unsent = store.unconfirmed ? ` · ${store.unconfirmed} unsaved` : '';
    return `Connected to ${server} · revision ${store.doc.revision}${unsent}${others.length ? ` · also here: ${others.join(', ')}` : ''}`;
  };
  const update = () => {
    status.textContent = describe();
  };
  store.subscribe(update);
  store.onLoad(update);
  store.onPeers(update);
  store.onStatus(update);
}
