import { createDefaultStore } from '@bowerbirdjs/editor';
import { BowerbirdEditor } from '@bowerbirdjs/vue';
import { createApp, defineComponent, h, ref } from 'vue';

const store = createDefaultStore();
store.apply({
  ops: [
    { op: 'section.insert', section: 'hero', content: { heading: { text: 'Hello from Vue' } } },
  ],
});

const App = defineComponent(() => {
  const selected = ref<string | null>(null);
  const revision = ref(store.doc.revision);
  return () => [
    h('header', [
      h('strong', 'Vue'),
      h('span', `Selected: ${selected.value ?? 'nothing'}`),
      h('code', { 'data-testid': 'revision' }, `revision ${revision.value}`),
    ]),
    h(BowerbirdEditor, {
      store,
      onSelection: (detail: { id: string | null }) => {
        selected.value = detail.id;
      },
      onChange: (detail: { doc: { revision: number } }) => {
        revision.value = detail.doc.revision;
      },
    }),
  ];
});

createApp(App).mount('#app');
