import type { Actor, ChangeSummary, HistoryEntry, Issue, SiteDoc, Store } from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type {
  AssetAdapter,
  BowerbirdEditor as EditorElement,
  EditorPreset,
  EditorUI,
} from '@bowerbirdjs/editor';
import {
  type CSSProperties,
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export {
  createDefaultStore,
  type EditorFeature,
  type EditorPreset,
  type EditorUI,
} from '@bowerbirdjs/editor';

export interface BowerbirdEditorProps {
  /** The document store. If omitted, the editor creates one with the default sections. */
  store?: Store;
  /** Who is editing; recorded on every change. */
  actor?: Actor;
  /** Page id to show. Only applied when it changes, so the person can switch pages in between. */
  page?: string;
  /** Where uploaded images go (enables "Upload image" on image fields). */
  assets?: AssetAdapter;
  /**
   * What the editor offers (preset, features, allowlists). Keep the object stable (e.g. `useMemo`):
   * a new object re-applies it.
   */
  ui?: EditorUI;
  /** Shorthand for `ui.preset`. */
  preset?: EditorPreset | 'auto';
  className?: string;
  style?: CSSProperties;
  onChange?: (detail: { doc: SiteDoc }) => void;
  onTransaction?: (detail: { entry: HistoryEntry; summary: ChangeSummary; doc: SiteDoc }) => void;
  onSelection?: (detail: { id: string | null }) => void;
  /** The page shown changed (picked in the editor, or the shown page was removed). */
  onPageChange?: (detail: { page: string }) => void;
  onError?: (detail: { errors: Issue[]; label?: string }) => void;
}

const EVENTS = {
  'bb-change': 'onChange',
  'bb-transaction': 'onTransaction',
  'bb-selection': 'onSelection',
  'bb-page': 'onPageChange',
  'bb-error': 'onError',
} as const;

// Layout effects run after the element is inserted but before its first (microtask) update, so it
// starts with the right store. On the server they would only warn, and there is nothing to do.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * React wrapper for `<bowerbird-editor>`. Properties are set on the element; its DOM events are
 * turned into callbacks. The ref is the element itself (with `apply`, `select`, `undo`, `redo`).
 *
 * The element renders on the client only (a placeholder `div` is rendered on the server and in
 * the first client render): it builds its own light DOM when connected, which server-rendered
 * markup could never match.
 */
export const BowerbirdEditor = forwardRef<EditorElement | null, BowerbirdEditorProps>(
  function BowerbirdEditor(props, ref) {
    const element = useRef<EditorElement | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    // biome-ignore lint/correctness/useExhaustiveDependencies: the element exists once mounted
    useImperativeHandle(ref, () => element.current as EditorElement, [mounted]);

    useIsomorphicLayoutEffect(() => {
      if (element.current && props.store) element.current.store = props.store;
    }, [mounted, props.store]);
    useIsomorphicLayoutEffect(() => {
      if (element.current && props.actor) element.current.actor = props.actor;
    }, [mounted, props.actor]);
    useIsomorphicLayoutEffect(() => {
      if (element.current && props.page) element.current.page = props.page;
    }, [mounted, props.page]);
    useIsomorphicLayoutEffect(() => {
      if (element.current) element.current.assets = props.assets;
    }, [mounted, props.assets]);
    useIsomorphicLayoutEffect(() => {
      if (element.current) element.current.ui = props.ui;
    }, [mounted, props.ui]);
    useIsomorphicLayoutEffect(() => {
      if (element.current) element.current.preset = props.preset;
    }, [mounted, props.preset]);

    useIsomorphicLayoutEffect(() => {
      const el = element.current;
      if (!el) return;
      const handlers = Object.entries(EVENTS).map(([type, prop]) => {
        const handler = (event: Event) => {
          const callback = latest.current[prop] as ((detail: unknown) => void) | undefined;
          callback?.((event as CustomEvent).detail);
        };
        el.addEventListener(type, handler);
        return [type, handler] as const;
      });
      return () => {
        for (const [type, handler] of handlers) el.removeEventListener(type, handler);
      };
    }, [mounted]);

    if (!mounted) {
      return createElement('div', {
        className: props.className,
        style: props.style,
        'data-bowerbird-editor': '',
      });
    }
    return createElement('bowerbird-editor', {
      ref: element,
      className: props.className,
      style: props.style,
    });
  },
);
