import type { Actor, Store } from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type {
  AssetAdapter,
  BowerbirdEditor as EditorElement,
  EditorPreset,
  EditorUI,
} from '@bowerbirdjs/editor';
import { defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref } from 'vue';

export {
  createDefaultStore,
  type EditorFeature,
  type EditorPreset,
  type EditorUI,
} from '@bowerbirdjs/editor';

const EVENTS = {
  'bb-change': 'change',
  'bb-transaction': 'transaction',
  'bb-selection': 'selection',
  'bb-page': 'page-change',
  'bb-error': 'error',
} as const;

/**
 * Vue wrapper for `<bowerbird-editor>`. Props are passed as element properties (set when the
 * element is created, and again only when they change); DOM events are re-emitted as `change`,
 * `transaction`, `selection`, `page-change` and `error`. `expose`s the element.
 */
export const BowerbirdEditor = defineComponent({
  name: 'BowerbirdEditor',
  props: {
    store: { type: Object as PropType<Store>, default: undefined },
    actor: { type: Object as PropType<Actor>, default: undefined },
    page: { type: String, default: undefined },
    assets: { type: Object as PropType<AssetAdapter>, default: undefined },
    /** What the editor offers (preset, features, allowlists). */
    ui: { type: Object as PropType<EditorUI>, default: undefined },
    /** Shorthand for `ui.preset`. */
    preset: { type: String as PropType<EditorPreset | 'auto'>, default: undefined },
  },
  emits: ['change', 'transaction', 'selection', 'page-change', 'error'],
  setup(props, { emit, expose }) {
    const element = ref<EditorElement | null>(null);
    const listeners = Object.entries(EVENTS).map(
      ([type, name]) => [type, (e: Event) => emit(name, (e as CustomEvent).detail)] as const,
    );
    onMounted(() => {
      for (const [type, listener] of listeners) element.value?.addEventListener(type, listener);
    });
    onBeforeUnmount(() => {
      for (const [type, listener] of listeners) element.value?.removeEventListener(type, listener);
    });
    expose({ element });
    // The element is defined (imported above), so Vue sets these as properties, not attributes.
    return () =>
      h('bowerbird-editor', {
        ref: element,
        ...(props.store ? { store: props.store } : {}),
        ...(props.actor ? { actor: props.actor } : {}),
        ...(props.page ? { page: props.page } : {}),
        ...(props.assets ? { assets: props.assets } : {}),
        ...(props.ui ? { ui: props.ui } : {}),
        ...(props.preset ? { preset: props.preset } : {}),
      });
  },
});
