import type {
  Actor,
  ChangeSummary,
  Changeset,
  HistoryEntry,
  Issue,
  SiteDoc,
  Store,
} from '@bowerbirdjs/core';
import '@bowerbirdjs/editor/define';
import type {
  AssetAdapter,
  ComponentMount,
  EditorAppearance,
  EditorDensity,
  BowerbirdEditor as EditorElement,
  EditorPreset,
  EditorUI,
} from '@bowerbirdjs/editor';
import {
  type CSSProperties,
  createElement,
  Fragment,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal, flushSync } from 'react-dom';

export {
  type ComponentMount,
  createDefaultStore,
  EDITOR_TOKENS,
  type EditorAppearance,
  type EditorDensity,
  type EditorFeature,
  type EditorIcons,
  type EditorPreset,
  type EditorToken,
  type EditorTokens,
  type EditorUI,
  ICON_NAMES,
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
   * What the editor offers and how it looks (preset, features, allowlists, appearance, density,
   * tokens). Keep the object stable (e.g. `useMemo`): a new object re-applies it.
   */
  ui?: EditorUI;
  /** Shorthand for `ui.preset`. */
  preset?: EditorPreset | 'auto';
  /** Shorthand for `ui.appearance`: `light` (default), `dark` or `auto`. */
  appearance?: EditorAppearance;
  /** Shorthand for `ui.density`: `comfortable` (default) or `compact`. */
  density?: EditorDensity;
  className?: string;
  style?: CSSProperties;
  onChange?: (detail: { doc: SiteDoc }) => void;
  onTransaction?: (detail: { entry: HistoryEntry; summary: ChangeSummary; doc: SiteDoc }) => void;
  onSelection?: (detail: { id: string | null }) => void;
  /** The page shown changed (picked in the editor, or the shown page was removed). */
  onPageChange?: (detail: { page: string }) => void;
  onError?: (detail: { errors: Issue[]; label?: string }) => void;
  /** Proposed changes waiting for review changed (proposed, accepted or rejected). */
  onChangesets?: (detail: { changesets: readonly Changeset[] }) => void;
  /** Text shown from site data was clicked; `path` is `<group>.<path>`, e.g. `schedule.0.time`. */
  onDataClick?: (detail: { path: string; node: string | null }) => void;
  /**
   * Draws code components (`kind: 'code'`) on the canvas with your React components: called for
   * each one on the page, rendered through a portal into its mount. Your components keep the app's
   * context (providers above the editor), and their state survives every change to the page.
   * Mark editable text in your markup with `data-bb-edit` (see `EditField`).
   */
  renderComponent?: (mount: ComponentMount) => ReactNode;
  /**
   * Attributes for the canvas page's root element, e.g. `{ 'data-site': '', style: '--brand: #c00' }`
   * for site CSS scoped to the site root. Keep the object stable (e.g. `useMemo`).
   */
  pageAttributes?: Record<string, string>;
  /** The code components on the page changed (with `renderComponent`). */
  onMounts?: (detail: { mounts: readonly ComponentMount[] }) => void;
  /** Your markup at the start of the page frame, outside the document (a site header or menu). */
  pageStart?: ReactNode;
  /** Your markup at the end of the page frame, outside the document. */
  pageEnd?: ReactNode;
}

const EVENTS = {
  'bb-change': 'onChange',
  'bb-transaction': 'onTransaction',
  'bb-selection': 'onSelection',
  'bb-page': 'onPageChange',
  'bb-error': 'onError',
  'bb-changesets': 'onChangesets',
  'bb-data-click': 'onDataClick',
  'bb-mounts': 'onMounts',
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
    const [mounts, setMounts] = useState<readonly ComponentMount[]>([]);
    const [slots, setSlots] = useState<{ start: HTMLElement; end: HTMLElement } | undefined>();
    const wantsSlots = props.pageStart !== undefined || props.pageEnd !== undefined;
    useEffect(() => setMounted(true), []);
    const drawsComponents = !!props.renderComponent;
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
      if (element.current) element.current.appearance = props.appearance;
    }, [mounted, props.appearance]);
    useIsomorphicLayoutEffect(() => {
      if (element.current) element.current.density = props.density;
    }, [mounted, props.density]);
    useIsomorphicLayoutEffect(() => {
      if (element.current) element.current.pageAttributes = props.pageAttributes;
    }, [mounted, props.pageAttributes]);
    useIsomorphicLayoutEffect(() => {
      const el = element.current;
      if (!el) return;
      el.hostComponents = drawsComponents;
      if (!drawsComponents) {
        setMounts([]);
        return;
      }
      // Drawn in the same frame the canvas rendered, so outlines measure the finished markup.
      const onMounts = (event: Event) => {
        const next = (event as CustomEvent<{ mounts: readonly ComponentMount[] }>).detail.mounts;
        flushSync(() => setMounts(next));
      };
      el.addEventListener('bb-mounts', onMounts);
      setMounts(el.mounts);
      return () => el.removeEventListener('bb-mounts', onMounts);
    }, [mounted, drawsComponents]);
    useIsomorphicLayoutEffect(() => {
      if (element.current && wantsSlots && !slots) setSlots(element.current.pageSlots);
    }, [mounted, wantsSlots, slots]);
    // After every render of the portals: the editor readies the new markup and re-measures.
    useIsomorphicLayoutEffect(() => {
      if ((drawsComponents && mounts.length) || slots) element.current?.componentsRendered();
    });

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
    const editor = createElement('bowerbird-editor', {
      ref: element,
      className: props.className,
      style: props.style,
    });
    const render = props.renderComponent;
    const portals = [
      ...(render ? mounts.map((mount) => createPortal(render(mount), mount.el, mount.id)) : []),
      ...(slots && props.pageStart !== undefined
        ? [createPortal(props.pageStart, slots.start, 'bb-page-start')]
        : []),
      ...(slots && props.pageEnd !== undefined
        ? [createPortal(props.pageEnd, slots.end, 'bb-page-end')]
        : []),
    ];
    if (!portals.length) return editor;
    return createElement(Fragment, null, editor, portals);
  },
);
