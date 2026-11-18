import { createDefaultStore } from '@bowerbirdjs/editor';
import '@bowerbirdjs/editor/define';
import { PAGE_OPS } from './page.js';

if (new URLSearchParams(location.search).has('clean')) document.getElementById('hostile')?.remove();

const store = createDefaultStore();
store.apply({ label: 'Example page', ops: PAGE_OPS });
const editor = document.querySelector('bowerbird-editor');
if (editor) editor.store = store;
