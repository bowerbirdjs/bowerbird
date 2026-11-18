import { createDefaultStore } from '@bowerbirdjs/editor';
import '@bowerbirdjs/editor/define';

if (new URLSearchParams(location.search).has('clean')) document.getElementById('hostile')?.remove();

const store = createDefaultStore();
store.apply({
  label: 'Example page',
  ops: [
    { op: 'section.insert', section: 'nav' },
    { op: 'section.insert', section: 'hero', content: { heading: { text: 'Host CSS stays out' } } },
    { op: 'section.insert', section: 'features' },
    { op: 'section.insert', section: 'cta' },
  ],
});
const editor = document.querySelector('bowerbird-editor');
if (editor) editor.store = store;
