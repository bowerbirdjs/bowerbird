/** One measured node. Coordinates are CSS pixels relative to the page root's top-left corner. */
export interface LayoutBox {
  id: string;
  /** Nearest measured ancestor, or null for the page root. */
  parent: string | null;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Not rendered (display: none, or zero size with no visible content). */
  hidden?: boolean;
  /** Positioned out of flow (absolute, fixed or sticky). */
  positioned?: boolean;
  /** Inside an ancestor that clips or scrolls its overflow (so overflowing is intended). */
  contained?: boolean;
  /** `display: inline` (e.g. a link in running text); its box spans its line fragments. */
  inline?: boolean;
  /** Content wider/taller than the box while overflow is clipped. */
  clipped?: { x: number; y: number };
  /** Own text content (direct text, not descendants'). */
  text?: {
    chars: number;
    fontSize: number;
    lineHeight: number;
    lines: number;
    bold: boolean;
    /** Contrast ratio against the effective background; absent when it can't be determined. */
    contrast?: number;
  };
  /** Links, buttons and form controls. */
  interactive?: boolean;
  image?: { loaded: boolean; naturalWidth: number; naturalHeight: number };
}

export interface LayoutSnapshot {
  page?: string;
  /** Width the page was laid out at. */
  width: number;
  /** Total page height. */
  height: number;
  /** How far content extends past the right edge of the page (0 if it fits). */
  overflowX: number;
  boxes: LayoutBox[];
}

export type LayoutSeverity = 'error' | 'warning' | 'info';

export interface LayoutIssue {
  rule:
    | 'horizontal-overflow'
    | 'clipped-content'
    | 'overlap'
    | 'small-text'
    | 'tap-target'
    | 'contrast'
    | 'image-missing'
    | 'collapsed';
  severity: LayoutSeverity;
  nodeId: string;
  message: string;
  hint?: string;
}
