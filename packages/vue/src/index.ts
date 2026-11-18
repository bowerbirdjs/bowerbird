import type { Actor, Store } from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type { BowerbirdEditor as EditorElement } from '@bowerbirdjs/editor';
import { defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref, watch } from 'vue';

export { createDefaultStore } from '@bowerbirdjs/editor';

const EVENTS = {
  'bb-change': 'change',
  'bb-transaction': 'transaction',
  'bb-selection': 'selection',
  'bb-error': 'error',
} as const;

/**
 * Vue wrapper for `<bowerbird-editor>`. Props are set as element properties; DOM events are
 * re-emitted as `change`, `transaction`, `selection` and `error`. `expose`s the element.
 */
export const BowerbirdEditor = defineComponent({
  name: 'BowerbirdEditor',
  props: {
    store: { type: Object as PropType<Store>, default: undefined },
    actor: { type: Object as PropType<Actor>, default: undefined },
    page: { type: String, default: undefined },
  },
  emits: ['change', 'transaction', 'selection', 'error'],
  setup(props, { emit, expose }) {
    const element = ref<EditorElement | null>(null);
    const sync = () => {
      const el = element.value;
      if (!el) return;
      if (props.store) el.store = props.store;
      if (props.actor) el.actor = props.actor;
      if (props.page) el.page = props.page;
    };
    const listeners = Object.entries(EVENTS).map(
      ([type, name]) => [type, (e: Event) => emit(name, (e as CustomEvent).detail)] as const,
    );
    onMounted(() => {
      sync();
      for (const [type, listener] of listeners) element.value?.addEventListener(type, listener);
    });
    onBeforeUnmount(() => {
      for (const [type, listener] of listeners) element.value?.removeEventListener(type, listener);
    });
    watch(() => [props.store, props.actor, props.page], sync);
    expose({ element });
    return () => h('bowerbird-editor', { ref: element });
  },
});
