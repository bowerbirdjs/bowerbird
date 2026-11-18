import type { Actor, ChangeSummary, HistoryEntry, Issue, SiteDoc, Store } from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type { BowerbirdEditor as EditorElement } from '@bowerbirdjs/editor';
import {
  type CSSProperties,
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

export { createDefaultStore } from '@bowerbirdjs/editor';

export interface BowerbirdEditorProps {
  /** The document store. If omitted, the editor creates one with the default sections. */
  store?: Store;
  /** Who is editing; recorded on every change. */
  actor?: Actor;
  /** Page id to show. */
  page?: string;
  className?: string;
  style?: CSSProperties;
  onChange?: (detail: { doc: SiteDoc }) => void;
  onTransaction?: (detail: { entry: HistoryEntry; summary: ChangeSummary; doc: SiteDoc }) => void;
  onSelection?: (detail: { id: string | null }) => void;
  onError?: (detail: { errors: Issue[]; label?: string }) => void;
}

const EVENTS = {
  'bb-change': 'onChange',
  'bb-transaction': 'onTransaction',
  'bb-selection': 'onSelection',
  'bb-error': 'onError',
} as const;

/**
 * React wrapper for `<bowerbird-editor>`. Properties are set on the element; its DOM events are
 * turned into callbacks. The ref is the element itself (with `apply`, `select`, `undo`, `redo`).
 */
export const BowerbirdEditor = forwardRef<EditorElement | null, BowerbirdEditorProps>(
  function BowerbirdEditor(props, ref) {
    const element = useRef<EditorElement | null>(null);
    const latest = useRef(props);
    latest.current = props;
    useImperativeHandle(ref, () => element.current as EditorElement, []);

    useEffect(() => {
      const el = element.current;
      if (!el) return;
      if (props.store) el.store = props.store;
      if (props.actor) el.actor = props.actor;
      if (props.page) el.page = props.page;
    }, [props.store, props.actor, props.page]);

    useEffect(() => {
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
    }, []);

    return createElement('bowerbird-editor', {
      ref: element,
      className: props.className,
      style: props.style,
    });
  },
);
