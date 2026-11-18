import { createDefaultRegistry } from '@bowerbirdjs/blocks';
import '@bowerbirdjs/editor/define';
import type { BowerbirdEditor } from '@bowerbirdjs/editor';
import { httpChannel, SyncedStore } from '@bowerbirdjs/sync';

// Connects to a running MCP server (`bowerbird-mcp --file site.json`): you and the agent edit the
// same site, and see each other's selections. ?server= points at its preview URL.
const server = new URLSearchParams(location.search).get('server') ?? 'http://localhost:4321';
const name = new URLSearchParams(location.search).get('name') ?? 'You';
const actor = {
  kind: 'user' as const,
  id: `person-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name,
};

const status = document.getElementById('status')!;
const store = new SyncedStore({ registry: createDefaultRegistry() });
store.connect(httpChannel(server), {
  actor,
  onError: (errors) => {
    status.textContent = errors[0]?.message ?? 'The server refused a change.';
  },
});
const editor = document.querySelector('bowerbird-editor') as BowerbirdEditor;
editor.actor = actor;
editor.store = store;

const describe = () => {
  if (!store.connected) return `Connecting to ${server}…`;
  const others = store.peers.map((p) => p.actor.name ?? p.actor.id);
  return `Connected to ${server} · revision ${store.doc.revision}${others.length ? ` · also here: ${others.join(', ')}` : ''}`;
};
store.subscribe(() => {
  status.textContent = describe();
});
store.onLoad(() => {
  status.textContent = describe();
});
store.onPeers(() => {
  status.textContent = describe();
});
