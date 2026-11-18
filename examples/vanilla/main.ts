import '@bowerbirdjs/editor/define';

const editor = document.querySelector('bowerbird-editor')!;
const status = document.getElementById('status')!;
editor.addEventListener('bb-change', (event) => {
  status.textContent = `revision ${event.detail.doc.revision}`;
});
